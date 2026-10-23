import type {
  AgentChannelPort,
  AgentEvent,
  AgentMode,
  AnnotationDocument,
  AnnotationId,
  AnnotationStorePort,
  ClipboardPort,
  IdPort,
  Point,
  SourceFrame,
  VersionId,
} from './contract.ts';
import { createEditor, emptyDocument, reduce } from './editor.ts';
import type { DrawKind, EditorAction, EditorState, Outcome, Tool } from './editor.ts';
import { formatCopyExport } from './export.ts';
import type { CopyExportOptions } from './export.ts';
import { resolveAll, resolveRequestFor } from './resolution.ts';
import type { ResolvedAnnotation } from './resolution.ts';
import { parseAnnotationDocument } from './validate.ts';

export type LoadResult =
  | { readonly status: 'loaded'; readonly document: AnnotationDocument }
  | { readonly status: 'empty'; readonly document: AnnotationDocument }
  /** Unknown schema or invalid record: shown read-only, never overwritten. */
  | { readonly status: 'unsupported' | 'invalid'; readonly document: AnnotationDocument };

export async function loadAnnotations(store: AnnotationStorePort, version: VersionId): Promise<LoadResult> {
  const raw = await store.load(version);
  if (raw === null || raw === undefined) return { status: 'empty', document: emptyDocument(version) };
  const parsed = parseAnnotationDocument(raw);
  if (!parsed.ok) return { status: parsed.reason === 'unsupported-schema' ? 'unsupported' : 'invalid', document: emptyDocument(version) };
  if (parsed.document.versionId !== version) return { status: 'invalid', document: emptyDocument(version) };
  return { status: 'loaded', document: parsed.document };
}

export interface AnnotationPorts {
  readonly ids: IdPort;
  readonly clipboard: ClipboardPort;
  readonly store: AnnotationStorePort;
  /** Absent for static captures: Pick and Cite are then unavailable. */
  readonly agent?: AgentChannelPort;
}

export interface ControllerSnapshot {
  readonly editor: EditorState;
  readonly frame: SourceFrame | null;
  readonly readOnly: boolean;
  readonly lastOutcome: Outcome | null;
  readonly resolved: readonly ResolvedAnnotation[];
  /** Note attached to the next created mark (Pick, Cite or drawn), then cleared. */
  readonly pendingNote: string;
}

export function agentModeFor(tool: Tool | null): AgentMode {
  return tool === 'pick' ? 'pick' : tool === 'cite' ? 'cite' : 'off';
}

/**
 * Composes the pure editor with injected ports. Root supplies the current
 * SourceFrame; the controller never infers a version or rebinds anchors.
 */
export class AnnotationController {
  readonly #ports: AnnotationPorts;
  readonly #listeners = new Set<() => void>();
  #snapshot: ControllerSnapshot;
  #unsubscribe: (() => void) | null = null;

  constructor(load: LoadResult, ports: AnnotationPorts) {
    this.#ports = ports;
    const readOnly = load.status === 'unsupported' || load.status === 'invalid';
    this.#snapshot = { editor: createEditor(load.document), frame: null, readOnly, lastOutcome: null, resolved: [], pendingNote: '' };
    if (ports.agent !== undefined) this.#unsubscribe = ports.agent.subscribe((event) => this.#onAgentEvent(event));
  }

  get snapshot(): ControllerSnapshot {
    return this.#snapshot;
  }

  get canPickOrCite(): boolean {
    return this.#ports.agent !== undefined;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#ports.agent?.setMode('off');
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
  }

  setFrame(frame: SourceFrame): void {
    this.#update({ ...this.#snapshot, frame });
  }

  selectTool(tool: Tool | null): Outcome {
    if ((tool === 'pick' || tool === 'cite') && this.#ports.agent === undefined) {
      return this.#record({ status: 'rejected', reason: 'unavailable' });
    }
    const outcome = this.#dispatch({ type: 'select-tool', tool }, false);
    this.#ports.agent?.setMode(agentModeFor(tool));
    return outcome;
  }

