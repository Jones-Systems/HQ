import type {
  CollectionId, ImportOutcome, LibraryState, ReferenceId, ReferenceImportCandidate, ReferencePorts, ReferenceUse,
  ReferenceUseId,
} from './contract.ts';
import { LIBRARY_DOCUMENT_KEY } from './contract.ts';
import type { ExportOptions, ReferenceExport } from './export.ts';
import { exportReferences } from './export.ts';
import type { Result } from './library.ts';
import * as ops from './library.ts';
import { parseLibraryDocument } from './persist.ts';

export type LibraryAccess =
  | { readonly mode: 'writable' }
  /** Newer schema or invalid document: shown as-is when possible, never written. */
  | { readonly mode: 'read-only'; readonly reason: 'future-schema' | 'invalid-document' | 'storage-read-only'; readonly detail: string }
  /** A write may or may not have landed; reload authoritative state before any further write. */
  | { readonly mode: 'fenced'; readonly reason: 'unknown-write-effect' };

export type MutationResult<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

type Listener = () => void;

/**
 * Reference library service over injected ports. Mutations are serialized,
 * committed as one workspace document with compare-and-swap, and never delete
 * blobs. Navigation or linking never dispatches work.
 */
export class ReferenceLibrary {
  #state: LibraryState;
  #revision: string | null;
  #access: LibraryAccess;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #ports: ReferencePorts;
  readonly #listeners = new Set<Listener>();

  private constructor(ports: ReferencePorts, state: LibraryState, revision: string | null, access: LibraryAccess) {
    this.#ports = ports;
    this.#state = state;
    this.#revision = revision;
    this.#access = access;
  }

  static async open(ports: ReferencePorts): Promise<ReferenceLibrary> {
    const library = new ReferenceLibrary(ports, ops.emptyLibrary(), null, { mode: 'writable' });
    await library.#load();
    return library;
  }

  get state(): LibraryState { return this.#state; }
  get access(): LibraryAccess { return this.#access; }
  get adapterLabels(): readonly string[] {
    return [this.#ports.storage.label, this.#ports.clock.label, this.#ports.ids.label];
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Re-reads the authoritative document; the only way to clear a fence. */
  reload(): Promise<LibraryAccess> {
    return this.#serial(async () => { await this.#load(); return this.#access; });
  }

  async #load(): Promise<void> {
    const stored = await this.#ports.storage.readDocument('workspace', LIBRARY_DOCUMENT_KEY);
    if (stored === null) {
      this.#set(ops.emptyLibrary(), null, { mode: 'writable' });
      return;
    }
    const parsed = parseLibraryDocument(stored.value);
    if (parsed.status === 'ok') this.#set(parsed.state, stored.revision, { mode: 'writable' });
    else if (parsed.status === 'future-schema') this.#set(ops.emptyLibrary(), stored.revision, { mode: 'read-only', reason: 'future-schema', detail: parsed.schema });
    else this.#set(ops.emptyLibrary(), stored.revision, { mode: 'read-only', reason: 'invalid-document', detail: parsed.path });
  }

  #set(state: LibraryState, revision: string | null, access: LibraryAccess): void {
    const changed = state !== this.#state || access !== this.#access;
    this.#state = state;
    this.#revision = revision;
    this.#access = access;
    if (changed) for (const listener of this.#listeners) listener();
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Applies `step` and commits. A CAS conflict is a known no-effect, so the
   * step is reapplied once on reloaded state. A thrown write is an unknown
   * effect: the library fences itself until `reload()`.
   */
  async #commit<T>(step: (state: LibraryState) => Result<{ state: LibraryState; value: T }>): Promise<MutationResult<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.#access.mode !== 'writable') return { ok: false, code: this.#access.mode };
      const result = step(this.#state);
      if (!result.ok) return result;
      const { state, value } = result.value;
      if (state === this.#state) return { ok: true, value };
      let written;
      try {
        written = await this.#ports.storage.writeDocument('workspace', LIBRARY_DOCUMENT_KEY, state, this.#revision);
      } catch {
        this.#set(this.#state, this.#revision, { mode: 'fenced', reason: 'unknown-write-effect' });
        return { ok: false, code: 'unknown-write-effect' };
      }
      if (written.ok) {
        this.#set(state, written.revision, this.#access);
        return { ok: true, value };
      }
      if (written.reason === 'read-only') {
        this.#set(this.#state, this.#revision, { mode: 'read-only', reason: 'storage-read-only', detail: this.#ports.storage.label });
        return { ok: false, code: 'read-only' };
      }
      await this.#load();
    }
    return { ok: false, code: 'conflict' };
  }

  #mutate(step: (state: LibraryState) => Result<LibraryState>): Promise<MutationResult> {
    return this.#serial(() => this.#commit((state) => {
      const result = step(state);
      return result.ok ? { ok: true, value: { state: result.value, value: undefined } } : result;
    }));
  }

  /* ------------------------------------------------------------- import -- */

