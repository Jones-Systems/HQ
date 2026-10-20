import type {
  BlobDigest, ClaimLevel, ClockPort, LibraryState, ReferenceStoragePort, ValidationIssue,
} from './contract.ts';
import { sha256Hex } from './jcs.ts';
import type {
  AnchorId, CaptureId, DeclaredRightsInput, GraphState, GraphTreeCandidate, PinId, ReferencePin, SourceAvailability,
  SubjectId, TreeImportOutcome, TreeImportReport,
} from './graph-contract.ts';
import { GRAPH_DOCUMENT_KEY } from './graph-contract.ts';
import { planFlatAdoption } from './graph-flat.ts';
import type { PrepareOptions, PreparedGraph } from './graph-import.ts';
import { applyPrepared, assetDigests, emptyGraph, prepareTree } from './graph-import.ts';
import { derivePinId } from './graph-identity.ts';
import type { BrowseNode, PinRequest } from './graph-ops.ts';
import * as ops from './graph-ops.ts';
import { parseGraphDocument } from './graph-persist.ts';
import type { Result } from './library.ts';
import type { PacketMode, ReferenceBundle, ReferencePacket } from './packet.ts';
import { buildBundle, buildPacket, parsePacket, preparePacketAdoption } from './packet.ts';
import type { LibraryAccess, MutationResult } from './service.ts';

/** Workspace storage and a clock. There is deliberately no cache port: graph state is never disposable. */
export interface GraphPorts {
  readonly storage: ReferenceStoragePort;
  readonly clock: ClockPort;
}

export type GraphAccess = LibraryAccess;

export interface ExportPacketOptions {
  readonly mode: PacketMode;
  /** Explicit captures. Mutually exclusive with `projectId`. */
  readonly captureIds?: readonly CaptureId[];
  /** Export the captures that the project pins. */
  readonly projectId?: string;
}

export interface AdoptPacketOptions {
  /** Blob bytes by digest; only digests the packet names are considered, and each is verified. */
  readonly blobs?: ReadonlyMap<BlobDigest, Uint8Array>;
}

export type PacketAdoptionOutcome =
  | ({
    readonly ok: true;
    readonly packetDigest: string;
    readonly blobs: { readonly stored: number; readonly missing: readonly BlobDigest[] };
  } & TreeImportReport)
  | { readonly ok: false; readonly status: 'invalid'; readonly path: string }
  | { readonly ok: false; readonly status: 'future-schema'; readonly schema: string }
  | { readonly ok: false; readonly status: 'rejected'; readonly code: string };

type Listener = () => void;

/**
 * Reference graph service over injected ports. Mutations are serialized and
 * committed as one workspace document with compare-and-swap; blobs are only
 * ever added. A CAS conflict is a known no-effect and is reapplied once on
 * reloaded state; a thrown write is an unknown effect that fences the graph
 * until `reload()` reads authoritative state.
 */
export class ReferenceGraph {
  #state: GraphState;
  #revision: string | null;
  #access: GraphAccess;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #ports: GraphPorts;
  readonly #listeners = new Set<Listener>();

  private constructor(ports: GraphPorts) {
    this.#ports = ports;
    this.#state = emptyGraph();
    this.#revision = null;
    this.#access = { mode: 'writable' };
  }

  static async open(ports: GraphPorts): Promise<ReferenceGraph> {
    const graph = new ReferenceGraph(ports);
    await graph.#load();
    return graph;
  }

  get state(): GraphState { return this.#state; }
  get access(): GraphAccess { return this.#access; }
  get adapterLabels(): readonly string[] { return [this.#ports.storage.label, this.#ports.clock.label]; }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  reload(): Promise<GraphAccess> {
    return this.#serial(async () => { await this.#load(); return this.#access; });
  }

  async #load(): Promise<void> {
    const stored = await this.#ports.storage.readDocument('workspace', GRAPH_DOCUMENT_KEY);
    if (stored === null) { this.#set(emptyGraph(), null, { mode: 'writable' }); return; }
    const parsed = await parseGraphDocument(stored.value);
    if (parsed.status === 'ok') this.#set(parsed.state, stored.revision, { mode: 'writable' });
    else if (parsed.status === 'future-schema') this.#set(emptyGraph(), stored.revision, { mode: 'read-only', reason: 'future-schema', detail: parsed.schema });
    else this.#set(emptyGraph(), stored.revision, { mode: 'read-only', reason: 'invalid-document', detail: parsed.path });
  }

  #set(state: GraphState, revision: string | null, access: GraphAccess): void {
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

  async #commit<T>(step: (state: GraphState) => Result<{ state: GraphState; value: T }>): Promise<MutationResult<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.#access.mode !== 'writable') return { ok: false, code: this.#access.mode };
      const result = step(this.#state);
      if (!result.ok) return result;
      const { state, value } = result.value;
      if (state === this.#state) return { ok: true, value };
      let written;
      try {
        written = await this.#ports.storage.writeDocument('workspace', GRAPH_DOCUMENT_KEY, state, this.#revision);
      } catch {
        this.#set(this.#state, this.#revision, { mode: 'fenced', reason: 'unknown-write-effect' });
        return { ok: false, code: 'unknown-write-effect' };
      }
      if (written.ok) { this.#set(state, written.revision, this.#access); return { ok: true, value }; }
      if (written.reason === 'read-only') {
        this.#set(this.#state, this.#revision, { mode: 'read-only', reason: 'storage-read-only', detail: this.#ports.storage.label });
        return { ok: false, code: 'read-only' };
      }
      await this.#load();
    }
    return { ok: false, code: 'conflict' };
  }

  #mutate(step: (state: GraphState) => Result<GraphState>): Promise<MutationResult> {
    return this.#serial(() => this.#commit((state) => {
      const result = step(state);
      return result.ok ? { ok: true, value: { state: result.value, value: undefined } } : result;
    }));
  }