  setPendingNote(note: string): void {
    this.#update({ ...this.#snapshot, pendingNote: note });
  }

  /** Draws a mark; without an explicit note it takes and clears the pending note. */
  draw(kind: DrawKind, points: readonly Point[], note?: string): Outcome {
    const frame = this.#snapshot.frame;
    if (frame === null) return this.#record({ status: 'rejected', reason: 'no-frame' });
    return this.#create({ type: 'draw', id: this.#ports.ids.next(), kind, points, frame, note: note ?? this.#snapshot.pendingNote }, note === undefined);
  }

  erase(point: Point, radius: number): Outcome {
    const frame = this.#snapshot.frame;
    if (frame === null) return this.#record({ status: 'rejected', reason: 'no-frame' });
    return this.#dispatch({ type: 'erase', point, radius, frame });
  }

  setNote(id: AnnotationId, note: string): Outcome {
    return this.#dispatch({ type: 'set-note', id, note });
  }

  remove(id: AnnotationId): Outcome {
    return this.#dispatch({ type: 'delete', id });
  }

  toggleRevisit(id: AnnotationId): Outcome {
    return this.#dispatch({ type: 'toggle-revisit', id });
  }

  undo(): Outcome {
    return this.#dispatch({ type: 'undo' });
  }

  redo(): Outcome {
    return this.#dispatch({ type: 'redo' });
  }

  exportText(options?: CopyExportOptions): string {
    return formatCopyExport(this.#snapshot.editor.document, options);
  }

  async copy(options?: CopyExportOptions): Promise<string> {
    const text = this.exportText(options);
    await this.#ports.clipboard.writeText(text);
    return text;
  }

  /** Saves the editable document; a read-only (unsupported/invalid) load is never overwritten. */
  async save(): Promise<'saved' | 'read-only'> {
    if (this.#snapshot.readOnly) return 'read-only';
    await this.#ports.store.save(this.#snapshot.editor.document);
    return 'saved';
  }

  /** Re-resolves live anchors through the agent (or stored geometry for static captures). */
  async refreshResolution(): Promise<readonly ResolvedAnnotation[]> {
    const { frame, editor } = this.#snapshot;
    if (frame === null) return [];
    const annotations = editor.document.annotations;
    const requests = annotations.map(resolveRequestFor).filter((r) => r !== null);
    let live: Awaited<ReturnType<AgentChannelPort['resolve']>> | undefined;
    if (this.#ports.agent !== undefined && requests.length > 0) live = await this.#ports.agent.resolve(requests);
    const displayFrame = live === undefined ? frame : { ...frame, viewport: live.frame.viewport };
    const resolved = resolveAll(annotations, displayFrame, live?.results);
    // A late result applies only while its document and frame are still current.
    if (this.#snapshot.editor.document.annotations === annotations && this.#snapshot.frame === frame) {
      this.#update({ ...this.#snapshot, resolved });
    }
    return resolved;
  }

  #onAgentEvent(event: AgentEvent): void {
    const frame = this.#snapshot.frame;
    if (frame === null) {
      this.#record({ status: 'rejected', reason: 'no-frame' });
      return;
    }
    this.#create({ type: 'agent-event', id: this.#ports.ids.next(), event, frame, note: this.#snapshot.pendingNote }, true);
  }

  #create(action: EditorAction, consumesPending: boolean): Outcome {
    const outcome = this.#dispatch(action);
    if (outcome.status === 'applied' && consumesPending && this.#snapshot.pendingNote !== '') this.setPendingNote('');
    return outcome;
  }

  #dispatch(action: EditorAction, mutates = true): Outcome {
    if (mutates && this.#snapshot.readOnly) return this.#record({ status: 'rejected', reason: 'read-only' });
    const { state, outcome } = reduce(this.#snapshot.editor, action);
    this.#update({ ...this.#snapshot, editor: state, lastOutcome: outcome });
    return outcome;
  }

  #record(outcome: Outcome): Outcome {
    this.#update({ ...this.#snapshot, lastOutcome: outcome });
    return outcome;
  }

  #update(next: ControllerSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
