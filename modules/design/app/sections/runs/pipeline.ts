import { createConnectorController, type ConnectorController } from '../../../connector/src/controller.ts';
import { latestAttempt } from '../../../connector/src/dispatch.ts';
import { intakeEvidence, type EvidenceEntry } from '../../../connector/src/evidence.ts';
import { createFakeReceiver, syntheticCatalog, syntheticDestination, syntheticEvidence, syntheticIdentity } from '../../../connector/src/fakes.ts';
import { evaluateDestination, transportQualifies } from '../../../connector/src/eligibility.ts';
import { readbackEvidence } from '../../../connector/src/evidence-feed.ts';
import type { EvidenceReadbackRegistry, TransportRegistry } from '../../../connector/src/contract.ts';
import { HOST_CATALOG_SCHEMA, findDestination, type HostCatalog } from '../../../connector/src/host-catalog.ts';
import { brandId, type DispatchId } from '../../../connector/src/ids.ts';
import { dispatchLifecycle } from '../../../connector/src/lifecycle.ts';
import { createOutbox, type Outbox, type SubmitResult } from '../../../connector/src/outbox.ts';
import {
  HANDOFF_STATUS_SCHEMA, type DecisionPacket, type HandoffStatus, type PacketId, type ReturnedCandidate,
} from '../../../requests/src/contract.ts';
import { RequestSession } from '../../../requests/src/session.ts';
import { parseReturnedCandidate } from '../../../requests/src/validate.ts';
import type { RunsEnvironmentOptions } from './env.ts';
import { toConnectorPacket, verifyPacket } from './verify-packet.ts';

export const DISCONNECTED_LABEL = 'Not connected — nothing sent';
export const AGENT_REPORTED_LABEL = 'Agent-reported — not independently verified';
export const SIMULATION_LABEL = 'Simulated — nothing sent';
export const SIMULATED_DESTINATION = Object.freeze({
  kind: 'existing-thread' as const, destinationId: syntheticDestination().destinationId, label: SIMULATION_LABEL,
});

export interface RunsPipeline {
  readonly controller: ConnectorController;
  readonly mode: 'production' | 'example';
  readonly connectionLabel: string;
  readonly catalog: HostCatalog;
  freeze(session: RequestSession): Promise<DecisionPacket | null>;
  selectPacket(session: RequestSession, packetId: PacketId): Promise<void>;
  confirm(): Promise<SubmitResult | null>;
  refresh(session: RequestSession): Promise<void>;
  readStatus(session: RequestSession, packetId: PacketId): Promise<HandoffStatus | null>;
  simulateReturn(session: RequestSession, dispatchId: DispatchId): Promise<ReturnedCandidate | null>;
  reportOwnerReturn(
    session: RequestSession, input: Parameters<RequestSession['reportReturn']>[0],
  ): ReturnType<RequestSession['reportReturn']>;
  review(session: RequestSession, ...args: Parameters<RequestSession['review']>): ReturnType<RequestSession['review']>;
}

/** Connector reports are not independent verification, even through a qualified transport. */
export function returnCounts(candidates: readonly ReturnedCandidate[]) {
  return {
    simulated: candidates.filter((item) => item.provenance?.origin !== 'owner-reported' && item.observedStatus === SIMULATION_LABEL).length,
    agentReported: candidates.filter((item) => item.provenance?.origin !== 'owner-reported' && item.observedStatus !== SIMULATION_LABEL).length,
    ownerReported: candidates.filter((item) => item.provenance?.origin === 'owner-reported').length,
    realVerified: 0 as const,
  };
}

function candidateFrom(entry: EvidenceEntry, packet: DecisionPacket): ReturnedCandidate {
  const label = entry.fake ? SIMULATION_LABEL : AGENT_REPORTED_LABEL;
  const id = `${entry.fake ? 'sim' : 'connector'}.${entry.digest.slice('sha256:'.length)}`;
  const evidence = entry.evidence;
  return parseReturnedCandidate({
    candidateId: id,
    packet: { packetId: packet.packetId, authoringDigest: packet.authoringDigest },
    baselineVersionId: packet.sources[0]!.versionId,
    candidateVersionId: null,
    claims: [{
      claimId: `${id}.claim`, text: `${label}. ${evidence.candidate.summary}`,
      level: 'agent-reported', evidence: [],
    }],
    observedStatus: label,
    observedAt: evidence.execution.observedAt,
    evidence: [{ evidenceId: `${id}.evidence`, kind: 'note', label, digest: entry.digest }],
    provenance: {
      origin: 'connector', host: evidence.execution.hostId,
      ...(evidence.execution.model ? { model: `${evidence.execution.model.provider}/${evidence.execution.model.model}` } : {}),
    },
  });
}

