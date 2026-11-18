import { randomUUID } from 'node:crypto';
import { isAbsolute, normalize, parse, sep } from 'node:path';
import type { JsonStore } from '../jones-code/storage.js';
import type { AcceptedBindingSet, BindingSetHoldReason, GenerationBinding, GenerationIdentity, HoldReason,
  RefreshResult, ServedBinding, ServingGenerationConsumer } from './generations/index.js';

export interface GenerationSource {
  sourceId: string;
  ownerState: 'active' | 'removed';
  issuance: 'issued' | 'not_issued' | 'held';
  reason: 'issued' | 'not_issued' | 'binding_scope_changed';
  binding: GenerationBinding;
  acceptedSetRevision: string;
}
export interface GenerationSourceRecord {
  schema: 'hq.generation-sources/v1';
  recordRevision: string;
  publishers: { publisherId: string; accepted: AcceptedBindingSet | null }[];
  sources: GenerationSource[];
}
export type GenerationSourcesApi = Pick<typeof import('./generations/index.js'),
  'readConsumerBindingSet' | 'diffBindingSets' | 'bindingKey' | 'rebindable' | 'createGenerationConsumer'>;
type RecordReason = 'record_invalid' | 'record_conflict' | 'record_unavailable' | 'record_uncertain'
  | 'invalid_publisher' | 'publisher_exists' | 'publisher_unregistered' | 'source_unknown'
  | 'source_id_collision' | 'store_root_changed' | 'store_root_collision' | 'writer_exists' | 'writer_closed';
export class GenerationSourceError extends Error {
  constructor(readonly reason: RecordReason) { super(reason); this.name = 'GenerationSourceError'; }
}
type UnavailableReason = 'source_unknown' | 'source_removed' | 'not_issued' | 'binding_scope_changed' | 'application_pending';
type Unavailable = { status: 'unavailable'; reason: UnavailableReason };
export type GenerationSourceServing = Unavailable | { status: 'empty' }
  | { status: 'held'; reason: HoldReason; lastGood: GenerationIdentity | null }
  | { status: 'pending' | 'current'; generation: GenerationIdentity; served: ServedBinding; accepted: ServedBinding };
export type GenerationSourceImport = { kind: 'held'; reason: BindingSetHoldReason | 'publisher_unregistered' }
  | { kind: 'advanced' | 'unchanged'; recordRevision: string };

