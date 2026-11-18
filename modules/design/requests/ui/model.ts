/** Framework-free view model helpers for the requests views. */
import type { StatusTone } from '@hq/ui';
import type { DecisionPacket, HandoffState, ReturnedCandidate, ReviewDecision } from '../src/contract.ts';
import { openClarifications, sameContent } from '../src/draft.ts';
import type { HandoffView } from '../src/handoff.ts';
import { inboxOf, unreviewedCount, type InboxItem } from '../src/inbox.ts';
import type { SessionState } from '../src/session.ts';

export const STEPS = ['Draft', 'Clarify', 'Freeze', 'Review'] as const;
export type Step = (typeof STEPS)[number];

export interface StepProgress {
  readonly current: Step;
  /** Steps that are done; always the steps before `current`, plus Review once every return has a decision. */
  readonly completed: readonly Step[];
  readonly index: number;
  /** One short line about where the request stands, or null. */
  readonly detail: string | null;
}

/** Where the request is in draft → clarify → freeze → review, and which steps are behind it. */
export function stepProgress(state: SessionState, candidate: ReturnedCandidate | null): StepProgress {
  const draft = state.draft;
  const head = state.packets.at(-1) ?? null;
  const reviewing = candidate !== null && state.packets.some((packet) => packet.packetId === candidate.packet.packetId);
  const items = inboxOf(state.candidates, state.reviews);
  const waiting = unreviewedCount(items);
  // A draft is work in progress while it would still produce a new packet.
  const pending = draft !== null && (head === null || !sameContent(draft, head));
  let current: Step;
  if (reviewing) current = 'Review';
  else if (pending && draft) {
    if (draft.title.trim() === '' || draft.intent.trim() === '' || draft.sources.length === 0) current = 'Draft';
    else if (openClarifications(draft).length > 0) current = 'Clarify';
    else current = state.blockers.length === 0 ? 'Freeze' : 'Draft';
  } else current = head ? 'Review' : 'Draft';

  const index = STEPS.indexOf(current);
  const completed: Step[] = STEPS.slice(0, index);
  const allReviewed = head !== null && items.length > 0 && waiting === 0;
  if (current === 'Review' && allReviewed) completed.push('Review');
  let detail: string | null = null;
  if (current === 'Clarify' && draft) detail = `${openClarifications(draft).length} open`;
  else if (current === 'Review') {
    if (waiting > 0) detail = `${waiting} to review`;
    else if (allReviewed) detail = 'All reviewed';
    else if (head) detail = 'Waiting for returned work';
  }
  return { current, completed, index, detail };
}

/** Where the request is, for callers that only need the current step. */
export function currentStep(state: SessionState, candidate: ReturnedCandidate | null): Step {
  return stepProgress(state, candidate).current;
}

export interface RequestStatus {
  readonly kind: 'draft' | 'frozen' | 'returned';
  /** Draft, Frozen or Returned n. */
  readonly label: string;
  readonly tone: StatusTone;
}

export function requestStatus(state: SessionState): RequestStatus {
  if (state.candidates.length > 0) return { kind: 'returned', label: `Returned ${state.candidates.length}`, tone: 'success' };
  if (state.packets.length > 0) return { kind: 'frozen', label: 'Frozen', tone: 'info' };
  return { kind: 'draft', label: 'Draft', tone: 'neutral' };
}

export function requestTitle(state: SessionState): string {
  return state.draft?.title.trim() || state.packets.at(-1)?.title.trim() || 'Untitled request';
}

/** The second line of a request row. */
export function requestMeta(state: SessionState): string {
  const waiting = unreviewedCount(inboxOf(state.candidates, state.reviews));
  if (state.candidates.length > 0) return waiting > 0 ? `${waiting} to review` : 'All reviewed';
  const head = state.packets.at(-1);
  if (head) return `Packet #${head.lineage.sequence} frozen · waiting for returned work`;
  const sources = state.draft?.sources.length ?? 0;
  return `Not frozen yet · ${sources} source version${sources === 1 ? '' : 's'}`;
}