  /* ------------------------------------------------------------- import -- */

  /** Imports a website or app tree. Idempotent: the same identities never duplicate. */
  importTree(candidate: GraphTreeCandidate): Promise<TreeImportOutcome> {
    return this.#serial(() => this.#importPrepared(candidate, {}));
  }

  /**
   * Reads the flat `hq.design.references/v1` library into the graph without
   * touching it. Skipped references are returned with their reason.
   */
  adoptFlatLibrary(library: LibraryState): Promise<{ readonly outcomes: readonly TreeImportOutcome[]; readonly skipped: readonly { readonly id: string; readonly code: string }[] }> {
    return this.#serial(async () => {
      const plan = planFlatAdoption(library);
      const outcomes: TreeImportOutcome[] = [];
      for (const tree of plan.trees) outcomes.push(await this.#importPrepared(tree, { origin: 'flat-library' }));
      return { outcomes, skipped: plan.skipped };
    });
  }

  async #importPrepared(candidate: GraphTreeCandidate, options: PrepareOptions): Promise<TreeImportOutcome> {
    const now = this.#ports.clock.now();
    const prepared = await prepareTree(candidate, now, options);
    if (!prepared.ok) return { ok: false, issues: prepared.issues };
    return this.#commitPrepared(prepared.prepared, now);
  }

  /** Stores pending bytes, snapshots blob presence, then commits the prepared graph. */
  async #commitPrepared(prepared: PreparedGraph, now: string): Promise<TreeImportOutcome> {
    if (this.#access.mode !== 'writable') return { ok: false, issues: [{ field: '', code: this.#access.mode }] };
    for (const capture of prepared.captures) {
      if (capture.pendingBytes === null || capture.record.asset === null) continue;
      // Content-addressed and idempotent; a failed commit leaves only an unreferenced blob.
      const stored = await this.#ports.storage.putBlob(capture.pendingBytes, capture.record.asset.mediaType);
      if (stored.digest !== capture.record.asset.digest) return { ok: false, issues: [{ field: 'asset', code: 'digest-mismatch' }] };
    }
    const presence = await this.#presence(assetDigests(prepared));
    const committed = await this.#commit((state) => {
      const applied = applyPrepared(state, prepared, presence, now);
      return applied.ok ? { ok: true, value: { state: applied.state, value: applied.report } } : applied;
    });
    if (!committed.ok) return { ok: false, issues: [{ field: '', code: committed.code }] satisfies readonly ValidationIssue[] };
    return { ok: true, ...committed.value };
  }

  async #presence(digests: readonly BlobDigest[]): Promise<ReadonlySet<BlobDigest>> {
    const present = new Set<BlobDigest>();
    for (const digest of digests) if (await this.#ports.storage.hasBlob(digest)) present.add(digest);
    return present;
  }

  /* ------------------------------------------------------- owner edits -- */

  setRating(id: SubjectId, rating: number | null): Promise<MutationResult> {
    return this.#mutate((state) => ops.setRating(state, id, rating));
  }

  setSubjectTitle(id: SubjectId, title: string): Promise<MutationResult> {
    return this.#mutate((state) => ops.setSubjectTitle(state, id, title));
  }

  deleteSubject(id: SubjectId): Promise<MutationResult> {
    return this.#mutate((state) => ops.tombstoneSubject(state, id, this.#ports.clock.now()));
  }

  restoreSubject(id: SubjectId): Promise<MutationResult> {
    return this.#mutate((state) => ops.restoreSubject(state, id));
  }

  setCaptureRights(id: CaptureId, rights: DeclaredRightsInput): Promise<MutationResult> {
    return this.#mutate((state) => ops.setCaptureRights(state, id, rights, this.#ports.clock.now()));
  }

  reportSourceStatus(id: CaptureId, status: SourceAvailability, by: ClaimLevel): Promise<MutationResult> {
    return this.#mutate((state) => ops.reportSourceStatus(state, id, status, by, this.#ports.clock.now()));
  }

  /** Re-checks which asset digests storage can serve, so late-arriving bytes clear `blob-missing`. */
  refreshAvailability(): Promise<MutationResult> {
    return this.#serial(async () => {
      const presence = await this.#presence(ops.referencedGraphDigests(this.#state));
      return this.#commit((state) => ({ ok: true, value: { state: ops.refreshContentAvailability(state, presence, this.#ports.clock.now()), value: undefined } }));
    });
  }

  /** Tombstones a capture. Its blob, anchors and pins are retained. */
  deleteCapture(id: CaptureId): Promise<MutationResult> {
    return this.#mutate((state) => ops.tombstoneCapture(state, id, this.#ports.clock.now()));
  }

  restoreCapture(id: CaptureId): Promise<MutationResult> {
    return this.#mutate((state) => ops.restoreCapture(state, id));
  }

  /* ---------------------------------------------------------------- pins -- */

  /** Records an explicit pin to one exact capture. It never sends, launches or navigates. */
  pin(captureId: CaptureId, projectId: string, options: { viewId?: string; anchorId?: AnchorId; purpose?: string } = {}): Promise<MutationResult<ReferencePin>> {
    return this.#serial(async () => {
      const request: PinRequest = {
        projectId, viewId: options.viewId ?? null, captureId, anchorId: options.anchorId ?? null, purpose: options.purpose ?? '',
      };
      const id = await derivePinId(request.projectId, request.viewId, request.captureId, request.anchorId);
      return this.#commit((state) => {
        const result = ops.pinCapture(state, id, request, this.#ports.clock.now());
        return result.ok ? { ok: true, value: { state: result.value.state, value: result.value.pin } } : result;
      });
    });
  }

  unpin(id: PinId): Promise<MutationResult> {
    return this.#mutate((state) => ops.unpin(state, id, this.#ports.clock.now()));
  }

  /* ------------------------------------------------------------ packets -- */

  /**
   * Exports an immutable reference packet and its bundle. Selection is every
   * capture, explicit captures, or the live pins of one project; selecting a
   * project never changes it, and nothing here sends or launches.
   */
  exportPacket(options: ExportPacketOptions): Promise<MutationResult<{ readonly packet: ReferencePacket; readonly bundle: ReferenceBundle }>> {
    return this.#serial(async () => {
      let captureIds = options.captureIds;
      if (options.projectId !== undefined) {
        if (captureIds !== undefined) return { ok: false, code: 'ambiguous-selection' } as const;
        captureIds = [...new Set(ops.pinsForProject(this.#state, options.projectId).map((pin) => pin.captureId))];
      }
      const built = await buildPacket(this.#state, captureIds === undefined ? { mode: options.mode } : { mode: options.mode, captureIds });
      return built.ok ? { ok: true, value: { packet: built.packet, bundle: buildBundle(built.packet) } } as const : built;
    });
  }

  /**
   * Adopts a packet from untrusted input. Strict validation first; a future
   * schema or any invalid byte changes nothing. Adoption is idempotent by
   * content address. Blob bytes, when supplied, are verified against the
   * packet's digests before anything is written; absent bytes leave the capture
   * `blob-missing` rather than inventing content.
   */
  adoptPacket(input: unknown, options: AdoptPacketOptions = {}): Promise<PacketAdoptionOutcome> {
    return this.#serial(async () => {
      const parsed = await parsePacket(input);
      if (parsed.status === 'future-schema') return { ok: false, status: 'future-schema', schema: parsed.schema };
      if (parsed.status === 'invalid') return { ok: false, status: 'invalid', path: parsed.path };
      if (this.#access.mode !== 'writable') return { ok: false, status: 'rejected', code: this.#access.mode };
      const packet = parsed.packet;
      const supplied = new Map<BlobDigest, Uint8Array>();
      for (const blob of packet.blobs) {
        const bytes = options.blobs?.get(blob.digest);
        if (bytes === undefined) continue;
        if (bytes.byteLength !== blob.bytes || `sha256:${await sha256Hex(bytes)}` !== blob.digest) {
          return { ok: false, status: 'rejected', code: 'blob-bytes-mismatch' };
        }
        supplied.set(blob.digest, bytes);
      }
      let stored = 0;
      for (const blob of packet.blobs) {
        const bytes = supplied.get(blob.digest);
        if (bytes === undefined || await this.#ports.storage.hasBlob(blob.digest)) continue;
        const result = await this.#ports.storage.putBlob(bytes, blob.mediaType);
        if (result.digest !== blob.digest) return { ok: false, status: 'rejected', code: 'blob-bytes-mismatch' };
        stored += 1;
      }
      const now = this.#ports.clock.now();
      const prepared = preparePacketAdoption(packet, now);
      const presence = await this.#presence(assetDigests(prepared));
      const committed = await this.#commit((state) => {
        const applied = applyPrepared(state, prepared, presence, now);
        return applied.ok ? { ok: true, value: { state: applied.state, value: applied.report } } : applied;
      });
      if (!committed.ok) return { ok: false, status: 'rejected', code: committed.code };
      return {
        ok: true, packetDigest: packet.packetDigest, ...committed.value,
        blobs: { stored, missing: packet.blobs.map((blob) => blob.digest).filter((digest) => !presence.has(digest)) },
      };
    });
  }

  /* ------------------------------------------------------------- browse -- */

  browse(): readonly BrowseNode[] {
    return ops.browseGraph(this.#state);
  }
}