const writers = new WeakSet<object>();
const matches = (pattern: RegExp, value: unknown): value is string => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const opaque = (value: unknown): value is string => matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, value);
const decimal = (value: unknown): value is string => matches(/^(0|[1-9][0-9]*)$/, value);
const positive = (value: unknown): value is string => decimal(value) && value !== '0';
const sha = (value: unknown): value is string => matches(/^[a-f0-9]{64}$/, value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: unknown, names: string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
function requireRecord(condition: unknown, reason: RecordReason = 'record_invalid'): asserts condition {
  if (!condition) throw new GenerationSourceError(reason);
}
const empty = (): GenerationSourceRecord => ({ schema: 'hq.generation-sources/v1', recordRevision: '0', publishers: [], sources: [] });

// One main-process writer owns the injected JsonStore and its backing record.
// JsonStore supplies atomic replacement, not a cross-process lock: all writes to
// that record must go through this writer. Revision checks never retry a conflict.
export function createGenerationSources(options: {
  store: JsonStore<GenerationSourceRecord>;
  storeRootFor(sourceId: string): string;
  generations: GenerationSourcesApi;
  mintSourceId?: () => string;
}) {
  requireRecord(!writers.has(options.store), 'writer_exists');
  writers.add(options.store);
  const api = options.generations;
  let serial = Promise.resolve(), closed = false, uncertain = false;
  let closing: Promise<void> | undefined;
  const consumers = new Map<string, { binding: GenerationBinding; consumer: ServingGenerationConsumer }>();
  const roots = new Map<string, string>();
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = serial.then(async () => {
      requireRecord(!closed, 'writer_closed');
      requireRecord(!uncertain, 'record_uncertain');
      return action();
    });
    serial = next.then(() => {}, () => {});
    return next;
  }
  function validate(value: unknown): GenerationSourceRecord {
    requireRecord(fields(value, ['schema', 'recordRevision', 'publishers', 'sources'])
      && value.schema === 'hq.generation-sources/v1' && decimal(value.recordRevision)
      && Array.isArray(value.publishers) && Array.isArray(value.sources));
    const publishers = new Map<string, AcceptedBindingSet | null>(), folded = new Set<string>();
    for (const publisher of value.publishers) {
      requireRecord(fields(publisher, ['publisherId', 'accepted']) && opaque(publisher.publisherId));
      requireRecord(!folded.has(publisher.publisherId.toLowerCase()));
      folded.add(publisher.publisherId.toLowerCase());
      const accepted = publisher.accepted;
      requireRecord(accepted === null || (fields(accepted, ['hostId', 'setRevision', 'sha256'])
        && opaque(accepted.hostId) && positive(accepted.setRevision) && sha(accepted.sha256)));
      publishers.set(publisher.publisherId, accepted as AcceptedBindingSet | null);
    }
    const ids = new Set<string>(), keys = new Set<string>();
    for (const source of value.sources) {
      requireRecord(fields(source, ['sourceId', 'ownerState', 'issuance', 'reason', 'binding', 'acceptedSetRevision'])
        && opaque(source.sourceId) && !ids.has(source.sourceId) && positive(source.acceptedSetRevision));
      requireRecord(source.ownerState === 'active' || source.ownerState === 'removed');
      requireRecord((source.issuance === 'issued' && source.reason === 'issued')
        || (source.issuance === 'not_issued' && source.reason === 'not_issued')
        || (source.issuance === 'held' && source.reason === 'binding_scope_changed'));
      const binding = source.binding;
      requireRecord(fields(binding, ['origin', 'publisherId', 'hostId', 'rootId', 'bindingRevision', 'scopeDigest', 'consistencyMode'])
        && opaque(binding.publisherId) && opaque(binding.hostId) && opaque(binding.rootId) && opaque(binding.bindingRevision)
        && typeof binding.origin === 'string' && sha(binding.scopeDigest)
        && (binding.consistencyMode === 'observed-files-v1' || binding.consistencyMode === 'producer-complete-v1'));
      const accepted = publishers.get(binding.publisherId);
      requireRecord(accepted && accepted.hostId === binding.hostId
        && BigInt(source.acceptedSetRevision) <= BigInt(accepted.setRevision));
      const key = api.bindingKey(binding as unknown as GenerationBinding);
      requireRecord(!keys.has(key)); keys.add(key); ids.add(source.sourceId);
    }
    return structuredClone(value) as unknown as GenerationSourceRecord;
  }
  async function read(): Promise<GenerationSourceRecord> {
    let value: unknown;
    try { value = await options.store.read(); }
    catch { throw new GenerationSourceError('record_unavailable'); }
    return value === null ? empty() : validate(value);
  }
  function expectRevision(record: GenerationSourceRecord, expected: string): void {
    requireRecord(decimal(expected) && record.recordRevision === expected, 'record_conflict');
  }
  function sameBinding(a: GenerationBinding, b: GenerationBinding): boolean {
    return api.bindingKey(a) === api.bindingKey(b) && a.scopeDigest === b.scopeDigest
      && a.consistencyMode === b.consistencyMode && !api.rebindable(a, b);
  }
  function unavailable(record: GenerationSourceRecord, source: GenerationSource | undefined): UnavailableReason | null {
    if (!source) return 'source_unknown';
    if (source.ownerState === 'removed') return 'source_removed';
    const accepted = record.publishers.find(p => p.publisherId === source.binding.publisherId)?.accepted;
    if (!accepted || source.acceptedSetRevision !== accepted.setRevision) return 'application_pending';
    if (source.issuance === 'not_issued') return 'not_issued';
    if (source.issuance === 'held') return 'binding_scope_changed';
    return null;
  }
  function discardIneligible(record: GenerationSourceRecord): void {
    for (const [id, cached] of consumers) {
      const source = record.sources.find(s => s.sourceId === id);
      if (unavailable(record, source) || !source || !sameBinding(source.binding, cached.binding)) consumers.delete(id);
    }
  }
  async function write(previous: GenerationSourceRecord, next: GenerationSourceRecord): Promise<GenerationSourceRecord> {
    const candidate = validate({ ...next, recordRevision: (BigInt(previous.recordRevision) + 1n).toString() });
    expectRevision(await read(), previous.recordRevision);
    try { await options.store.write(structuredClone(candidate)); }
    catch {
      // A write exception may follow rename. Only a fresh writer may reconcile.
      uncertain = true; consumers.clear(); throw new GenerationSourceError('record_uncertain');
    }
    discardIneligible(candidate);
    return candidate;
  }
  function publisherId(value: string): void { requireRecord(opaque(value), 'invalid_publisher'); }
  function consumerFor(record: GenerationSourceRecord, source: GenerationSource): ServingGenerationConsumer {
    const root = options.storeRootFor(source.sourceId);
    requireRecord(typeof root === 'string' && isAbsolute(root) && !root.includes('\0') && normalize(root) === root
      && root !== parse(root).root, 'store_root_changed');
    requireRecord(!roots.has(source.sourceId) || roots.get(source.sourceId) === root, 'store_root_changed');
    for (const [id, other] of roots) if (id !== source.sourceId)
      requireRecord(root !== other && !root.startsWith(other + sep) && !other.startsWith(root + sep), 'store_root_collision');
    roots.set(source.sourceId, root);
    discardIneligible(record);
    let cached = consumers.get(source.sourceId);
    if (!cached) {
      cached = { binding: structuredClone(source.binding), consumer: api.createGenerationConsumer({
        storeRoot: root, binding: structuredClone(source.binding), rebind: 'same-scope-v1',
      }) };
      consumers.set(source.sourceId, cached);
    }
    return cached.consumer;
  }
  return {
    snapshot: () => exclusive(read),
    registerPublisher(id: string, expectedRevision: string) {
      return exclusive(async () => {
        publisherId(id);
        const current = await read(); expectRevision(current, expectedRevision);
        requireRecord(!current.publishers.some(p => p.publisherId.toLowerCase() === id.toLowerCase()), 'publisher_exists');
        return write(current, { ...current, publishers: [...current.publishers, { publisherId: id, accepted: null }] });
      });
    },
    importPublisher(id: string, expectedRevision: string): Promise<GenerationSourceImport> {
      return exclusive(async () => {
        publisherId(id);
        let current = await read(); expectRevision(current, expectedRevision);
        const publisher = current.publishers.find(p => p.publisherId === id);
        if (!publisher) return { kind: 'held', reason: 'publisher_unregistered' };
        const result = await api.readConsumerBindingSet(id, structuredClone(publisher.accepted));
        if (result.kind === 'held') return result;
        const set = result.set;
        const previous = current.sources.filter(s => s.binding.publisherId === id);
        const diff = api.diffBindingSets(previous.map(s => s.binding), set.bindings);
        // Accept first. A crash before any key write is recovered by unchanged's
        // full set; a newer set is always diffed against each durable binding.
        if (result.kind === 'advanced') current = await write(current, { ...current, publishers: current.publishers.map(p => p.publisherId === id
          ? { publisherId: id, accepted: { hostId: set.hostId, setRevision: set.setRevision, sha256: set.sha256 } } : p) });
        const actions: { binding: GenerationBinding; issuance: GenerationSource['issuance']; reason: GenerationSource['reason'] }[] = [
          ...[...diff.added, ...diff.unchanged, ...diff.rebound.map(pair => pair.to)].map(binding => ({ binding, issuance: 'issued' as const, reason: 'issued' as const })),
          ...diff.notIssued.map(binding => ({ binding, issuance: 'not_issued' as const, reason: 'not_issued' as const })),
          // Scope/mode changes are refused per key. Keep its last accepted
          // binding so replay cannot turn the refused scope into an issued one.
          ...diff.scopeChanged.map(pair => ({ binding: pair.from, issuance: 'held' as const, reason: 'binding_scope_changed' as const })),
        ];
        for (const action of actions) {
          const key = api.bindingKey(action.binding);
          const source = current.sources.find(s => api.bindingKey(s.binding) === key);
          if (source?.acceptedSetRevision === set.setRevision) continue;
          const sourceId = source?.sourceId ?? (options.mintSourceId ?? randomUUID)();
          requireRecord(opaque(sourceId) && (source !== undefined || !current.sources.some(s => s.sourceId === sourceId)), 'source_id_collision');
          const applied: GenerationSource = { sourceId, ownerState: source?.ownerState ?? 'active', ...action,
            binding: structuredClone(action.binding), acceptedSetRevision: set.setRevision };
          current = await write(current, { ...current, sources: [...current.sources.filter(s => s.sourceId !== sourceId), applied] });
        }
        return { kind: result.kind, recordRevision: current.recordRevision };
      });
    },
    setOwnerState(sourceId: string, ownerState: GenerationSource['ownerState'], expectedRevision: string) {
      return exclusive(async () => {
        requireRecord(ownerState === 'active' || ownerState === 'removed');
        const current = await read(); expectRevision(current, expectedRevision);
        const source = current.sources.find(s => s.sourceId === sourceId);
        requireRecord(source, 'source_unknown');
        if (source.ownerState === ownerState) return current;
        return write(current, { ...current, sources: current.sources.map(s => s.sourceId === sourceId ? { ...s, ownerState } : s) });
      });
    },
    serving(sourceId: string): Promise<GenerationSourceServing> {
      return exclusive(async () => {
        const current = await read(), source = current.sources.find(s => s.sourceId === sourceId);
        discardIneligible(current);
        const reason = unavailable(current, source);
        if (reason || !source) return { status: 'unavailable', reason: reason ?? 'source_unknown' };
        const state = await consumerFor(current, source).serving();
        if (state.status === 'empty' || state.status === 'held') return state;
        return { status: state.status === 'active' ? 'current' : 'pending', generation: state.generation, served: state.served,
          accepted: { bindingRevision: source.binding.bindingRevision, origin: source.binding.origin } };
      });
    },
    refresh(sourceId: string): Promise<RefreshResult | Unavailable> {
      return exclusive(async () => {
        const current = await read(), source = current.sources.find(s => s.sourceId === sourceId);
        discardIneligible(current);
        const reason = unavailable(current, source);
        if (reason || !source) return { status: 'unavailable', reason: reason ?? 'source_unknown' };
        return consumerFor(current, source).refresh();
      });
    },
    close(): Promise<void> {
      if (!closing) {
        closing = serial.then(() => { closed = true; consumers.clear(); writers.delete(options.store); });
        serial = closing;
      }
      return closing;
    },
  };
}
