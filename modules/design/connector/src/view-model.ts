/** Framework-free presentation model for the connector UI. All user-facing copy lives here. */

import type { TransportRegistry } from './contract.ts';
import type { Attempt, AttemptState, DispatchRecord, Variance } from './dispatch.ts';
import type { EvidenceEntry } from './evidence.ts';
import type { DispatchLifecycle, LifecycleAnomaly, LifecycleStage } from './lifecycle.ts';
import type { PinnedRoute, RouteDrift } from './route-fence.ts';
import type { Destination, HostCatalog } from './host-catalog.ts';
import type { DestinationId, DispatchId } from './ids.ts';
import type { SendConfirmation } from './confirmation.ts';
import { isNoEffect, isUnresolved, latestAttempt } from './dispatch.ts';
import { FAKE_RECEIVER_LABEL, NEW_THREAD_REASON, evaluateDestination, transportQualifies } from './eligibility.ts';

export type Qualification = 'labelled-fake' | 'qualified' | 'not-qualified';

export interface DestinationRow {
  readonly destinationId: DestinationId;
  readonly label: string;
  readonly modeLabel: string;
  readonly transportLabel: string;
  readonly identityLabel: string;
  readonly freshnessLabel: string;
  readonly reachabilityLabel: string;
  readonly qualification: Qualification;
  readonly qualificationLabel: string;
  readonly selectable: boolean;
  readonly disabledReason: string | null;
  readonly identityConflict: boolean;
}

export function shortDigest(value: string): string {
  const hex = value.startsWith('sha256:') ? value.slice(7) : value;
  return hex.length > 12 ? `${hex.slice(0, 12)}…` : hex;
}

function qualificationOf(destination: Destination, transports: TransportRegistry): Qualification {
  const transport = transports[destination.endpoint.transport];
  if (!transportQualifies(transport, destination.endpoint.transport)) return 'not-qualified';
  return transport.descriptor.qualification.level === 'labelled-fake' ? 'labelled-fake' : 'qualified';
}

const QUALIFICATION_LABEL: Readonly<Record<Qualification, string>> = {
  'labelled-fake': 'Labelled fake',
  qualified: 'Qualified',
  'not-qualified': 'Not qualified',
};

export function destinationRow(destination: Destination, transports: TransportRegistry): DestinationRow {
  const eligibility = evaluateDestination(destination, transports);
  const qualification = qualificationOf(destination, transports);
  const { identity, freshness } = destination;
  return {
    destinationId: destination.destinationId,
    label: destination.label,
    modeLabel: destination.mode === 'new-thread' ? 'New thread' : 'Existing thread',
    transportLabel: destination.endpoint.transport === 'fake-receiver' ? FAKE_RECEIVER_LABEL : 'Jones Code',
    identityLabel: `${identity.receiverId} · ${shortDigest(identity.fingerprint)} on ${identity.hostId}`,
    freshnessLabel: freshness.lastSuccessAt
      ? `${freshness.status} · checked ${freshness.lastSuccessAt}`
      : `${freshness.status} · never checked`,
    reachabilityLabel: destination.status,
    qualification,
    qualificationLabel: QUALIFICATION_LABEL[qualification],
    selectable: eligibility.eligible,
    disabledReason: eligibility.eligible ? null : eligibility.reason,
    identityConflict: destination.identityConflict !== undefined,
  };
}

export function destinationRows(catalog: HostCatalog, transports: TransportRegistry): readonly DestinationRow[] {
  return catalog.destinations.map((destination) => destinationRow(destination, transports));
}

export interface NewThreadControl {
  readonly enabled: boolean;
  readonly destinationId?: DestinationId;
  readonly label: string;
  readonly reason: string;
}

/** Selection only: eligibility still requires declared modes and qualification. */
export function newThreadControl(rows: readonly DestinationRow[] = []): NewThreadControl {
  const row = rows.find((item) => item.selectable && item.modeLabel === 'New thread');
  if (row) return { enabled: true, destinationId: row.destinationId, label: 'Start a new thread', reason: 'Select this destination; sending needs a separate confirmation.' };
  return { enabled: false, label: 'Start a new thread', reason: NEW_THREAD_REASON };
}

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

