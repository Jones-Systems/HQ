import type {
  ClaimJudgment, DecisionPacket, ReturnedCandidate, ReviewDecision, ReviewEvent, RequestDraft, RequestId, SchedulerPort,
} from './contract.ts';
import { applyEdit, freezeBlockers, type DraftEdit } from './draft.ts';
import { canonicalBytes } from './jcs.ts';
import {
  FreezeBlockedError, OutcomeUnknownError, StaleDraftError, type RequestSnapshot, type RequestStore,
} from './store.ts';
import { brandId } from './validate.ts';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface SessionState {
  readonly requestId: RequestId;
  readonly draft: RequestDraft | null;
  readonly packets: readonly DecisionPacket[];
  readonly reviews: readonly ReviewEvent[];
  readonly candidates: readonly ReturnedCandidate[];
  readonly save: SaveStatus;
  readonly savedAt: string | null;
  readonly busy: 'freezing' | 'reviewing' | null;
  readonly error: string | null;
  /** Freeze reasons for the current draft; empty when it can be frozen. */
  readonly blockers: readonly string[];
  readonly readOnly: string | null;
  /** An outcome is unknown; edits are held until `reconcile()`. */
  readonly unknown: boolean;
  readonly recovered: readonly string[];
}

export interface SessionOptions {
  readonly debounceMs?: number;
  readonly now: () => string;
}

/**
 * One open request: applies edits immediately in memory, autosaves after a
 * short debounce, and serializes every storage operation so a late autosave
 * can never land after a freeze or revise.
 */
export class RequestSession {
  private readonly store: RequestStore;
  private readonly scheduler: SchedulerPort;
  private readonly options: SessionOptions;
  private value: SessionState;
  private timer: unknown = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(state: SessionState) => void>();

  private constructor(store: RequestStore, scheduler: SchedulerPort, options: SessionOptions, snapshot: RequestSnapshot) {
    this.store = store;
    this.scheduler = scheduler;
    this.options = options;
    this.value = this.fromSnapshot(snapshot);
  }

  static async open(store: RequestStore, scheduler: SchedulerPort, requestId: RequestId, options: SessionOptions): Promise<RequestSession> {
    return new RequestSession(store, scheduler, options, await store.open(requestId));
  }

  private fromSnapshot(snapshot: RequestSnapshot): SessionState {
    return {
      requestId: snapshot.requestId, draft: snapshot.draft, packets: snapshot.packets, reviews: snapshot.reviews,
      candidates: snapshot.candidates, save: 'saved', savedAt: null, busy: null, error: null,
      blockers: snapshot.draft ? freezeBlockers(snapshot.draft, snapshot.packets.at(-1) ?? null) : [],
      readOnly: snapshot.readOnly, unknown: false, recovered: snapshot.recovered,
    };
  }