export async function createRunsPipeline(
  options: Omit<RunsEnvironmentOptions, 'compareSlot'>,
): Promise<RunsPipeline> {
  const clock = { now: () => Date.parse(options.clock.now()) };
  const mode = options.mode ?? 'production';
  if (mode === 'example' && options.connection) throw new Error('Example mode cannot use a production connection.');
  const emptyCatalog: HostCatalog = Object.freeze({
    schema: HOST_CATALOG_SCHEMA, generation: 0, complete: true,
    observedAt: options.clock.now(), destinations: Object.freeze([]),
  });
  const exampleDestination = syntheticDestination({ label: SIMULATION_LABEL });
  const exampleCatalog: HostCatalog = Object.freeze({
    ...syntheticCatalog(), destinations: Object.freeze([exampleDestination]),
  });
  const getCatalog = () => mode === 'example' ? exampleCatalog : options.connection?.getCatalog() ?? emptyCatalog;
  let transports: TransportRegistry = {};
  if (mode === 'example') {
    const receiver = createFakeReceiver({ clock, identity: syntheticIdentity() });
    // A fresh example receiver has no durable ledger; absence cannot clear an unknown effect.
    receiver.setLookupMode('absence-only');
    transports = { 'fake-receiver': receiver };
  } else {
    const port = options.connection?.transports['jones-code'];
    if (transportQualifies(port, 'jones-code') && port.descriptor.provenance === 'jones'
      && port.descriptor.qualification.level === 'qualified') transports = { 'jones-code': port };
  }
  const readback: EvidenceReadbackRegistry = {};
  const evidencePort = options.connection?.readback?.['jones-code'];
  if (transports['jones-code'] && evidencePort?.descriptor.kind === 'jones-code'
    && evidencePort.descriptor.provenance === 'jones' && evidencePort.descriptor.qualification.level === 'qualified'
    && evidencePort.descriptor.qualification.evidenceRef.trim()) {
    Object.assign(readback, { 'jones-code': evidencePort });
  }
  const outbox = createOutbox({
    store: options.outboxStore, clock, transports, sessionId: options.ids.next('connector-session'), verifyPacket,
  });
  await outbox.recover();
  let selected: RequestSession | null = null;
  let submitting = false;

  const refused = (reason: string): SubmitResult =>
    ({ outcome: 'refused', code: 'packet-invalid', reason, dispatchId: null });

  async function readState(session: RequestSession) {
    const statuses = new Map<PacketId, HandoffStatus>();
    const candidates: ReturnedCandidate[] = [];
    const records = await outbox.list();
    for (const packet of session.state.packets) {
      const record = records.find((item) => item.packet.packetId === packet.packetId
        && item.packet.packetDigest === packet.authoringDigest
        && packet.destination.kind === 'existing-thread'
        && item.destination.destinationId === packet.destination.destinationId);
      if (!record) continue;
      const dispatchId = record.dispatchId;
      const destination = findDestination(getCatalog(), record.destination.destinationId);
      const label = record.destination.transport === 'fake-receiver' ? SIMULATION_LABEL : AGENT_REPORTED_LABEL;
      const entries = await options.evidenceStore.listByDispatch(dispatchId);
      const lifecycle = dispatchLifecycle(record, entries, { catalogDestination: destination ?? undefined });
      const attempt = latestAttempt(record);
      const receipt = attempt?.receipt;
      const model = record.destination.model;
      const status: HandoffStatus = {
        schema: HANDOFF_STATUS_SCHEMA,
        packet: { packetId: packet.packetId, authoringDigest: packet.authoringDigest },
        state: lifecycle.stage,
        observedAt: lifecycle.updatedAt ?? record.updatedAt,
        destination: { destinationId: record.destination.destinationId, label: record.destination.transport === 'fake-receiver' ? SIMULATION_LABEL : destination?.label ?? record.destination.destinationId },
        pinned: { host: record.destination.hostId, ...(model ? { model: `${model.provider}/${model.model}` } : {}) },
        actual: {
          ...(receipt ? { host: receipt.observedHostId } : {}),
          ...(receipt?.observedModel ? { model: `${receipt.observedModel.provider}/${receipt.observedModel.model}` } : {}),
        },
        detail: label,
      };
      statuses.set(packet.packetId, status);
      const ignored = new Set(lifecycle.evidence.ignored.map((item) => item.evidenceId));
      for (const entry of entries) {
        if (ignored.has(entry.evidence.evidenceId)
          || entry.evidence.execution.status !== 'completed') continue;
        candidates.push(candidateFrom(entry, packet));
      }
    }
    return { statuses, candidates };
  }

  async function refresh(session: RequestSession): Promise<void> {
    const { statuses, candidates } = await readState(session);
    // These lane readback methods serialize writes without replacing an unsaved editor draft.
    await session.refreshHandoff({ read: async (link) => statuses.get(link.packetId) ?? null });
    await session.refreshReturns({ list: async () => candidates });
  }

  // Every controller confirmation uses this facade, including confirmations initiated by the panel.
  const guarded: Outbox = {
    ...outbox,
    // Only the example lacks a durable receiver ledger; production reconciliation uses qualified lookup.
    reconcile: mode === 'example' ? async () => outbox.recover() : outbox.reconcile,
    async submit(request) {
      const session = selected;
      if (submitting || !session) return refused('Select a request before confirming.');
      submitting = true;
      try {
        const destination = findDestination(getCatalog(), request.destination.destinationId);
        if (!destination || destination.mode !== 'existing-thread'
          || !evaluateDestination(destination, transports).eligible || !await verifyPacket(request.packet)) {
          return refused('Only a verified packet for a qualified existing-thread destination is allowed.');
        }
        const snapshot = await options.requests.store.open(session.state.requestId);
        const packet = snapshot.packets.find((item) => item.packetId === request.packet.packetId);
        if (!packet || packet.authoringDigest !== request.packet.packetDigest
          || packet.destination.kind !== 'existing-thread' || packet.destination.destinationId !== destination.destinationId) {
          return refused('The selected frozen packet does not match this request and destination.');
        }
        let pending: Promise<SubmitResult> | null = null;
        // RequestSession writes the T6 record before invoking this synchronous handoff callback.
        // The awaited T12 work remains here; a void DispatchSlot never stands in for a receipt.
        const handed = await session.send({
          requestSend: () => { pending = outbox.submit({ ...request, destination }); },
        }, packet.packetId, destination.destinationId);
        if (handed === 'blocked') return refused(session.state.error ?? 'The request cannot be sent.');
        if (handed === 'unknown' || !pending) return {
          outcome: 'persist-failed', dispatchId: await outbox.dispatchIdFor(request.packet, destination),
          reason: session.state.error ?? 'Unknown handoff. Do not resend.',
        };
        const result: SubmitResult = await pending;
        // The outbox result is durable; a failed lane read-back must not relabel it unknown. Refresh re-reads it.
        await refresh(session).catch(() => undefined);
        return result;
      } catch (error) {
        return {
          outcome: 'persist-failed',
          dispatchId: await outbox.dispatchIdFor(request.packet, request.destination),
          reason: `Outcome unknown. Read saved state; do not resend. ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        submitting = false;
      }
    },
  };
  const controller = createConnectorController({
    outbox: guarded, transports, clock, evidence: options.evidenceStore, getCatalog,
    readEvidence: (dispatchId) => readbackEvidence({ outbox: options.outboxStore, evidence: options.evidenceStore, readback, clock }, dispatchId),
    newConfirmationId: () => options.ids.next('confirmation'),
  });

  return {
    controller, mode,
    get catalog() { return getCatalog(); },
    get connectionLabel() {
      if (mode === 'example') return SIMULATION_LABEL;
      return getCatalog().destinations.some((item) => item.mode === 'existing-thread' && evaluateDestination(item, transports).eligible)
        ? 'Connected — explicit confirmation required' : DISCONNECTED_LABEL;
    },
    async freeze(session) {
      await session.flush();
      if (session.state.save !== 'saved') return null;
      return session.freeze();
    },
    async selectPacket(session, packetId) {
      if (submitting || controller.view().busy) throw new Error('Wait for the pending confirmation.');
      const packet = session.state.packets.find((item) => item.packetId === packetId);
      if (!packet) throw new Error('Unknown frozen packet.');
      selected = session;
      await controller.setPacket(await toConnectorPacket(packet));
      if (packet.destination.kind === 'existing-thread') await controller.select(brandId('DestinationId', packet.destination.destinationId));
    },
    confirm: () => controller.confirm(),
    async readStatus(session, packetId) {
      return (await readState(session)).statuses.get(packetId) ?? null;
    },
    async refresh(session) {
      await controller.checkStatus();
      await refresh(session);
      await controller.refresh();
    },
    async simulateReturn(session, dispatchId) {
      if (mode !== 'example') return null;
      const record = await outbox.get(dispatchId);
      const attempt = record ? latestAttempt(record) : null;
      if (!record || attempt?.state !== 'accepted' || !attempt.receipt
        || record.destination.destinationId !== exampleDestination.destinationId || attempt.receipt.provenance !== 'fake') return null;
      const snapshot = await options.requests.store.open(session.state.requestId);
      const packet = snapshot.packets.find((item) => item.packetId === record.packet.packetId
        && item.authoringDigest === record.packet.packetDigest);
      if (!packet) return null;
      const raw = syntheticEvidence({
        dispatchId, attemptId: attempt.attemptId, receipt: attempt.receipt, packet: record.packet,
        model: attempt.receipt.observedModel, evidenceId: `${dispatchId}.return`,
      });
      // No synthetic screenshot or version is presented as an actual artifact.
      const result = await intakeEvidence({ outbox: options.outboxStore, evidence: options.evidenceStore, clock }, {
        ...raw, candidate: { ...raw.candidate, summary: SIMULATION_LABEL, artifacts: [] },
      });
      if (!result.ok) return null;
      await refresh(session);
      await controller.refresh();
      return session.state.candidates.find((item) => item.candidateId === candidateFrom(result.entry, packet).candidateId) ?? null;
    },
    reportOwnerReturn: (session, input) => session.reportReturn(input),
    review: (session, ...args) => session.review(...args),
  };
}