const STATE_COPY: Readonly<Record<AttemptState, { readonly label: string; readonly tone: Tone; readonly explanation: string }>> = {
  submitting: {
    label: 'Sending',
    tone: 'progress',
    explanation: 'HQ recorded this attempt and is handing it to the receiver.',
  },
  accepted: {
    label: 'Accepted by receiver',
    tone: 'success',
    explanation: 'The receiver durably accepted the handoff. This does not mean the work is complete or approved.',
  },
  held: {
    label: 'Held by receiver',
    tone: 'warning',
    explanation: 'The receiver has the handoff but is holding it. Check status to see whether it is accepted.',
  },
  rejected: {
    label: 'Rejected by receiver',
    tone: 'danger',
    explanation: 'The receiver refused the handoff, so it had no effect. You can confirm a new attempt.',
  },
  unknown: {
    label: 'Effect unknown',
    tone: 'danger',
    explanation: 'HQ cannot tell whether the receiver got this handoff. It will not resend. Check status reads the receiver without sending.',
  },
  blocked: {
    label: 'Blocked before sending',
    tone: 'warning',
    explanation: 'HQ stopped before sending, so nothing reached the receiver.',
  },
  'no-effect': {
    label: 'No effect confirmed',
    tone: 'neutral',
    explanation: 'The receiver confirmed it never took this handoff. You can confirm a new attempt.',
  },
};

const VARIANCE_COPY: Readonly<Record<Variance, string>> = {
  'host-mismatch': 'Receiver reported a different host than the one you chose.',
  'receiver-mismatch': 'A different receiver answered than the one you chose.',
  'model-mismatch': 'Receiver reported a different model than the pinned one.',
  'provenance-mismatch': 'Receipt provenance does not match the transport.',
};

export interface DispatchStatusView {
  readonly dispatchId: DispatchId;
  readonly state: AttemptState;
  readonly stateLabel: string;
  readonly tone: Tone;
  readonly explanation: string;
  readonly reason: string | null;
  readonly attemptLabel: string;
  readonly fake: boolean;
  readonly varianceLabels: readonly string[];
  readonly canCheckStatus: boolean;
  readonly canConfirmNewAttempt: boolean;
  readonly lastCheckedLabel: string | null;
}

export function dispatchStatus(record: DispatchRecord): DispatchStatusView | null {
  const attempt: Attempt | null = latestAttempt(record);
  if (!attempt) return null;
  const copy = STATE_COPY[attempt.state];
  return {
    dispatchId: record.dispatchId,
    state: attempt.state,
    stateLabel: copy.label,
    tone: attempt.variances.length > 0 ? 'danger' : copy.tone,
    explanation: copy.explanation,
    reason: attempt.reason,
    attemptLabel: `Attempt ${attempt.ordinal}`,
    fake: record.destination.transport === 'fake-receiver' || attempt.receipt?.provenance === 'fake',
    varianceLabels: attempt.variances.map((variance) => VARIANCE_COPY[variance]),
    canCheckStatus: isUnresolved(attempt.state) || attempt.state === 'held',
    canConfirmNewAttempt: isNoEffect(attempt.state),
    lastCheckedLabel: attempt.lastReadbackAt ? `Last checked ${attempt.lastReadbackAt} (${attempt.readbacks}×)` : null,
  };
}

export interface ConfirmationView {
  readonly destinationLabel: string;
  readonly identityLabel: string;
  readonly packetLabel: string;
  readonly fake: boolean;
}

export function confirmationView(confirmation: SendConfirmation, destination: Destination): ConfirmationView {
  return {
    destinationLabel: destination.label,
    identityLabel: `${confirmation.receiverId} · ${shortDigest(confirmation.fingerprint)} on ${confirmation.hostId}`,
    packetLabel: `${confirmation.packetId} · ${shortDigest(confirmation.packetDigest)}`,
    fake: destination.endpoint.transport === 'fake-receiver',
  };
}