/** The earliest time the request is known to have existed, for ordering a list newest first. */
export function requestAge(state: SessionState): number {
  const stamp = state.packets[0]?.frozenAt ?? state.draft?.createdAt ?? '';
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Why a request cannot be changed right now, or null. */
export function holdReason(state: SessionState): string | null {
  if (state.readOnly) return `Opened read-only. ${state.readOnly}`;
  if (state.unknown) return 'An earlier result is unknown. Reconcile before making changes.';
  if (state.busy) return 'Wait for the current change to finish.';
  return null;
}

export const NO_SOURCE_REVISION_REASON =
  "No source revision yet — versions created by hand can't be sent; capture one from a source project";

export const DECISION_LABELS: Readonly<Record<ReviewDecision, string>> = {
  accept: 'Accepted', revise: 'Revised', defer: 'Deferred', reject: 'Rejected',
};

export type ReturnProvenance = 'simulated' | 'agent-reported' | 'owner-reported';

export const PROVENANCE_LABELS: Readonly<Record<ReturnProvenance, string>> = {
  simulated: 'Simulated', 'agent-reported': 'Agent-reported', 'owner-reported': 'Owner-reported',
};

/** How a return got here. A connector report is never native verification, simulated or not. */
export function returnProvenance(candidate: ReturnedCandidate, simulationLabel: string | null): ReturnProvenance {
  if (candidate.provenance?.origin === 'owner-reported') return 'owner-reported';
  return simulationLabel !== null && candidate.observedStatus === simulationLabel ? 'simulated' : 'agent-reported';
}

export function handoffTone(state: HandoffState): StatusTone {
  switch (state) {
    case 'not-sent': case 'cancelled': return 'neutral';
    case 'unknown': return 'unknown';
    case 'held': return 'warning';
    case 'returned': return 'success';
    case 'failed': return 'danger';
    case 'submitting': case 'queued': case 'running': return 'info';
  }
}

/** True while the connector is still working, so the indicator can show it. */
export function handoffBusy(state: HandoffState): boolean {
  return state === 'submitting' || state === 'running';
}

export interface TimelineStage {
  readonly id: 'frozen' | 'handed-off' | 'working' | 'returned';
  readonly label: string;
  readonly status: 'done' | 'current' | 'upcoming' | 'problem';
}

export interface Timeline {
  readonly stages: readonly TimelineStage[];
  /** Index of the furthest stage reached; drives the progress fill. */
  readonly position: number;
}

/** Frozen → Sent (or Simulated) → In progress → Returned, from the combined handoff state. */
export function handoffTimeline(view: HandoffView, simulated: boolean): Timeline {
  const handedLabel = simulated ? 'Simulated' : 'Sent';
  const state = view.state;
  const handed: TimelineStage['status'] = state === 'not-sent' ? 'upcoming' : state === 'submitting' ? 'current'
    : state === 'unknown' ? 'problem' : 'done';
  const workingLabel = state === 'queued' ? 'Queued' : state === 'held' ? 'Held' : state === 'running' ? 'Running' : 'In progress';
  const working: TimelineStage['status'] = state === 'queued' || state === 'held' || state === 'running' ? 'current'
    : state === 'returned' || state === 'failed' || state === 'cancelled' ? 'done' : 'upcoming';
  const final: Pick<TimelineStage, 'label' | 'status'> = state === 'returned' ? { label: 'Returned', status: 'done' }
    : state === 'failed' ? { label: 'Failed', status: 'problem' }
      : state === 'cancelled' ? { label: 'Cancelled', status: 'problem' } : { label: 'Returned', status: 'upcoming' };
  const stages: TimelineStage[] = [
    { id: 'frozen', label: 'Frozen', status: 'done' },
    { id: 'handed-off', label: handedLabel, status: handed },
    { id: 'working', label: workingLabel, status: working },
    { id: 'returned', ...final },
  ];
  let position = 0;
  stages.forEach((stage, index) => { if (stage.status !== 'upcoming') position = index; });
  return { stages, position };
}

export function saveLabel(state: SessionState): string {
  if (state.readOnly) return 'Read-only';
  if (state.unknown) return 'Outcome unknown';
  switch (state.save) {
    case 'saved': return state.savedAt ? `Saved locally ${time(state.savedAt)}` : 'Saved locally';
    case 'unsaved': return 'Unsaved changes';
    case 'saving': return 'Saving…';
    case 'error': return 'Not saved';
  }
}

export function saveTone(state: SessionState): StatusTone {
  if (state.readOnly || state.unknown) return 'unknown';
  switch (state.save) {
    case 'saved': return 'success';
    case 'error': return 'danger';
    case 'unsaved': case 'saving': return 'neutral';
  }
}

function time(iso: string): string { return iso.slice(11, 16); }

/** "2026-01-01 00:55 UTC", the one date format these views show. */
export function utc(iso: string): string { return `${iso.slice(0, 16).replace('T', ' ')} UTC`; }

export function shortDigest(digest: string): string {
  return digest.startsWith('sha256:') ? `sha256:${digest.slice(7, 19)}` : digest;
}

export function headPacket(state: SessionState): DecisionPacket | null { return state.packets.at(-1) ?? null; }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export type { InboxItem };
