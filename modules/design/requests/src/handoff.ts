import type {
  DecisionPacket, HandoffState, HandoffStatus, HostModel, ReturnedCandidate, SendRecord,
} from './contract.ts';

/** States the connector will not move out of. A stale or older reading can never reopen them. */
export const TERMINAL_STATES: readonly HandoffState[] = ['returned', 'failed', 'cancelled'];

export const HANDOFF_LABELS: Readonly<Record<HandoffState, string>> = {
  'not-sent': 'Not sent',
  submitting: 'Submitting',
  unknown: 'Unknown — do not resend',
  queued: 'Queued',
  held: 'Held',
  running: 'Running',
  returned: 'Returned',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Default age after which a non-terminal status is shown as stale. */
export const STALE_AFTER_MS = 60_000;

export type FieldVariance = 'match' | 'differs' | 'unpinned' | 'unreported';

export interface HostModelVariance {
  readonly host: FieldVariance;
  readonly model: FieldVariance;
  /** True when the receiver reports a host or model other than the pinned one. */
  readonly varies: boolean;
}

function field(pinned: string | undefined, actual: string | undefined): FieldVariance {
  if (pinned === undefined) return 'unpinned';
  if (actual === undefined) return 'unreported';
  return pinned === actual ? 'match' : 'differs';
}

/**
 * Compares the pinned host/model with what the receiver reported. Only values
 * present in the status are used: a missing value is never replaced by a default.
 */
export function hostModelVariance(pinned: HostModel | undefined, actual: HostModel | undefined): HostModelVariance {
  const host = field(pinned?.host, actual?.host);
  const model = field(pinned?.model, actual?.model);
  return { host, model, varies: host === 'differs' || model === 'differs' };
}

export type Freshness = 'fresh' | 'stale' | 'none';

export function freshnessOf(status: HandoffStatus | null, now: string, maxAgeMs = STALE_AFTER_MS): Freshness {
  if (!status) return 'none';
  if (TERMINAL_STATES.includes(status.state)) return 'fresh';
  return Date.parse(now) - Date.parse(status.observedAt) > maxAgeMs ? 'stale' : 'fresh';
}

export interface HandoffViewInput {
  readonly packet: DecisionPacket;
  readonly isHead: boolean;
  readonly send: SendRecord | null;
  readonly status: HandoffStatus | null;
  readonly candidates: readonly ReturnedCandidate[];
  readonly now: string;
  /** True only for a send whose transport call returned in this session. */
  readonly handedThisSession?: boolean;
  readonly maxAgeMs?: number;
}

export interface HandoffView {
  readonly packetId: DecisionPacket['packetId'];
  readonly state: HandoffState;
  readonly label: string;
  readonly status: HandoffStatus | null;
  readonly send: SendRecord | null;
  readonly freshness: Freshness;
  readonly variance: HostModelVariance;
  readonly ownerReportedReturns: number;
  readonly canSend: boolean;
  /** Why a send is not available; empty when it is. */
  readonly blockers: readonly string[];
}

/**
 * One packet's combined handoff state. A durable send record without a
 * connector status reads as unknown after a restart, never as not-sent, so the
 * fence survives a lost transport result.
 */
export function handoffView(input: HandoffViewInput): HandoffView {
  const { packet, send, status } = input;
  const ownerReportedReturns = input.candidates.filter((item) => item.packet.packetId === packet.packetId && item.provenance?.origin === 'owner-reported').length;
  let state: HandoffState;
  if (status && !(status.state === 'not-sent' && send)) state = status.state;
  else if (send) state = input.handedThisSession && !status ? 'submitting' : 'unknown';
  else state = 'not-sent';

  const blockers: string[] = [];
  if (!input.isHead) blockers.push('Only the current packet can be sent.');
  if (packet.destination.kind !== 'existing-thread') blockers.push('Choose a destination before sending.');
  if (send) blockers.push(state === 'unknown' ? 'Delivery is unknown. Reconcile with the connector; do not resend.' : 'Already handed off. A send is single-use.');
  else if (status && status.state !== 'not-sent') blockers.push(`The connector already reports this packet as ${HANDOFF_LABELS[status.state].toLowerCase()}.`);
  if (ownerReportedReturns > 0) blockers.push('A manual return is already recorded for this packet.');

  return {
    packetId: packet.packetId, state, label: HANDOFF_LABELS[state], status, send,
    freshness: freshnessOf(status, input.now, input.maxAgeMs),
    variance: hostModelVariance(status?.pinned, status?.actual),
    ownerReportedReturns, canSend: blockers.length === 0, blockers,
  };
}

/**
 * Whether a newly read status may replace the stored one. Older readings and
 * regressions out of a terminal state are kept out; equal-age readings are
 * accepted so a corrected detail line lands.
 */
export function acceptStatus(stored: HandoffStatus | null, next: HandoffStatus): { readonly accept: boolean; readonly reason?: string } {
  if (!stored) return { accept: true };
  if (next.observedAt < stored.observedAt) return { accept: false, reason: 'older than the stored status' };
  if (TERMINAL_STATES.includes(stored.state) && next.state !== stored.state) return { accept: false, reason: `would leave terminal state ${stored.state}` };
  return { accept: true };
}
