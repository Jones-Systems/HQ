import { createConnectorController, type ConnectorController } from '../../../connector/src/controller.ts';
import { latestAttempt } from '../../../connector/src/dispatch.ts';
import { intakeEvidence, type EvidenceEntry } from '../../../connector/src/evidence.ts';
import { createFakeReceiver, syntheticCatalog, syntheticDestination, syntheticEvidence, syntheticIdentity } from '../../../connector/src/fakes.ts';
import type { HostCatalog } from '../../../connector/src/host-catalog.ts';
import type { DispatchId } from '../../../connector/src/ids.ts';
import { dispatchLifecycle } from '../../../connector/src/lifecycle.ts';
import { createOutbox, type Outbox, type SubmitResult } from '../../../connector/src/outbox.ts';
import {
  HANDOFF_STATUS_SCHEMA, type DecisionPacket, type HandoffStatus, type PacketId, type ReturnedCandidate,
} from '../../../requests/src/contract.ts';
import { RequestSession } from '../../../requests/src/session.ts';
import { parseReturnedCandidate } from '../../../requests/src/validate.ts';
import type { RunsEnvironmentOptions } from './env.ts';
import { toConnectorPacket, verifyPacket } from './verify-packet.ts';

export const SIMULATION_LABEL = 'Simulated — nothing sent';
export const SIMULATED_DESTINATION = Object.freeze({
  kind: 'existing-thread' as const, destinationId: syntheticDestination().destinationId, label: SIMULATION_LABEL,
});

export interface RunsPipeline {
  readonly controller: ConnectorController;
  readonly catalog: HostCatalog;
  freeze(session: RequestSession): Promise<DecisionPacket | null>;
  selectPacket(session: RequestSession, packetId: PacketId): Promise<void>;
  confirm(): Promise<SubmitResult | null>;
  refresh(session: RequestSession): Promise<void>;
  simulateReturn(session: RequestSession, dispatchId: DispatchId): Promise<ReturnedCandidate | null>;
  reportOwnerReturn(
    session: RequestSession, input: Parameters<RequestSession['reportReturn']>[0],
  ): ReturnType<RequestSession['reportReturn']>;
  review(session: RequestSession, ...args: Parameters<RequestSession['review']>): ReturnType<RequestSession['review']>;
}

/** No connector return here is real: this composition registers only the labelled fake. */
export function returnCounts(candidates: readonly ReturnedCandidate[]) {
  return {
    simulated: candidates.filter((item) => item.provenance?.origin !== 'owner-reported').length,
    ownerReported: candidates.filter((item) => item.provenance?.origin === 'owner-reported').length,
    realVerified: 0 as const,
  };
}

