import {
  PlannerPortError, REPLAY_FEATURE,
  type Anchor, type ApplyResult, type CheckResult, type HistoryEntry, type PlannerError, type PlannerPort,
  type PlannerRecovery, type PlannerRecoveryError, type SettingsWriteResult, type Snapshot, type WriteResult,
} from '../core/port';
import {
  ENTITY_ID_PATTERN, isServiceResponse, REQUEST_ID_PATTERN,
  type PlannerTransport, type ServiceResponse, type WorkMutationCall, type WorkParams, type WorkRoute,
} from './transport';
import {
  canonicalFields, canonicalSettings, decodeCurrent, decodeError, decodeHistory, decodeReplay, decodeSettingsWrite,
  decodeSnapshot, decodeVersion, decodeWrite, deepFreeze, fieldErrors, intentKey,
} from './wire';

// The Planner live adapter (task.work-live-adapter.001, spec.hq-agent-cli#iface.work-live-transport.001). It
// implements the existing PlannerPort over the typed bridge transport and adds a replay-aware recovery sidecar.
//
// Replay safety: before a write is first sent, its typed intent is frozen into a session ledger with the state
// version observed before the send (the replay baseline, never raised later). A write whose outcome is unknown is never
// re-sent through its ordinary route and never retried automatically: the service's request record can be evicted, and
// an ordinary same-ID send after eviction would apply it a second time. It is resolved only by an explicit check
// (lookup) or apply (resend) through the closed replay route, with the recorded intent and baseline. Without
// `requests.replay`, a recorded intent or a baseline, nothing is sent and the outcome stays indeterminate.

/** Unresolved intents the ledger holds. Past it, a new write is refused before it is sent; none is forgotten. */
export const UNRESOLVED_LIMIT = 200;
/**
 * Settled intents kept in full; past it the oldest settled intent is dropped but its request ID stays retired for the
 * session, so a reused ID is still refused rather than sent through the ordinary route.
 */
export const SETTLED_LIMIT = 2_000;

interface LedgerEntry {
  readonly call: WorkMutationCall;
  readonly key: string;
  readonly sentAfterVersion: number;
  state: 'unresolved' | 'settled';
}

/** A read-only view of recorded intents, for tests and diagnostics; deliberately not part of the port. */
export interface LedgerView {
  unresolved(): string[];
  intent(requestId: string): { call: WorkMutationCall; sentAfterVersion: number; state: 'unresolved' | 'settled' } | null;
}

export interface PlannerLive {
  port: PlannerPort;
  recovery: PlannerRecovery;
  ledger: LedgerView;
}

type WriteOutput = WriteResult | SettingsWriteResult;

function fail(error: PlannerRecoveryError): never {
  throw new PlannerPortError(error);
}

const invalid = (field: string, message: string): PlannerError => ({ kind: 'invalid', errors: [{ field, message }] });
const is2xx = (status: number) => status >= 200 && status < 300;

/** A received non-2xx answer to a write, and whether it provably had no effect. */
function writeFailure(response: { status: number; body: unknown }, requestId: string): { error: PlannerError; noEffect: boolean } {
  const { status } = response;
  const unknown = { error: { kind: 'unknown', requestId } as PlannerError, noEffect: false };
  const err = decodeError(response.body);
  if (status === 404) return { error: { kind: 'not_found' }, noEffect: true };
  if (status === 403 || status === 421) return { error: { kind: 'unavailable' }, noEffect: true };
  if (status === 400 || status === 413 || status === 415) {
    const errors = err ? fieldErrors(err.body) : null;
    return { error: { kind: 'invalid', errors: errors ?? [{ field: 'body', message: err?.message ?? `The Planner refused the request (${status}).` }] }, noEffect: true };
  }
  if (status === 409 && err?.error === 'revision_conflict') {
    const current = decodeCurrent(err.body);
    return current ? { error: { kind: 'revision_conflict', current }, noEffect: true } : unknown;
  }
  if (status === 409 && err?.error === 'order_conflict') return { error: { kind: 'order_conflict' }, noEffect: true };
  if (status === 422 && err?.error === 'request_id_reused') return { error: { kind: 'request_id_reused' }, noEffect: true };
  if (status === 422 && err) {
    const errors = fieldErrors(err.body);
    if (errors) return { error: { kind: 'invalid', errors }, noEffect: true };
  }
  // A redirect, a 5xx, an unrecognised status or a malformed body: the write may have been applied.
  return unknown;
}

