/**
 * Labelled fakes for the section's ports. Every fake reports `adapter: 'fake'`
 * and must never be presented as runtime, preview or clipboard evidence.
 */
import { annotationId } from './contract.ts';
import type {
  AgentChannelPort,
  AgentEvent,
  AgentFrame,
  AgentMode,
  AgentResolution,
  AnnotationDocument,
  AnnotationId,
  AnnotationStorePort,
  ClipboardPort,
  IdPort,
  ResolveRequest,
  ResolveResult,
  VersionId,
} from './contract.ts';

export class FakeClipboard implements ClipboardPort {
  readonly adapter = 'fake' as const;
  readonly writes: string[] = [];
  async writeText(text: string): Promise<void> {
    this.writes.push(text);
  }
}

export class SequentialIds implements IdPort {
  readonly adapter = 'fake' as const;
  readonly #prefix: string;
  #next = 1;
  constructor(prefix = 'ann') {
    this.#prefix = prefix;
  }
  next(): AnnotationId {
    return annotationId(`${this.#prefix}-${this.#next++}`);
  }
}

/** Stores JSON text so loads exercise the strict parser, as a real store would. */
export class MemoryAnnotationStore implements AnnotationStorePort {
  readonly adapter = 'fake' as const;
  readonly records = new Map<string, string>();
  saves = 0;
  async load(version: VersionId): Promise<unknown> {
    const text = this.records.get(version);
    return text === undefined ? null : JSON.parse(text);
  }
  async save(document: AnnotationDocument): Promise<void> {
    this.saves += 1;
    this.records.set(document.versionId, JSON.stringify(document));
  }
}

/** Scripted agent channel: tests emit events and preset resolution results. */
export class FakeAgentChannel implements AgentChannelPort {
  readonly adapter = 'fake' as const;
  mode: AgentMode = 'off';
  readonly modeHistory: AgentMode[] = [];
  readonly resolveCalls: (readonly ResolveRequest[])[] = [];
  frame: AgentFrame = { viewport: { w: 1280, h: 800, dpr: 1 }, scroll: { x: 0, y: 0 } };
  results: (request: ResolveRequest) => ResolveResult = () => ({ found: false });
  readonly #listeners = new Set<(event: AgentEvent) => void>();

  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.modeHistory.push(mode);
  }
  async resolve(requests: readonly ResolveRequest[]): Promise<AgentResolution> {
    this.resolveCalls.push(requests);
    return { frame: this.frame, results: requests.map((request) => this.results(request)) };
  }
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
  get listenerCount(): number {
    return this.#listeners.size;
  }
}