function candidateFrom(entry: EvidenceEntry, packet: DecisionPacket): ReturnedCandidate {
  const id = `sim.${entry.digest.slice('sha256:'.length)}`;
  const evidence = entry.evidence;
  return parseReturnedCandidate({
    candidateId: id,
    packet: { packetId: packet.packetId, authoringDigest: packet.authoringDigest },
    baselineVersionId: packet.sources[0]!.versionId,
    candidateVersionId: null,
    claims: [{
      claimId: `${id}.claim`, text: `${SIMULATION_LABEL}. ${evidence.candidate.summary}`,
      level: 'agent-reported', evidence: [],
    }],
    observedStatus: SIMULATION_LABEL,
    observedAt: evidence.execution.observedAt,
    evidence: [{ evidenceId: `${id}.evidence`, kind: 'note', label: SIMULATION_LABEL, digest: entry.digest }],
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
  const destination = syntheticDestination({ label: SIMULATION_LABEL });
  const catalog: HostCatalog = Object.freeze({
    ...syntheticCatalog(), destinations: Object.freeze([destination]),
  });
  const receiver = createFakeReceiver({ clock, identity: syntheticIdentity() });
  // A fresh receiver has no knowledge of the old process. Absence can never clear an unknown effect.
  receiver.setLookupMode('absence-only');
  const transports = { 'fake-receiver': receiver };
  const outbox = createOutbox({
    store: options.outboxStore, clock, transports, sessionId: options.ids.next('connector-session'), verifyPacket,
  });
  await outbox.recover();
  let selected: RequestSession | null = null;
  let submitting = false;

  const refused = (reason: string): SubmitResult =>
    ({ outcome: 'refused', code: 'packet-invalid', reason, dispatchId: null });

  async function refresh(session: RequestSession): Promise<void> {
    const statuses = new Map<PacketId, HandoffStatus>();
    const candidates: ReturnedCandidate[] = [];
    for (const packet of session.state.packets) {
      const dispatchId = await outbox.dispatchIdFor(await toConnectorPacket(packet), destination);
      const record = await outbox.get(dispatchId);
      if (!record) continue;
      const entries = await options.evidenceStore.listByDispatch(dispatchId);
      const lifecycle = dispatchLifecycle(record, entries, { catalogDestination: destination });
      const attempt = latestAttempt(record);
      const receipt = attempt?.receipt;
      const model = record.destination.model;
      const status: HandoffStatus = {
        schema: HANDOFF_STATUS_SCHEMA,
        packet: { packetId: packet.packetId, authoringDigest: packet.authoringDigest },
        state: lifecycle.stage,
        observedAt: lifecycle.updatedAt ?? record.updatedAt,
        destination: { destinationId: destination.destinationId, label: SIMULATION_LABEL },
        pinned: { host: record.destination.hostId, ...(model ? { model: `${model.provider}/${model.model}` } : {}) },
        actual: {
          ...(receipt ? { host: receipt.observedHostId } : {}),
          ...(receipt?.observedModel ? { model: `${receipt.observedModel.provider}/${receipt.observedModel.model}` } : {}),
        },
        detail: SIMULATION_LABEL,
      };
      statuses.set(packet.packetId, status);
      const ignored = new Set(lifecycle.evidence.ignored.map((item) => item.evidenceId));
      for (const entry of entries) {
        if (!entry.fake || entry.evidence.provenance !== 'fake' || ignored.has(entry.evidence.evidenceId)
          || entry.evidence.execution.status !== 'completed') continue;
        candidates.push(candidateFrom(entry, packet));
      }
    }
    // These lane readback methods serialize writes without replacing an unsaved editor draft.
    await session.refreshHandoff({ read: async (link) => statuses.get(link.packetId) ?? null });
    await session.refreshReturns({ list: async () => candidates });
  }

  // Every controller confirmation uses this facade, including confirmations initiated by the panel.
  const guarded: Outbox = {
    ...outbox,
    // The simulated receiver has no independent durable ledger. Readback never clears an unknown.
    reconcile: async () => outbox.recover(),
    async submit(request) {
      const session = selected;
      if (submitting || !session) return refused('Select a request before confirming.');
      submitting = true;
      try {
        if (request.destination.destinationId !== destination.destinationId || !await verifyPacket(request.packet)) {
          return refused('Only a verified packet for the simulated destination is allowed.');
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
        await refresh(session);
        return result;
      } catch (error) {
        return {
          outcome: 'persist-failed',
          dispatchId: await outbox.dispatchIdFor(request.packet, destination),
          reason: `Outcome unknown. Read saved state; do not resend. ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        submitting = false;
      }
    },
  };
  const controller = createConnectorController({
    outbox: guarded, transports, clock, evidence: options.evidenceStore, getCatalog: () => catalog,
    newConfirmationId: () => options.ids.next('confirmation'),
  });

  return {
    controller, catalog,
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
      await controller.select(destination.destinationId);
    },
    confirm: () => controller.confirm(),
    async refresh(session) {
      await refresh(session);
      await controller.refresh();
    },
    async simulateReturn(session, dispatchId) {
      const record = await outbox.get(dispatchId);
      const attempt = record ? latestAttempt(record) : null;
      if (!record || attempt?.state !== 'accepted' || !attempt.receipt
        || record.destination.destinationId !== destination.destinationId || attempt.receipt.provenance !== 'fake') return null;
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
