import type { BuildReceipt, InstallationRecord, PreparedCandidate, UpdateArchitecture, UpdateErrorCode, UpdatePreferences, UpdateResult, UpdateStatus } from '@hq/contracts/updates';
import { verifyNativeBundle, type BundleVerifier } from './archive.js';
import { REPOSITORY_URL, UpdateFailure, closed, contract, object } from './contract.js';
import { checkCompatibility, discover, type DiscoveredCandidate, type DiscoveryOptions } from './discovery.js';
import { verifyProvenance, type ProvenanceVerifier } from './provenance.js';
import { createUpdateStorage, type SavedState, type UpdateStorage } from './storage.js';
import { nodeTransport, type Transport } from './transport.js';

export interface UpdateClock {
  now(): number;
  random(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
}
export interface UpdateHostOptions {
  readonly installed: BuildReceipt | null;
  readonly record: InstallationRecord | null;
  readonly schedule: (candidate: PreparedCandidate) => Promise<void>;
  readonly cancelScheduled: () => Promise<void>;
  readonly recovery?: UpdateStatus['recovery'];
  readonly platform?: string;
  readonly architecture?: string;
  readonly adapters?: {
    readonly transport?: Transport;
    readonly verifyProvenance?: ProvenanceVerifier;
    readonly verifyBundle?: BundleVerifier;
    readonly storage?: UpdateStorage;
    readonly discover?: (options: DiscoveryOptions) => Promise<DiscoveredCandidate | null>;
    readonly clock?: UpdateClock;
  };
}
const messages: Readonly<Record<UpdateErrorCode, string>> = {
  unavailable: 'Updates are available in a configured macOS installation.',
  invalid: 'The update request is invalid.', busy: 'Another update operation is in progress.',
  'stale-candidate': 'The update changed. Check the current candidate before continuing.',
  network: 'The update service could not be reached. Try again later.',
  'rate-limited': 'The update service is busy. The next automatic check has been delayed.',
  provenance: 'The release could not be authenticated. Nothing was scheduled.',
  integrity: 'The downloaded update did not pass validation. Download it again.',
  incompatible: 'This update is not compatible with this installation.',
  space: 'There is not enough free space to prepare the update.',
  cancelled: 'The download was cancelled.', permission: 'The updater cannot access its own update storage.',
  'recovery-required': 'Update recovery needs attention. Your current session remains open.',
};
const defaultClock: UpdateClock = {
  now: () => Date.now(), random: () => Math.random(),
  setTimeout: (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); timer.unref(); return timer; },
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
const validPreferences = (value: unknown): value is UpdatePreferences => closed(value, ['automaticChecks', 'backgroundDownload']) && typeof value.automaticChecks === 'boolean' && typeof value.backgroundDownload === 'boolean';
const validTime = (value: unknown): value is string | null => value === null || typeof value === 'string' && value.length < 40 && !Number.isNaN(Date.parse(value));

export function createUpdateHost(options: UpdateHostOptions) {
  const clock = options.adapters?.clock ?? defaultClock;
  const architecture = options.architecture ?? process.arch;
  const installed = options.installed, record = options.record;
  let supported = false;
  try {
    if (installed && record && (options.platform ?? process.platform) === 'darwin' && ['arm64', 'x64'].includes(architecture)) {
      contract.validateBuildReceipt(installed);
      contract.validateInstallation(record);
      supported = !record.synthetic && installed.bundleId === 'org.jones-systems.hq.local' && installed.architecture === architecture && installed.channel === record.channel && installed.compatibilityEpoch === record.compatibilityEpoch;
    }
  } catch { supported = false; }
  const verify = options.adapters?.verifyProvenance ?? verifyProvenance;
  const storage = supported && record ? options.adapters?.storage ?? createUpdateStorage(record, options.adapters?.transport ?? nodeTransport, verify, options.adapters?.verifyBundle ?? verifyNativeBundle) : null;
  const recovery = options.recovery ? Object.freeze({ state: /^[a-z][a-z-]{0,63}$/.test(options.recovery.state) ? options.recovery.state : 'held', message: 'HQ has retained update recovery information. Existing profile files are preserved.' }) : null;
  let preferences: UpdatePreferences = { automaticChecks: true, backgroundDownload: false };
  let phase: UpdateStatus['phase'] = !supported ? 'unavailable' : recovery ? 'held' : 'idle';
  let candidate: DiscoveredCandidate | null = null, prepared: PreparedCandidate | null = null, scheduled = false;
  let lastCheckedAt: string | null = null, nextCheckAt: string | null = null;
  let progress: UpdateStatus['progress'] = null, error: UpdateStatus['error'] = null;
  let disposed = false, started = false, initialized: Promise<void> | null = null, initializationFailed = false;
  let timer: unknown = null, failures = 0, persistence = Promise.resolve();
  let operation: { kind: 'check' | 'download' | 'schedule' | 'cancelScheduled'; controller: AbortController; done: Promise<UpdateResult> } | null = null;
  const listeners = new Set<(status: UpdateStatus) => void>();

  function status(): UpdateStatus {
    return Object.freeze({
      schemaVersion: 1, phase, supported: supported && !disposed,
      installed: Object.freeze({ version: installed?.version ?? 'Development', sourceSha: installed?.sourceSha ?? null, channel: record?.channel ?? installed?.channel ?? 'preview' }),
      preferences: Object.freeze({ ...preferences }), lastCheckedAt, nextCheckAt,
      candidate: candidate ? Object.freeze({ candidateId: candidate.candidateId, version: candidate.manifest.version, sourceSha: candidate.manifest.sourceSha, size: candidate.manifest.archive.size, publishedAt: candidate.manifest.publishedAt }) : null,
      progress: progress ? Object.freeze({ ...progress }) : null, error: error ? Object.freeze({ ...error }) : null, recovery,
    });
  }
  function emit(): void {
    if (disposed) return;
    const value = status();
    for (const listener of listeners) { try { listener(value); } catch { /* A renderer listener cannot interrupt updater cleanup. */ } }
  }
  function result(code?: UpdateErrorCode): UpdateResult { return code ? { ok: false, code, status: status() } : { ok: true, status: status() }; }
  function failureCode(value: unknown): UpdateErrorCode {
    if (object(value) && value.unknownEffect === true) return 'recovery-required';
    if (object(value) && typeof value.code === 'string' && Object.hasOwn(messages, value.code)) return value.code as UpdateErrorCode;
    if (object(value) && ['EACCES', 'EPERM'].includes(String(value.code))) return 'permission';
    if (object(value) && value.code === 'ENOSPC') return 'space';
    return 'integrity';
  }
  function fail(code: UpdateErrorCode): UpdateResult {
    error = { code, message: messages[code] };
    phase = code === 'recovery-required' ? 'held' : 'error';
    progress = null;
    emit();
    return result(code);
  }
  function saved(): SavedState { return { schemaVersion: 1, preferences, lastCheckedAt, candidate, prepared, scheduled }; }
  function persist(): Promise<void> {
    const state = saved();
    const next = persistence.then(() => storage!.write(state));
    persistence = next.catch(() => {});
    return next;
  }
  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null; nextCheckAt = null;
  }
  function scheduleCheck(initial = false): void {
    clearTimer();
    if (!started || disposed || !supported || initializationFailed || recovery || scheduled || !preferences.automaticChecks) return;
    const base = initial ? 30000 : failures ? Math.min(6 * 60 * 60 * 1000, 60000 * 2 ** Math.min(failures, 9)) : 6 * 60 * 60 * 1000;
    const milliseconds = base + Math.floor(Math.max(0, Math.min(1, clock.random())) * (initial ? 60000 : base / 6));
    nextCheckAt = new Date(clock.now() + milliseconds).toISOString();
    timer = clock.setTimeout(() => {
      timer = null; nextCheckAt = null;
      if (operation) { scheduleCheck(); return; }
      void call('check', {}).then(checked => {
        if (checked.ok && !disposed && preferences.backgroundDownload && candidate && !prepared && !scheduled && !operation) void call('download', { candidateId: candidate.candidateId });
      });
    }, milliseconds);
    emit();
  }
  async function initialize(): Promise<void> {
    if (!supported || disposed) return;
    if (initialized) return initialized;
    initialized = (async () => {
      await storage!.initialize();
      const value = await storage!.read();
      if (!value) return;
      if (!closed(value, ['schemaVersion', 'preferences', 'lastCheckedAt', 'candidate', 'prepared', 'scheduled']) || value.schemaVersion !== 1 || !validPreferences(value.preferences) || !validTime(value.lastCheckedAt) || typeof value.scheduled !== 'boolean') throw new UpdateFailure('integrity');
      preferences = { ...value.preferences }; lastCheckedAt = value.lastCheckedAt;
      if (value.candidate !== null) {
        if (!closed(value.candidate, ['candidateId', 'manifest', 'manifestHash', 'archiveURL', 'bundle'])) throw new UpdateFailure('integrity');
        const manifest = contract.validateManifest(value.candidate.manifest);
        checkCompatibility(manifest, installed!, record!, architecture as UpdateArchitecture);
        if (typeof value.candidate.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.candidate.manifestHash) || value.candidate.candidateId !== contract.candidateId(manifest) || value.candidate.archiveURL !== `${REPOSITORY_URL}/releases/download/${encodeURIComponent(manifest.releaseTag)}/${manifest.archive.name}`) throw new UpdateFailure('integrity');
        if (manifest.buildSequence <= installed!.buildSequence) return;
        candidate = { ...value.candidate, manifest } as unknown as DiscoveredCandidate;
      }
      if (value.prepared !== null) {
        if (!candidate) throw new UpdateFailure('integrity');
        prepared = contract.validatePreparedCandidate(value.prepared);
      }
      if (value.scheduled && !prepared) throw new UpdateFailure('integrity');
      scheduled = value.scheduled;
      phase = recovery ? 'held' : scheduled ? 'scheduled' : prepared ? 'ready' : candidate ? 'available' : 'idle';
    })().catch(value => { initializationFailed = true; fail(failureCode(value)); throw value; });
    return initialized;
  }
  function run(kind: NonNullable<typeof operation>['kind'], work: (signal: AbortSignal) => Promise<void>): Promise<UpdateResult> {
    if (operation) return Promise.resolve(result('busy'));
    const controller = new AbortController();
    const deadline = clock.setTimeout(() => controller.abort(new UpdateFailure('network')), kind === 'download' ? 10 * 60 * 1000 : 60000);
    const current = { kind, controller, done: Promise.resolve(result()) };
    operation = current;
    current.done = (async () => {
      try {
        await work(controller.signal);
        if (controller.signal.aborted && (kind === 'check' || kind === 'download')) throw controller.signal.reason;
        return result();
      } catch (value) {
        const code = controller.signal.aborted ? controller.signal.reason instanceof UpdateFailure ? controller.signal.reason.code : 'cancelled' : failureCode(value);
        if (kind === 'check') failures++;
        if (code === 'cancelled') { phase = prepared ? 'ready' : candidate ? 'available' : 'idle'; progress = null; error = null; emit(); return result('cancelled'); }
        return fail(code);
      } finally {
        clock.clearTimeout(deadline);
        if (operation === current) operation = null;
        if (kind === 'check') scheduleCheck();
      }
    })();
    return current.done;
  }

  async function call(route: unknown, params: unknown): Promise<UpdateResult> {
    const noParams = ['status', 'check', 'cancelDownload', 'cancelScheduled'];
    const valid = typeof route === 'string' && (noParams.includes(route) ? closed(params, []) : route === 'preferences' ? validPreferences(params) : ['download', 'schedule'].includes(route) && closed(params, ['candidateId']) && typeof params.candidateId === 'string' && /^[a-f0-9]{64}$/.test(params.candidateId));
    if (!valid) return result('invalid');
    if (disposed || !supported) return route === 'status' ? result() : result('unavailable');
    try { await initialize(); } catch { return result(error?.code ?? 'integrity'); }
    if (disposed) return result('unavailable');
    if (route === 'status') return result();
    if (route === 'cancelDownload') {
      if (operation?.kind !== 'download') return result('invalid');
      const pending = operation;
      pending.controller.abort(new UpdateFailure('cancelled'));
      await pending.done;
      return result();
    }
    if (recovery || error?.code === 'recovery-required') return result('recovery-required');
    if (route === 'preferences') {
      const previous = preferences;
      preferences = { ...(params as UpdatePreferences) };
      try { await persist(); } catch (value) { preferences = previous; return fail(failureCode(value)); }
      scheduleCheck(true); emit(); return result();
    }
    if (operation) return result('busy');
    if (route === 'cancelScheduled') {
      if (!scheduled) return result('invalid');
      return run('cancelScheduled', async () => {
        try {
          await options.cancelScheduled();
          scheduled = false;
          await persist();
        } catch { throw new UpdateFailure('recovery-required'); }
        phase = 'ready'; error = null; scheduleCheck(); emit();
      });
    }
    if (scheduled) return result('busy');
    if (route === 'check') return run('check', async signal => {
      phase = 'checking'; error = null; progress = null; clearTimer(); emit();
      const found = await (options.adapters?.discover ?? discover)({ installed: installed!, record: record!, architecture: architecture as UpdateArchitecture, transport: options.adapters?.transport ?? nodeTransport, verify, cachePath: storage!.trustCache, signal });
      if (signal.aborted) throw signal.reason;
      if (prepared && found?.candidateId !== prepared.candidateId) { await storage!.discard(prepared); prepared = null; }
      candidate = found; lastCheckedAt = new Date(clock.now()).toISOString(); failures = 0;
      await persist();
      phase = prepared ? 'ready' : candidate ? 'available' : 'idle'; emit();
    });
    if (!candidate || (params as { candidateId: string }).candidateId !== candidate.candidateId) return result('stale-candidate');
    if (route === 'download') {
      if (prepared) return result();
      const selected = candidate;
      return run('download', async signal => {
        phase = 'downloading'; error = null; progress = { received: 0, total: selected.manifest.archive.size }; emit();
        let lastProgress = clock.now();
        const value = await storage!.prepare(selected, signal, received => {
          progress = { received, total: selected.manifest.archive.size };
          if (clock.now() - lastProgress >= 100 || received === selected.manifest.archive.size) { lastProgress = clock.now(); emit(); }
        }, () => { phase = 'verifying'; emit(); });
        if (signal.aborted) { await storage!.discard(value); throw signal.reason; }
        prepared = value;
        await persist();
        phase = 'ready'; progress = null; emit();
      });
    }
    if (route === 'schedule') {
      if (!prepared) return result('invalid');
      const selected = prepared, discovered = candidate;
      return run('schedule', async signal => {
        await storage!.validatePrepared(selected, discovered, signal);
        if (signal.aborted) throw signal.reason;
        try {
          await options.schedule(selected);
          scheduled = true;
          await persist();
        } catch { throw new UpdateFailure('recovery-required'); }
        phase = 'scheduled'; error = null; clearTimer(); emit();
      });
    }
    return result('invalid');
  }

  return {
    status, call,
    subscribe(listener: (value: UpdateStatus) => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (started || disposed || !supported) return;
      started = true;
      void initialize().then(() => { if (!disposed) { scheduleCheck(true); emit(); } }).catch(() => {});
    },
    async dispose() {
      if (disposed) return;
      disposed = true; clearTimer(); listeners.clear();
      operation?.controller.abort(new UpdateFailure('cancelled'));
      await operation?.done;
      await initialized?.catch(() => {});
      await persistence;
    },
  };
}