export function createPlannerLive(transport: PlannerTransport): PlannerLive {
  const ledger = new Map<string, LedgerEntry>();
  const settledOrder: string[] = [];
  /** Request IDs whose settled intent was dropped. IDs only; it grows with the session's writes. */
  const retired = new Set<string>();
  let observedVersion: number | null = null;
  let observedFeatures: string[] | null = null;

  async function call<R extends WorkRoute>(route: R, params: WorkParams[R]): Promise<ServiceResponse> {
    try {
      const response = await transport.call(route, params);
      return isServiceResponse(response) ? response : { ok: false, kind: 'unknown' };
    } catch {
      return { ok: false, kind: 'unknown' };
    }
  }

  function observe(stateVersion: number, features?: string[]) {
    observedVersion = Math.max(observedVersion ?? stateVersion, stateVersion);
    if (features) observedFeatures = [...features];
  }

  /** A read: any failure to get a well-formed 200 is `unavailable`, except a 404. */
  async function read<R extends WorkRoute, T>(route: R, params: WorkParams[R], decode: (body: unknown) => T | null): Promise<T> {
    const response = await call(route, params);
    if (!response.ok) return fail({ kind: 'unavailable' });
    if (response.status === 404) return fail({ kind: 'not_found' });
    if (!is2xx(response.status)) return fail({ kind: 'unavailable' });
    const value = decode(response.body);
    return value === null ? fail({ kind: 'unavailable' }) : value;
  }

  async function readSnapshot(): Promise<Snapshot> {
    const snapshot = await read('state', {}, decodeSnapshot);
    observe(snapshot.stateVersion, snapshot.features);
    return snapshot;
  }

  async function readVersion(): Promise<number> {
    const version = await read('version', {}, decodeVersion);
    observe(version.stateVersion, version.features);
    return version.stateVersion;
  }

  function settle(entry: LedgerEntry) {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    settledOrder.push(entry.call.params.requestId);
    while (settledOrder.length > SETTLED_LIMIT) {
      const oldest = settledOrder.shift()!;
      ledger.delete(oldest);
      retired.add(oldest);
    }
  }

  function forget(requestId: string) {
    ledger.delete(requestId);
  }

  /**
   * Decodes a 2xx write body into the port's result. `changed` holds full items: the service lists field names, so
   * the item stands for them, and a move reads the board back because it renumbers its target status, even on a
   * no-op. If that read-back fails the write stays confirmed and the result is marked `stale`.
   */
  async function result(entry: LedgerEntry, body: unknown, replayed: boolean): Promise<WriteOutput | null> {
    if (entry.call.route === 'settings') {
      const settings = decodeSettingsWrite(body);
      if (settings) observe(settings.stateVersion);
      return settings;
    }
    const decoded = decodeWrite(body);
    if (!decoded) return null;
    observe(decoded.stateVersion);
    const { item, stateVersion } = decoded;
    const changed = entry.call.route === 'create' || (decoded.changedFields?.length ?? 0) > 0 ? [item] : [];
    if (entry.call.route !== 'move' || replayed) return { item, changed, stateVersion, replayed };
    try {
      const snapshot = await readSnapshot();
      if (snapshot.stateVersion < stateVersion) throw new Error('read-back older than the write');
      const neighbours = snapshot.items.filter((other) => other.status === item.status && other.id !== item.id);
      return { item, changed: [item, ...neighbours], stateVersion, replayed };
    } catch {
      return { item, changed: [item], stateVersion, replayed, stale: true };
    }
  }

  async function replay(mode: 'lookup' | 'resend', requestId: string): Promise<CheckResult | ApplyResult> {
    const entry = ledger.get(requestId);
    if (!entry) return fail({ kind: 'replay_indeterminate', requestId, reason: 'no_intent' });
    if (!(observedFeatures ?? []).includes(REPLAY_FEATURE)) return fail({ kind: 'replay_indeterminate', requestId, reason: 'unsupported' });
    const lost: PlannerRecoveryError = mode === 'lookup' ? { kind: 'unavailable' } : { kind: 'unknown', requestId };
    const response = await call('replay', { mode, requestId, original: entry.call, sentAfterVersion: entry.sentAfterVersion });
    if (!response.ok) return fail(response.kind === 'unavailable' ? { kind: 'unavailable' } : lost);
    if (is2xx(response.status)) {
      const decoded = decodeReplay(response.body);
      if (!decoded) return fail(lost);
      if (decoded.outcome === 'not_applied') return mode === 'lookup' ? { outcome: 'not_applied' } : fail(lost);
      // A lookup never applies; an `applied_now` answer to one is a defect whose effect is unknown.
      if (decoded.outcome === 'applied_now' && mode === 'lookup') return fail({ kind: 'unknown', requestId });
      const output = await result(entry, decoded.response, decoded.outcome === 'replayed');
      if (!output) return fail({ kind: 'unknown', requestId });
      settle(entry);
      return { outcome: decoded.outcome, result: output };
    }
    const err = decodeError(response.body);
    if (response.status === 409 && err?.error === 'replay_indeterminate') {
      return fail({ kind: 'replay_indeterminate', requestId, reason: err.body.sent_after_version == null ? 'no_baseline' : 'evicted' });
    }
    if (response.status === 422 && err?.error === 'request_id_reused') return fail({ kind: 'request_id_reused' });
    if (mode === 'lookup') return fail({ kind: 'unavailable' });
    // A resend that the service refused rolled back: the original never landed and still has not.
    const { error, noEffect } = writeFailure(response, requestId);
    if (noEffect && error.kind !== 'unavailable') forget(requestId);
    return fail(error);
  }

  async function write(call0: WorkMutationCall): Promise<WriteOutput> {
    const { requestId } = call0.params;
    if (!REQUEST_ID_PATTERN.test(requestId)) return fail(invalid('requestId', 'Malformed X-Request-Id.'));
    if ('id' in call0.params && !ENTITY_ID_PATTERN.test(call0.params.id)) return fail(invalid('id', 'Malformed item id.'));
    const key = intentKey(call0);
    // Sent before, but its intent is no longer held: it cannot be compared or replayed, and is never re-sent.
    if (retired.has(requestId)) return fail({ kind: 'replay_indeterminate', requestId, reason: 'no_intent' });
    const existing = ledger.get(requestId);
    if (existing) {
      if (existing.key !== key) return fail({ kind: 'request_id_reused' });
      // The same intent again is never an ordinary resubmit: only the replay route may answer it.
      return (await replay('resend', requestId) as ApplyResult).result;
    }
    if ([...ledger.values()].filter((e) => e.state === 'unresolved').length >= UNRESOLVED_LIMIT) {
      return fail(invalid('body', 'Too many unconfirmed changes are waiting. Check or stop tracking some before saving more.'));
    }
    const sentAfterVersion = observedVersion ?? await readVersion();
    const entry: LedgerEntry = { call: deepFreeze(structuredClone(call0)), key, sentAfterVersion, state: 'unresolved' };
    ledger.set(requestId, entry);
    const response = await call(entry.call.route, entry.call.params as never);
    if (!response.ok) {
      if (response.kind === 'unavailable') {
        forget(requestId);
        return fail({ kind: 'unavailable' });
      }
      return fail({ kind: 'unknown', requestId });
    }
    if (is2xx(response.status)) {
      const output = await result(entry, response.body, response.replayed);
      if (!output) return fail({ kind: 'unknown', requestId });
      settle(entry);
      return output;
    }
    const { error, noEffect } = writeFailure(response, requestId);
    // The service records nothing for a refused request, so its ID is free again.
    if (noEffect) forget(requestId);
    return fail(error);
  }

  const fields = <T extends object>(value: T): T => {
    const checked = canonicalFields(value as never, observedFeatures ?? []);
    return checked.ok ? checked.value as T : fail(checked.error);
  };
  const anchorOf = (anchor: Anchor): Anchor => {
    const a = anchor as { after_id?: string; before_id?: string; place?: 'top' | 'bottom' };
    return (a.after_id !== undefined ? { after_id: a.after_id } : a.before_id !== undefined ? { before_id: a.before_id } : { place: a.place }) as Anchor;
  };

  const port: PlannerPort = {
    snapshot: readSnapshot,
    version: readVersion,
    async history(id): Promise<HistoryEntry[]> {
      if (!ENTITY_ID_PATTERN.test(id)) return fail({ kind: 'not_found' });
      return read('history', { id }, decodeHistory);
    },
    async create(input, requestId) {
      return await write({ route: 'create', params: { requestId, fields: fields(input) } }) as WriteResult;
    },
    async patch(id, revision, patch, requestId) {
      return await write({ route: 'patch', params: { id, requestId, revision, patch: fields(patch) } }) as WriteResult;
    },
    async move(id, revision, status, anchor, requestId) {
      return await write({ route: 'move', params: { id, requestId, revision, status, anchor: anchorOf(anchor) } }) as WriteResult;
    },
    async setArchived(id, revision, archived, requestId) {
      return await write({ route: archived ? 'archive' : 'restore', params: { id, requestId, revision } }) as WriteResult;
    },
    async markReviewed(id, revision, requestId) {
      return await write({ route: 'reviewed', params: { id, requestId, revision } }) as WriteResult;
    },
    async updateSettings(settings, requestId) {
      return await write({ route: 'settings', params: { requestId, settings: canonicalSettings(settings) } }) as SettingsWriteResult;
    },
  };

  const recovery: PlannerRecovery = {
    check: (requestId) => replay('lookup', requestId) as Promise<CheckResult>,
    apply: (requestId) => replay('resend', requestId) as Promise<ApplyResult>,
    release(requestId) {
      const entry = ledger.get(requestId);
      if (entry) settle(entry);
    },
  };

  const view: LedgerView = {
    unresolved: () => [...ledger.values()].filter((e) => e.state === 'unresolved').map((e) => e.call.params.requestId),
    intent(requestId) {
      const entry = ledger.get(requestId);
      return entry ? { call: entry.call, sentAfterVersion: entry.sentAfterVersion, state: entry.state } : null;
    },
  };

  return { port, recovery, ledger: view };
}

/** The live PlannerPort alone. Prefer `createPlannerLive`, whose recovery resolves unknown writes safely. */
export function createPlannerLivePort(transport: PlannerTransport): PlannerPort {
  return createPlannerLive(transport).port;
}

/** Alias kept for the spec's earlier name. */
export const createLivePlanner = createPlannerLive;
