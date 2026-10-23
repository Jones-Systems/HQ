import { createHash } from 'node:crypto';
import type { JonesFenceOutcome, JonesHandoff, JonesIdentity, JonesLookupOutcome, JonesModel, JonesReceipt, JonesSendOutcome } from '@hq/contracts/jones-code';
import { record, keys } from '../services.js';
import type { JsonStore } from './storage.js';
import type { McpClient } from './wire.js';
export interface Binding { readonly locator: string; readonly label: string; readonly mode: 'existing-thread' | 'new-thread'; readonly projectId: string; readonly threadId?: string; readonly identity: JonesIdentity; readonly model: JonesModel | null }
export interface LedgerEntry { readonly idempotencyKey: string; readonly mode: Binding['mode']; readonly locator: string; readonly wireDigest: string; readonly sessionLabel: string; readonly handoff: JonesHandoff; readonly baseline: number; readonly receipt?: JonesReceipt; readonly runId?: string; readonly threadId?: string }
export type Ledger = Readonly<Record<string, LedgerEntry>>;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw Error('Invalid canonical value');
}
const text = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export function validHandoff(v: unknown): v is JonesHandoff {
  if (!record(v) || !keys(v, ['schema', 'dispatchId', 'attemptId', 'idempotencyKey', 'packet', 'packetBody', 'destination', 'fallback', 'confirmedAt']) || v.schema !== 'hq.design.handoff/v1' || v.fallback !== 'forbidden' || ![v.dispatchId, v.attemptId, v.idempotencyKey].every(x => text(x)) || v.idempotencyKey !== v.attemptId || typeof v.confirmedAt !== 'string' || !Number.isFinite(Date.parse(v.confirmedAt))) return false;
  if (!record(v.packet) || !keys(v.packet, ['packetId', 'packetDigest']) || !text(v.packet.packetId) || typeof v.packet.packetDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v.packet.packetDigest)) return false;
  if (!record(v.destination) || !keys(v.destination, ['destinationId', 'hostId', 'receiverId', 'fingerprint', 'threadRef', 'model']) || ![v.destination.destinationId, v.destination.hostId, v.destination.receiverId, v.destination.fingerprint].every(x => text(x)) || (v.destination.threadRef !== null && !text(v.destination.threadRef))) return false;
  const model = v.destination.model;
  return model === null || record(model) && keys(model, ['provider', 'model']) && text(model.provider, 120) && text(model.model, 120);
}
const rejectionCodes = new Set(['invalid_request', 'capability_denied', 'runtime_mode_escalation_denied', 'interaction_mode_escalation_denied', 'request_conflict', 'launch_fenced']);
const existingRejectionCodes = new Set([...rejectionCodes, 'parent_not_active', 'provider_unavailable', 'model_unavailable', 'task_not_found', 'task_not_cancellable', 'thread_not_found', 'run_not_found', 'thread_not_sendable', 'thread_not_interruptible', 'thread_credential_required', 'target_required']);
const initialStates = ['not_requested', 'accepted', 'rejected', 'pending', 'unknown'];
const preparationStates = ['not_applicable', 'left_preparation', 'in_progress', 'unscheduled', 'unknown_effect'];
const runStates = ['queued', 'preparing', 'starting', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', 'rolled_back'];
function nullableId(value: unknown): boolean { return value === null || text(value); }
function modelSelection(value: unknown): value is { instanceId: string; model: string } { return record(value) && text(value.instanceId, 120) && text(value.model, 120); }
function validLaunchReply(value: unknown, binding: Binding): value is Record<string, unknown> {
  return record(value) && text(value.threadId) && value.projectId === binding.projectId && modelSelection(value.modelSelection)
    && nullableId(value.runId) && (value.status === null || runStates.includes(String(value.status)))
    && initialStates.includes(String(value.initialMessage)) && preparationStates.includes(String(value.preparation))
    && (value.replayed === undefined || typeof value.replayed === 'boolean')
    && (value.requestDigest === undefined || typeof value.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(value.requestDigest));
}
function validLaunchLookup(value: unknown, key: string): value is Record<string, unknown> {
  if (!record(value) || !keys(value, ['clientRequestId', 'state', 'basis', 'threadId', 'requestDigest', 'claimed', 'threadDeleted', 'initialMessage', 'runId', 'runStatus', 'preparation', 'workspace', 'reason'])
    || value.clientRequestId !== key || !['launched', 'no_effect', 'absent'].includes(String(value.state)) || !['receipt', 'fence', 'rejection', 'none'].includes(String(value.basis))
    || !nullableId(value.threadId) || !nullableId(value.runId) || typeof value.claimed !== 'boolean' || typeof value.threadDeleted !== 'boolean'
    || !(value.requestDigest === null || typeof value.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(value.requestDigest))
    || !initialStates.includes(String(value.initialMessage)) || !preparationStates.includes(String(value.preparation))
    || !(value.runStatus === null || runStates.includes(String(value.runStatus))) || !(value.reason === null || typeof value.reason === 'string')) return false;
  if (value.workspace !== null && (!record(value.workspace) || !keys(value.workspace, ['type', 'branch', 'worktreePath']) || !['root', 'worktree', 'existing_worktree'].includes(String(value.workspace.type)) || ![value.workspace.branch, value.workspace.worktreePath].every(v => v === null || typeof v === 'string'))) return false;
  if (value.claimed !== (value.requestDigest !== null) || (value.runId === null) !== (value.runStatus === null)) return false;
  if (value.state === 'launched') return value.basis === 'receipt' && text(value.threadId);
  return value.threadId === null && value.runId === null && value.runStatus === null && value.workspace === null && value.threadDeleted === false && value.preparation === 'not_applicable'
    && ['unknown', 'pending', 'not_requested'].includes(String(value.initialMessage))
    && (value.state === 'absent' ? value.basis === 'none' : ['fence', 'rejection'].includes(String(value.basis)));
}
export function createReceiver(options: { client: () => Promise<McpClient>; sessionLabel: () => Promise<string>; binding: (locator: string) => Promise<Binding>; ledger: JsonStore<Ledger>; now?: () => string }) {
  const now = options.now ?? (() => new Date().toISOString());
  let serial = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => { const next = serial.then(fn); serial = next.then(() => {}, () => {}); return next; };
  async function loadLedger() { const value = await options.ledger.read() ?? {}; if (!record(value)) throw Error('Ledger unavailable'); return value; }
  const marker = (entry: Pick<LedgerEntry, 'idempotencyKey' | 'wireDigest'>) => `HQ-HANDOFF/1 ${entry.idempotencyKey} ${entry.wireDigest}`;
  function receipt(entry: LedgerEntry, binding: Binding, id: string, accepted: boolean, observedModel: JonesModel | null, reason?: string): JonesReceipt {
    return { receiptId: id as JonesReceipt['receiptId'], idempotencyKey: entry.idempotencyKey, status: accepted ? 'accepted' : 'held', observedHostId: binding.identity.hostId, observedReceiverId: binding.identity.receiverId, observedModel, at: now(), provenance: 'jones', ...(reason ? { reason } : {}) };
  }
  function launched(value: unknown, entry: LedgerEntry, binding: Binding): JonesReceipt {
    if (!record(value) || !text(value.threadId) || !initialStates.includes(String(value.initialMessage)) || !preparationStates.includes(String(value.preparation))) throw Error('Unknown launch response');
    const accepted = value.initialMessage === 'accepted' && value.threadDeleted !== true;
    const model = modelSelection(value.modelSelection) ? { provider: value.modelSelection.instanceId, model: value.modelSelection.model } : null;
    return receipt(entry, binding, `jcl1:${value.threadId}`, accepted, model, accepted ? undefined : `initialMessage=${value.initialMessage}; preparation=${value.preparation}${value.threadDeleted ? '; thread deleted' : ''}`);
  }
  async function readThread(client: McpClient, threadId: string, afterPosition?: number) {
    const value = await client.call('t3_thread_read', { threadId, view: 'messages', limit: 100, runLimit: 50, maxCharsPerItem: 50000, ...(afterPosition === undefined ? {} : { afterPosition }) });
    if (!record(value) || !record(value.thread) || value.thread.threadId !== threadId || !Array.isArray(value.items) || value.items.length > 100 || !Array.isArray(value.recentRuns) || value.recentRuns.length > 50 || typeof value.hasMore !== 'boolean') throw Error('Thread read unavailable');
    return value;
  }
  async function context(locator: string, key: string) {
    const ledger = await loadLedger(), entry = ledger[key];
    if (!entry || entry.locator !== locator) throw Error('Unknown attempt');
    if (entry.sessionLabel !== await options.sessionLabel()) throw Error('session changed; this attempt cannot be resolved by key');
    return { entry, binding: await options.binding(locator), client: await options.client() };
  }
  async function existingLookup(entry: LedgerEntry, binding: Binding, client: McpClient): Promise<JonesLookupOutcome> {
    const threadId = binding.threadId!;
    const result = await readThread(client, threadId, entry.baseline);
    if (result.hasMore) return { kind: 'unavailable', detail: 'Timeline suffix exceeds bound' };
    const items = result.items as unknown[];
    const matches = items.filter(item => record(item) && item.sourceThreadId === threadId && item.visibility === 'local' && item.type === 'user_message' && typeof item.text === 'string' && item.text.startsWith(`${marker(entry)}\n`));
    const queue = await client.call('t3_queue_list', { threadId, limit: 100 });
    if (!record(queue) || !Array.isArray(queue.items) || queue.items.length > 100 || queue.nextCursor !== null) return { kind: 'unavailable', detail: 'Queue read incomplete' };
    const queued = queue.items.filter(item => record(item) && typeof item.text === 'string' && item.text.startsWith(`${marker(entry)}\n`));
    const runIds = new Set([...matches.map(item => (item as Record<string, unknown>).runId), ...queued.map(item => (item as Record<string, unknown>).queuedRunId)]);
    if (runIds.size > 1 || matches.length > 1 || queued.length > 1) return { kind: 'unavailable', detail: 'Duplicate handoff markers' };
    const runId = [...runIds][0];
    if (!text(runId)) return { kind: 'not-found' };
    const thread = result.thread as Record<string, unknown>;
    const observed = text(thread.providerInstanceId, 120) && text(thread.model, 120) ? { provider: String(thread.providerInstanceId), model: String(thread.model) } : null;
    const found = receipt(entry, binding, `jcs1:${String(runId)}`, queued.length === 0, observed, queued.length ? 'queued' : undefined);
    await exclusive(async () => { const ledger = await loadLedger(); await options.ledger.write({ ...ledger, [entry.idempotencyKey]: { ...entry, receipt: found, runId: String(runId), threadId } }); });
    return { kind: 'found', receipt: found };
  }
  return {
    async identify(locator: string): Promise<JonesIdentity> {
      const binding = await options.binding(locator), client = await options.client();
      const value = await client.call('t3_environment_read', {});
      if (!record(value) || !text(value.environmentId) || `jones:${hash(String(value.environmentId)).slice(0, 32)}` !== binding.identity.hostId) throw Error('Receiver identity changed');
      if (binding.mode === 'existing-thread') await readThread(client, binding.threadId!);
      return binding.identity;
    },
    async send(locator: string, handoff: JonesHandoff): Promise<JonesSendOutcome> {
      if (!validHandoff(handoff)) return { kind: 'rejected', reason: 'Invalid handoff' };
      const wire = canonical(handoff); if (Buffer.byteLength(wire) > 120000) return { kind: 'rejected', reason: 'Handoff oversized' };
      const binding = await options.binding(locator), client = await options.client();
      if (handoff.destination.hostId !== binding.identity.hostId || handoff.destination.receiverId !== binding.identity.receiverId || handoff.destination.fingerprint !== binding.identity.fingerprint) return { kind: 'rejected', reason: 'Destination identity changed' };
      if (binding.mode === 'existing-thread' && canonical(handoff.destination.model) !== canonical(binding.model)) return { kind: 'rejected', reason: 'Pinned model differs from bound receiver' };
      let baseline = 0;
      if (binding.mode === 'existing-thread') {
        const observed = await readThread(client, binding.threadId!); const thread = observed.thread as Record<string, unknown>;
        if (binding.model && (thread.providerInstanceId !== binding.model.provider || thread.model !== binding.model.model)) return { kind: 'rejected', reason: 'Observed model changed' };
        baseline = Math.max(0, ...(observed.items as unknown[]).map(item => record(item) && Number.isSafeInteger(item.position) ? Number(item.position) : 0));
      }
      const entry: LedgerEntry = { idempotencyKey: handoff.idempotencyKey, mode: binding.mode, locator, wireDigest: `sha256:${hash(wire)}`, sessionLabel: await options.sessionLabel(), handoff, baseline };
      const reserved = await exclusive(async () => {
        const ledger = await loadLedger();
        if (ledger[entry.idempotencyKey]) throw Error('Attempt already reserved; lookup only');
        try { await options.ledger.write({ ...ledger, [entry.idempotencyKey]: entry }); return true; } catch { return false; }
      });
      if (!reserved) return { kind: 'rejected', reason: 'Pre-send ledger unavailable' };
      const message = `${marker(entry)}\n${wire}`;
      const value = await client.call(binding.mode === 'new-thread' ? 't3_thread_launch' : 't3_thread_send', binding.mode === 'new-thread'
        ? { clientRequestId: entry.idempotencyKey, projectId: binding.projectId, title: `HQ handoff ${handoff.packet.packetId}`.slice(0, 256), message,
          ...(handoff.destination.model ? { modelSelection: { instanceId: handoff.destination.model.provider, model: handoff.destination.model.model } } : {}) }
        : { threadId: binding.threadId, message, mode: 'queue', clientRequestId: entry.idempotencyKey });
      if (record(value) && typeof value.code === 'string') { if ((binding.mode === 'new-thread' ? rejectionCodes : existingRejectionCodes).has(value.code)) return { kind: 'rejected', reason: value.code }; throw Error('Unknown send effect'); }
      let result: JonesReceipt, runId: string | undefined, threadId: string;
      if (binding.mode === 'new-thread') { if (!validLaunchReply(value, binding)) throw Error('Unknown launch response'); result = launched(value, entry, binding); runId = record(value) && text(value.runId) ? String(value.runId) : undefined; threadId = String((value as Record<string, unknown>).threadId); }
      else {
        if (!record(value) || value.threadId !== binding.threadId || !text(value.runId) || !text(value.messageId) || !runStates.includes(String(value.status)) || !['started', 'queued'].includes(String(value.delivery))) throw Error('Unknown send effect');
        runId = String(value.runId); threadId = binding.threadId!;
        result = receipt(entry, binding, `jcs1:${runId}`, value.delivery === 'started', binding.model, value.delivery === 'queued' ? 'queued' : undefined);
      }
      await exclusive(async () => { const ledger = await loadLedger(); await options.ledger.write({ ...ledger, [entry.idempotencyKey]: { ...entry, receipt: result, ...(runId ? { runId } : {}), threadId } }); });
      return result.status === 'accepted' ? { kind: 'accepted', receipt: result } : { kind: 'held', receipt: result };
    },
    async lookup(locator: string, key: string): Promise<JonesLookupOutcome> {
      try {
        const { entry, binding, client } = await context(locator, key);
        if (binding.mode === 'existing-thread') return await existingLookup(entry, binding, client);
        const value = await client.call('t3_thread_launch_lookup', { clientRequestId: key });
        if (!validLaunchLookup(value, key)) throw Error('Invalid lookup');
        if (value.state === 'launched') {
          const found = launched(value, entry, binding);
          await exclusive(async () => { const ledger = await loadLedger(); await options.ledger.write({ ...ledger, [key]: { ...entry, receipt: found, threadId: String(value.threadId), ...(value.runId ? { runId: String(value.runId) } : {}) } }); });
          return { kind: 'found', receipt: found };
        }
        if (value.state === 'no_effect' && ['rejection', 'fence'].includes(String(value.basis))) return { kind: 'no-effect', basis: `jones:${value.basis}` };
        if (value.state === 'absent') return { kind: 'not-found' };
        throw Error('Lookup unavailable');
      } catch (error) { return { kind: 'unavailable', detail: error instanceof Error && error.message.startsWith('session changed') ? error.message : 'Receiver lookup unavailable' }; }
    },
    async fence(locator: string, key: string): Promise<JonesFenceOutcome> {
      try {
        const { entry, binding, client } = await context(locator, key);
        if (binding.mode !== 'new-thread') return { kind: 'unavailable', detail: 'Existing-thread attempts are lookup-only' };
        const value = await client.call('t3_thread_launch_fence', { clientRequestId: key });
        if (!validLaunchLookup(value, key)) throw Error('Invalid fence');
        if (value.state === 'launched') {
          const found = launched(value, entry, binding);
          await exclusive(async () => { const ledger = await loadLedger(); await options.ledger.write({ ...ledger, [key]: { ...entry, receipt: found, threadId: String(value.threadId), ...(value.runId ? { runId: String(value.runId) } : {}) } }); });
          return { kind: 'found', receipt: found };
        }
        if (value.state === 'no_effect' && value.basis === 'fence') return { kind: 'no-effect', basis: 'jones:fence' };
        throw Error('Fence unavailable');
      } catch (error) { return { kind: 'unavailable', detail: error instanceof Error && error.message.startsWith('session changed') ? error.message : 'Receiver fence unavailable; nothing resent' }; }
    },
    async readEvidence(locator: string, key: string, query: { dispatchId: string; attemptId: string; receiptId: string }) {
      try {
        const { entry, binding, client } = await context(locator, key);
        if (entry.handoff.dispatchId !== query.dispatchId || entry.handoff.attemptId !== query.attemptId || entry.receipt?.receiptId !== query.receiptId || !entry.runId || !entry.threadId) return { kind: 'none-yet' as const };
        const result = await readThread(client, entry.threadId, entry.baseline);
        if (result.hasMore) throw Error('Evidence suffix overflow');
        const items = (result.items as unknown[]).filter(item => record(item) && item.runId === entry.runId && item.sourceThreadId === entry.threadId && item.visibility === 'local' && item.type === 'assistant_message' && typeof item.text === 'string' && !item.textTruncated);
        const summary = items.map(item => String((item as Record<string, unknown>).text)).join('\n').slice(0, 2000);
        if (!summary) return { kind: 'none-yet' as const };
        const run = (result.recentRuns as unknown[]).find(run => record(run) && run.runId === entry.runId);
        const status = record(run) && ['completed', 'failed', 'cancelled'].includes(String(run.status)) ? run.status : record(run) && ['running', 'queued', 'starting'].includes(String(run.status)) ? 'running' : 'unknown';
        const observedAt = (items.at(-1) as Record<string, unknown>).updatedAt;
        if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) throw Error('Evidence timestamp unavailable');
        return { kind: 'found' as const, documents: [{ schema: 'hq.design.result-evidence/v1', evidenceId: `jones-evidence:${hash(canonical({ key, summary, status, observedAt })).slice(0, 32)}`, dispatchId: query.dispatchId, attemptId: query.attemptId, receiptId: query.receiptId, packet: entry.handoff.packet,
          candidate: { candidateId: `jones-candidate:${hash(key).slice(0, 32)}`, summary, artifacts: [] }, claimLevel: 'agent-reported', execution: { status, observedAt, hostId: binding.identity.hostId, receiverId: binding.identity.receiverId, model: entry.receipt.observedModel }, provenance: 'jones' }] };
      } catch { return { kind: 'unavailable' as const, detail: 'Run-scoped evidence unavailable' }; }
    },
  };
}