  importReference(candidate: ReferenceImportCandidate): Promise<ImportOutcome> {
    return this.#serial(async (): Promise<ImportOutcome> => {
      const now = this.#ports.clock.now();
      const prepared = await ops.prepareImport(candidate, now);
      if (!prepared.ok) return { status: 'rejected', issues: prepared.issues };
      const { record, pendingBytes } = prepared.prepared;
      const isNew = this.#state.references[record.id] === undefined;
      if (isNew && record.asset !== null && this.#access.mode === 'writable') {
        if (pendingBytes !== null) {
          // Content-addressed and idempotent; a failed record commit leaves only an unreferenced blob.
          const stored = await this.#ports.storage.putBlob(pendingBytes, record.asset.mediaType);
          if (stored.digest !== record.asset.digest) return { status: 'rejected', issues: [{ field: 'asset', code: 'digest-mismatch' }] };
        } else if (!(await this.#ports.storage.hasBlob(record.asset.digest))) {
          return { status: 'rejected', issues: [{ field: 'asset.digest', code: 'blob-missing' }] };
        }
      }
      const committed = await this.#commit((state) => {
        const applied = ops.applyImport(state, prepared.prepared, now);
        if (!applied.ok) return applied;
        return { ok: true, value: { state: applied.state, value: applied } };
      });
      if (!committed.ok) return { status: 'rejected', issues: [{ field: '', code: committed.code }] };
      const applied = committed.value;
      if (applied.status === 'created') return { status: 'created', id: applied.id };
      return { status: applied.status, id: applied.id, differences: applied.differences };
    });
  }

  /** Imports serially, preserving input order in the outcomes. */
  async importMany(candidates: readonly ReferenceImportCandidate[]): Promise<readonly ImportOutcome[]> {
    const outcomes: ImportOutcome[] = [];
    for (const candidate of candidates) outcomes.push(await this.importReference(candidate));
    return outcomes;
  }

  /* --------------------------------------------------------- references -- */

  updateDetails(id: ReferenceId, patch: { title?: string; notes?: string }): Promise<MutationResult> {
    return this.#mutate((state) => ops.updateDetails(state, id, patch));
  }

  setTags(id: ReferenceId, tags: readonly string[]): Promise<MutationResult> {
    return this.#mutate((state) => ops.setTags(state, id, tags));
  }

  setRights(id: ReferenceId, rights: { status: string; basis?: string; attribution?: string }): Promise<MutationResult> {
    return this.#mutate((state) => ops.setRights(state, id, rights, this.#ports.clock.now()));
  }

  deleteReference(id: ReferenceId): Promise<MutationResult> {
    return this.#mutate((state) => ops.tombstoneReference(state, id, this.#ports.clock.now()));
  }

  restoreReference(id: ReferenceId): Promise<MutationResult> {
    return this.#mutate((state) => ops.restoreReference(state, id));
  }

  /* -------------------------------------------------------- collections -- */

  createCollection(name: string, description = ''): Promise<MutationResult<CollectionId>> {
    return this.#serial(() => {
      const id = this.#ports.ids.next('col');
      return this.#commit((state) => {
        const result = ops.createCollection(state, id, name, description, this.#ports.clock.now());
        return result.ok ? { ok: true, value: { state: result.value, value: id as CollectionId } } : result;
      });
    });
  }

  renameCollection(id: CollectionId, name: string): Promise<MutationResult> {
    return this.#mutate((state) => ops.renameCollection(state, id, name));
  }

  addToCollection(id: CollectionId, referenceId: ReferenceId): Promise<MutationResult> {
    return this.#mutate((state) => ops.addToCollection(state, id, referenceId));
  }

  removeFromCollection(id: CollectionId, referenceId: ReferenceId): Promise<MutationResult> {
    return this.#mutate((state) => ops.removeFromCollection(state, id, referenceId));
  }

  /** Tombstones the collection; references and blobs are never deleted. */
  deleteCollection(id: CollectionId): Promise<MutationResult> {
    return this.#mutate((state) => ops.tombstoneCollection(state, id, this.#ports.clock.now()));
  }

  restoreCollection(id: CollectionId): Promise<MutationResult> {
    return this.#mutate((state) => ops.restoreCollection(state, id));
  }

  /* ---------------------------------------------------- use in project -- */

  /** Records an explicit link only. It never sends, launches or navigates. */
  useInProject(referenceId: ReferenceId, projectId: string, options: { viewId?: string; purpose?: string } = {}): Promise<MutationResult<ReferenceUse>> {
    return this.#serial(() => {
      const useId = this.#ports.ids.next('use');
      return this.#commit((state) => {
        const result = ops.linkToProject(state, useId, referenceId, projectId, options.viewId ?? null, options.purpose ?? '', this.#ports.clock.now());
        return result.ok ? { ok: true, value: { state: result.value.state, value: result.value.use } } : result;
      });
    });
  }

  unlinkUse(useId: ReferenceUseId): Promise<MutationResult> {
    return this.#mutate((state) => ops.unlinkFromProject(state, useId, this.#ports.clock.now()));
  }

  /* ------------------------------------------------------------- export -- */

  export(options: ExportOptions): Promise<ReferenceExport> {
    return exportReferences(this.#state, options);
  }
}