export interface EvidenceRow {
  readonly evidenceId: string;
  readonly summary: string;
  readonly claimLabel: string;
  readonly provenanceLabel: string;
  readonly executionLabel: string;
  readonly packetLabel: string;
  readonly fake: boolean;
}

export function evidenceRow(entry: EvidenceEntry): EvidenceRow {
  const { evidence } = entry;
  return {
    evidenceId: evidence.evidenceId,
    summary: evidence.candidate.summary,
    claimLabel: evidence.claimLevel === 'observed' ? 'Observed by receiver' : 'Reported by agent',
    provenanceLabel: entry.fake ? 'Fake evidence — from the labelled fake receiver' : 'From Jones',
    executionLabel: `${evidence.execution.status} · observed ${evidence.execution.observedAt}`,
    packetLabel: `${evidence.packet.packetId} · ${shortDigest(evidence.packet.packetDigest)}`,
    fake: entry.fake,
  };
}

// ── Lifecycle and pinned route ───────────────────────────────────────────────

const STAGE_COPY: Readonly<Record<LifecycleStage, { readonly label: string; readonly tone: Tone; readonly explanation: string }>> = {
  'not-sent': { label: 'Not sent', tone: 'neutral', explanation: 'Nothing has been handed to a receiver.' },
  submitting: { label: 'Sending', tone: 'progress', explanation: 'HQ recorded this attempt and is handing it to the receiver.' },
  unknown: { label: 'Effect unknown', tone: 'danger', explanation: 'HQ cannot tell whether the receiver got this handoff. It will not resend; check status reads without sending.' },
  held: { label: 'Held by receiver', tone: 'warning', explanation: 'The receiver has the handoff but is holding it. It has not started.' },
  queued: { label: 'Queued at receiver', tone: 'progress', explanation: 'The receiver accepted the handoff. No run has been reported yet.' },
  running: { label: 'Running', tone: 'progress', explanation: 'The receiver reports the work is running. This is its report, not an HQ check.' },
  returned: { label: 'Returned', tone: 'success', explanation: 'The receiver reports returned work. Review it; returned is not approved.' },
  failed: { label: 'Failed', tone: 'danger', explanation: 'The receiver reports the run failed. Revising or sending again needs your decision.' },
  cancelled: { label: 'Cancelled', tone: 'warning', explanation: 'The receiver reports the run was cancelled.' },
};

const RESOLUTION_LABEL: Readonly<Record<'rejected' | 'blocked' | 'no-effect', string>> = {
  rejected: 'Not sent — receiver rejected it',
  blocked: 'Not sent — blocked before sending',
  'no-effect': 'Not sent — receiver confirmed no effect',
};

const ANOMALY_COPY: Readonly<Record<LifecycleAnomaly, string>> = {
  'evidence-while-held': 'Evidence arrived while the receiver still holds the handoff; the stage stays Held until the receiver accepts it.',
  'conflicting-terminal-evidence': 'The receiver reported conflicting final outcomes. The latest is shown; check with the receiver.',
  'route-variance': 'The receiver answered from a different host, receiver or model than the one you chose.',
  'route-drift': 'The destination in the catalog no longer matches the route this request is pinned to.',
};

const DRIFT_COPY: Readonly<Record<RouteDrift, string>> = {
  'destination-missing': 'destination no longer listed',
  destination: 'destination changed',
  mode: 'thread mode changed',
  host: 'host changed',
  receiver: 'receiver changed',
  fingerprint: 'fingerprint changed',
  endpoint: 'endpoint changed',
  thread: 'thread changed',
  model: 'pinned model changed',
};

export interface LifecycleView {
  readonly stage: LifecycleStage;
  readonly stageLabel: string;
  readonly tone: Tone;
  readonly explanation: string;
  readonly executionLabel: string | null;
  readonly evidenceLabel: string | null;
  readonly sendLabel: string;
  /** The receiver holds the handoff and has not reported a final outcome: offer a read-only poll. */
  readonly canCheckForResults: boolean;
  readonly routeAcknowledgementLabel: string | null;
  readonly anomalyLabels: readonly string[];
  readonly fake: boolean;
}