  get state(): SessionState { return this.value; }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(patch: Partial<SessionState>): void {
    const merged = { ...this.value, ...patch };
    const next: SessionState = patch.draft !== undefined || patch.packets !== undefined
      ? { ...merged, blockers: merged.draft ? freezeBlockers(merged.draft, merged.packets.at(-1) ?? null) : [] }
      : merged;
    this.value = next;
    for (const listener of this.listeners) listener(next);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get editable(): boolean {
    const state = this.value;
    return state.draft !== null && state.busy === null && state.readOnly === null && !state.unknown;
  }

  /** Applies an edit and schedules autosave. Returns false while edits are held. */
  edit(edit: DraftEdit): boolean {
    const draft = this.value.draft;
    if (!this.editable || !draft) return false;
    this.set({ draft: applyEdit(draft, edit, this.options.now()), save: 'unsaved', error: null });
    this.schedule();
    return true;
  }

  private schedule(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = this.scheduler.setTimeout(() => { this.timer = null; void this.flush(); }, this.options.debounceMs ?? 400);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Saves the current draft now. Safe to call repeatedly. */
  flush(): Promise<void> {
    this.cancelTimer();
    return this.enqueue(async () => {
      const draft = this.value.draft;
      if (!draft || this.value.save === 'saved' || this.value.readOnly || this.value.unknown) return;
      this.set({ save: 'saving' });
      try {
        await this.store.saveDraft(draft);
        const current = this.value.draft;
        this.set({ save: current?.draftId === draft.draftId && current.revision === draft.revision ? 'saved' : 'unsaved', savedAt: this.options.now() });
      } catch (error) {
        this.set({ save: 'error', error: `Draft not saved: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
  }

  /** Exact bytes of the in-memory draft, as autosave would write them. */
  draftBytes(): Uint8Array | null {
    return this.value.draft ? canonicalBytes(this.value.draft) : null;
  }

  /** Stores the image bytes and adds an unselected attachment candidate. */
  async addAttachment(bytes: Uint8Array, meta: { readonly mediaType: string; readonly label: string; readonly attachmentId: string }): Promise<boolean> {
    if (!this.editable) return false;
    const blobDigest = await this.enqueue(() => this.store.putAttachmentBlob(bytes));
    return this.edit({
      type: 'add-attachment',
      attachment: { attachmentId: brandId(meta.attachmentId), blobDigest, mediaType: meta.mediaType, bytes: bytes.length, label: meta.label },
    });
  }

  /** Freezes the current draft. Never sends; sending is a separate explicit action elsewhere. */
  freeze(): Promise<DecisionPacket | null> {
    const draft = this.value.draft;
    if (!this.editable || !draft) return Promise.resolve(null);
    this.cancelTimer();
    this.set({ busy: 'freezing', error: null });
    return this.enqueue(async () => {
      try {
        const result = await this.store.freeze(draft);
        this.set({
          busy: null, draft: result.continuation, packets: [...this.value.packets, result.packet],
          save: result.cleanup === 'done' ? 'saved' : 'unsaved', savedAt: this.options.now(),
        });
        if (result.cleanup === 'pending') this.schedule();
        return result.packet;
      } catch (error) {
        this.fail(error);
        return null;
      }
    });
  }

  private fail(error: unknown): void {
    if (error instanceof OutcomeUnknownError) this.set({ busy: null, unknown: true, error: error.message });
    else if (error instanceof FreezeBlockedError) this.set({ busy: null, error: error.reasons.join(' ') });
    else if (error instanceof StaleDraftError) this.set({ busy: null, error: error.message });
    else this.set({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }

  /** Appends an accept / revise / defer event. Revise replaces the draft with a linked revision draft. */
  review(candidate: ReturnedCandidate, decision: ReviewDecision, note = '', judgments: readonly ClaimJudgment[] = []): Promise<ReviewEvent | null> {
    if (this.value.busy || this.value.readOnly || this.value.unknown) return Promise.resolve(null);
    // Autosave stays scheduled: a queued flush reads the draft current at run time.
    this.set({ busy: 'reviewing', error: null });
    return this.enqueue(async () => {
      try {
        const result = await this.store.recordReview({ requestId: this.value.requestId, candidate, decision, note, judgments, active: this.value.draft });
        const known = this.value.candidates.some((item) => item.candidateId === candidate.candidateId);
        this.set({
          busy: null, reviews: [...this.value.reviews, result.event],
          candidates: known ? this.value.candidates : [...this.value.candidates, candidate],
          ...(result.draft ? { draft: result.draft, save: result.cleanup === 'done' ? 'saved' as const : 'unsaved' as const } : {}),
        });
        if (result.draft && result.cleanup === 'pending') this.schedule();
        return result.event;
      } catch (error) {
        this.fail(error);
        return null;
      }
    });
  }

  /** Re-reads storage after an unknown outcome. Never repeats the uncertain write. */
  reconcile(): Promise<void> {
    this.cancelTimer();
    return this.enqueue(async () => {
      this.value = this.fromSnapshot(await this.store.open(this.value.requestId));
      for (const listener of this.listeners) listener(this.value);
    });
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }
}