export function lifecycleView(lifecycle: DispatchLifecycle): LifecycleView {
  const copy = STAGE_COPY[lifecycle.stage];
  const latest = lifecycle.evidence.latest;
  const sendLabel = lifecycle.send.status === 'open' ? (lifecycle.routeHistory.acknowledgementRequired ? 'Ready to send after you confirm and acknowledge the earlier handoff.' : 'Ready to send after you confirm.')
    : lifecycle.send.status === 'needs-fresh-confirmation' ? 'A new attempt needs a fresh confirmation made after the last result.'
      : lifecycle.send.code === 'unresolved-attempt' ? 'Send is fenced: the last attempt has an unknown effect.'
        : 'Send is fenced: the receiver already has this request.';
  return {
    stage: lifecycle.stage,
    stageLabel: lifecycle.stage === 'not-sent' && lifecycle.resolution !== 'none' ? RESOLUTION_LABEL[lifecycle.resolution] : copy.label,
    tone: lifecycle.anomalies.includes('route-variance') ? 'danger' : copy.tone,
    explanation: copy.explanation,
    executionLabel: latest ? `${latest.execution} · ${latest.claimLevel === 'observed' ? 'observed by receiver' : 'reported by agent'} · ${latest.observedAt}` : null,
    evidenceLabel: lifecycle.evidence.counted > 0
      ? `${lifecycle.evidence.counted} evidence record${lifecycle.evidence.counted === 1 ? '' : 's'}${lifecycle.evidence.ignored.length > 0 ? `, ${lifecycle.evidence.ignored.length} ignored` : ''}`
      : lifecycle.evidence.ignored.length > 0 ? `${lifecycle.evidence.ignored.length} evidence record${lifecycle.evidence.ignored.length === 1 ? '' : 's'} ignored (do not match this handoff)` : null,
    sendLabel,
    canCheckForResults: lifecycle.stage === 'queued' || lifecycle.stage === 'running',
    routeAcknowledgementLabel: lifecycle.routeHistory.acknowledgementRequired
      ? 'This request was already handed off another way. Sending here needs your explicit acknowledgement.' : null,
    anomalyLabels: lifecycle.anomalies.map((anomaly) => ANOMALY_COPY[anomaly]),
    fake: lifecycle.fake,
  };
}

export interface RouteView {
  readonly pinnedLabel: string;
  readonly hostLabel: string;
  readonly receiverLabel: string;
  readonly modelLabel: string;
  readonly observedLabel: string | null;
  readonly freshnessLabel: string;
  readonly fallbackLabel: string;
  readonly driftLabels: readonly string[];
}

export function routeView(route: PinnedRoute): RouteView {
  const freshness = route.freshness;
  return {
    pinnedLabel: route.source === 'dispatch-binding' ? 'Pinned to this route' : 'Chosen route (pinned when you confirm)',
    hostLabel: route.hostId,
    receiverLabel: `${route.receiverId} · ${shortDigest(route.fingerprint)}`,
    modelLabel: route.model ? `${route.model.provider}/${route.model.model} (pinned)` : 'No model pinned — HQ makes no model claim',
    observedLabel: route.observed
      ? `Receiver reported ${route.observed.hostId} · ${route.observed.receiverId} · ${route.observed.model ? `${route.observed.model.provider}/${route.observed.model.model}` : 'no model reported'}`
      : null,
    freshnessLabel: freshness.status === 'unobserved' ? 'Freshness not checked' : freshness.lastSuccessAt ? `${freshness.status} · checked ${freshness.lastSuccessAt}` : `${freshness.status} · never checked`,
    fallbackLabel: 'No fallback: HQ never switches host or model.',
    driftLabels: route.drift.map((drift) => DRIFT_COPY[drift]),
  };
}
