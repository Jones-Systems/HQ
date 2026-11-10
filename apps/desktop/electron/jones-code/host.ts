import { app, safeStorage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { JonesDescriptor, JonesDestination, JonesIdentity, JonesParams, JonesResult, JonesSelection, JonesStatus } from '@hq/contracts/jones-code';
import { record, keys } from '../services.js';
import { previewTarget } from '../preview/policy.js';
import { credentialCodec } from './credentials.js';
import { jsonStore } from './storage.js';
import { authorizeJones, type Credential } from './oauth.js';
import { createMcpClient, type McpClient } from './wire.js';
import { createReceiver, hash, validHandoff, type Binding, type Ledger } from './receiver.js';
import { probeCompatibility, type Compatibility, type DeliveryMode } from './compatibility.js';
import { JONES_EXISTING_THREAD_QUALIFIED, JONES_NEW_THREAD_QUALIFIED } from './status.js';
interface Configuration { readonly base: string; readonly label: string; readonly bindings: readonly Binding[] }
const label = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
const key = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9:._-]+$/.test(value);
function createJonesConnectionHost(userData: string) {
  const directory = join(userData, 'jones-code');
  const configStore = jsonStore<Configuration>(directory, 'configuration.json');
  const credentials = jsonStore<Credential>(directory, 'credential.enc', credentialCodec(safeStorage));
  let config: Configuration | null | undefined, credential: Credential | null | undefined, client: McpClient | undefined;
  let state: JonesStatus['state'] = 'not-configured', generation = 0, serial = Promise.resolve();
  let observedAt: string | null = null;
  const selections = new Map<string, { kind: 'project' | 'thread'; id: string; projectId: string; label: string; model: Binding['model']; epoch: number }>();
  let compatibility: Compatibility = { modes: [], reason: 'Delivery capabilities have not been verified' }, checkedAt = 0;
  const qualificationMode = () => !app.isPackaged && !!process.env.HQ_USER_DATA_DIR && process.env.HQ_QUALIFY_JONES === '1';
  const qualifiedModes = (): readonly DeliveryMode[] => state === 'connected' ? compatibility.modes.filter(mode => qualificationMode() || (mode === 'new-thread' ? JONES_NEW_THREAD_QUALIFIED : JONES_EXISTING_THREAD_QUALIFIED)) : [];
  function descriptor(): JonesDescriptor {
    const modes = qualifiedModes();
    return { kind: 'jones-code', label: 'Jones Code', provenance: 'jones', modes,
      qualification: modes.length ? { level: 'qualified', evidenceRef: 'hq-native-s1' } : { level: 'unqualified', reason: compatibility.modes.length ? 'Native Jones delivery qualification is required' : compatibility.reason } };
  }
  async function refreshCompatibility(force = false) {
    if (!force && Date.now() - checkedAt < 30000) return;
    compatibility = { modes: [], reason: 'Delivery capabilities are unavailable' };
    try {
      const probe = await probeCompatibility(await getClient());
      if (!record(probe.identity) || !key(probe.identity.environmentId)) return;
      const fingerprint = `sha256:${hash(String(probe.identity.environmentId))}`;
      compatibility = config?.bindings.some(binding => binding.identity.fingerprint !== fingerprint)
        ? { modes: [], reason: 'Enrolled environment identity changed' } : probe.compatibility;
      observedAt = new Date().toISOString();
    } catch { /* A failed compatibility probe leaves project enrollment available and delivery closed. */ }
    checkedAt = Date.now();
  }
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => { const next = serial.then(fn); serial = next.then(() => {}, () => {}); return next; };
  async function load() {
    if (config === undefined) { config = await configStore.read(); if (config && (!previewTarget(config.base) || !label(config.label) || !Array.isArray(config.bindings) || config.bindings.length > 100)) throw Error('Invalid receiver configuration'); }
    if (!config) { state = 'not-configured'; return; }
    if (credential === undefined) credential = await credentials.read();
    if (!credential || credential.base !== config.base || credential.expiresAt <= Date.now()) { state = 'needs-authorization'; return; }
    if (state !== 'authorizing') state = 'connected';
  }
  async function getClient() {
    await load(); if (state !== 'connected' || !config || !credential) throw Error('Needs authorization');
    const boundCredential = credential;
    client ??= createMcpClient({ base: config.base, token: async () => { if (boundCredential.expiresAt <= Date.now()) throw Error('Needs authorization'); return boundCredential.accessToken; }, unauthorized: () => { if (credential?.sessionLabel === boundCredential.sessionLabel) { state = 'needs-authorization'; credential = null; client = undefined; observedAt = null; } } });
    return client;
  }
  async function sessionLabel() { await getClient(); return credential!.sessionLabel; }
  const receiver = createReceiver({ client: getClient, sessionLabel, binding: async locator => { await load(); const binding = config?.bindings.find(b => b.locator === locator); if (!binding) throw Error('Binding unavailable'); return binding; }, ledger: jsonStore<Ledger>(directory, 'ledger.json') });
  function status(): JonesStatus {
    const destinations: JonesDestination[] = (config?.bindings ?? []).map(binding => ({ destinationId: binding.locator as JonesDestination['destinationId'], label: binding.label, endpoint: { transport: 'jones-code', locator: binding.locator }, mode: binding.mode, identity: binding.identity,
      ...(binding.mode === 'existing-thread' ? { threadRef: binding.identity.receiverId as unknown as NonNullable<JonesDestination['threadRef']> } : {}), ...(binding.model ? { model: binding.model } : {}),
      deliveryQualified: qualifiedModes().includes(binding.mode), deliveryReason: descriptor().qualification.level === 'unqualified' ? (descriptor().qualification as { reason: string }).reason : compatibility.reason,
      freshness: { status: state === 'connected' && observedAt ? 'fresh' : 'stale', lastSuccessAt: observedAt, generation }, status: state === 'connected' && observedAt ? 'reachable' : 'unknown' }));
    return { state, descriptor: descriptor(), destinations };
  }
  async function environment(): Promise<{ hostId: string; fingerprint: string }> {
    const value = await (await getClient()).call('t3_environment_read', {});
    if (!record(value) || !key(value.environmentId)) throw Error('Identity unavailable');
    observedAt = new Date().toISOString();
    return { hostId: `jones:${hash(String(value.environmentId)).slice(0, 32)}`, fingerprint: `sha256:${hash(String(value.environmentId))}` };
  }
  async function projects(): Promise<unknown> {
    const value = await (await getClient()).call('t3_project_list', { limit: 100 });
    if (!record(value) || !Array.isArray(value.projects) || value.projects.length > 100) throw Error('Projects unavailable');
    return value;
  }
  return {
    environment, projects,
    async call(route: unknown, params: unknown): Promise<JonesResult<unknown>> {
      if (!record(params) || typeof route !== 'string') return { ok: false, kind: 'invalid' };
      const empty = ['jonesCode.status', 'jonesCode.authorize', 'jonesCode.projects'].includes(route);
      if (empty && !keys(params, [])) return { ok: false, kind: 'invalid' };
      try {
        await load();
        if (route === 'jonesCode.status') { if (state === 'connected') await refreshCompatibility(); return { ok: true, value: status() }; }
        if (route === 'jonesCode.configure') {
          if (!keys(params, ['baseUrl', 'label']) || !label(params.label)) return { ok: false, kind: 'invalid' };
          const target = previewTarget(params.baseUrl); if (!target || !['', '/'].includes(target.pathname) || target.search || target.hash) return { ok: false, kind: 'invalid' };
          return await exclusive(async () => {
            if (state === 'authorizing') return { ok: false, kind: 'unavailable' };
            const next: Configuration = { base: target.origin, label: String(params.label), bindings: config?.base === target.origin ? config.bindings : [] };
            await configStore.write(next); config = next; generation++; selections.clear(); client = undefined; checkedAt = 0;
            if (credential?.base !== next.base) credential = null;
            await load(); return { ok: true, value: status() };
          });
        }
        if (route === 'jonesCode.authorize') {
          if (!config || state === 'authorizing') return { ok: false, kind: 'unavailable' };
          state = 'authorizing';
          try { const value = await authorizeJones(config.base, url => shell.openExternal(url)); await credentials.write(value); credential = value; client = undefined; generation++; state = 'connected'; checkedAt = 0; await refreshCompatibility(true); }
          catch { state = 'needs-authorization'; return { ok: false, kind: 'unavailable' }; }
          return { ok: true, value: status() };
        }
        if (route === 'jonesCode.projects') {
          const value = await projects() as { projects: unknown[] }; const choices: JonesSelection[] = [];
          selections.clear();
          for (const item of value.projects) if (record(item) && key(item.id) && label(item.title)) { const token = randomUUID(); selections.set(token, { kind: 'project', id: String(item.id), projectId: String(item.id), label: String(item.title), model: null, epoch: generation }); choices.push({ token, kind: 'project', label: String(item.title) }); }
          return { ok: true, value: choices };
        }
        if (route === 'jonesCode.listThreads') {
          if (!keys(params, ['token']) || !key(params.token)) return { ok: false, kind: 'invalid' };
          const selected = selections.get(String(params.token)); if (!selected || selected.kind !== 'project' || selected.epoch !== generation) return { ok: false, kind: 'unavailable' };
          const value = await (await getClient()).call('t3_thread_list', { projectId: selected.id, limit: 100 });
          if (!record(value) || !Array.isArray(value.threads) || value.threads.length > 100) throw Error('Threads unavailable');
          const choices: JonesSelection[] = [];
          for (const item of value.threads) if (record(item) && key(item.threadId) && label(item.title) && label(item.providerInstanceId) && label(item.model)) { const token = randomUUID(); selections.set(token, { kind: 'thread', id: String(item.threadId), projectId: selected.id, label: String(item.title), model: { provider: String(item.providerInstanceId), model: String(item.model) }, epoch: generation }); choices.push({ token, kind: 'thread', label: String(item.title) }); }
          return { ok: true, value: choices };
        }
        if (route === 'jonesCode.bind') {
          if (!keys(params, ['token', 'mode', 'label']) || !key(params.token) || !label(params.label) || !['existing-thread', 'new-thread'].includes(String(params.mode))) return { ok: false, kind: 'invalid' };
          const selected = selections.get(String(params.token)); if (!selected || selected.epoch !== generation || (params.mode === 'new-thread' ? selected.kind !== 'project' : selected.kind !== 'thread')) return { ok: false, kind: 'unavailable' };
          const observed = await environment();
          const identity: JonesIdentity = { hostId: observed.hostId as JonesIdentity['hostId'], receiverId: `${params.mode === 'new-thread' ? 'jones-project' : 'jones-thread'}:${hash(observed.hostId + '\0' + selected.id).slice(0, 32)}` as JonesIdentity['receiverId'], fingerprint: observed.fingerprint };
          return await exclusive(async () => {
            if (!config || selected.epoch !== generation) return { ok: false, kind: 'unavailable' };
            const previous = config.bindings.find(b => b.mode === params.mode && b.projectId === selected.projectId && b.threadId === (selected.kind === 'thread' ? selected.id : undefined));
            const binding: Binding = { locator: previous?.locator ?? `destination:${randomUUID()}`, label: String(params.label), mode: params.mode as Binding['mode'], projectId: selected.projectId, ...(selected.kind === 'thread' ? { threadId: selected.id } : {}), identity, model: selected.model };
            const next = { ...config, bindings: [...config.bindings.filter(b => b.locator !== binding.locator), binding] }; await configStore.write(next); config = next; generation++;
            return { ok: true, value: status() };
          });
        }
        if (!key(params.locator)) return { ok: false, kind: 'invalid' };
        const locator = String(params.locator);
        if (route === 'jonesCode.identify' && keys(params, ['locator'])) {
          await refreshCompatibility(true); const binding = config?.bindings.find(b => b.locator === locator);
          if (!binding || !qualifiedModes().includes(binding.mode)) return { ok: false, kind: 'unavailable', reason: compatibility.reason };
          return { ok: true, value: await receiver.identify(locator) };
        }
        if (route === 'jonesCode.send') {
          if (!keys(params, ['locator', 'handoff']) || !validHandoff(params.handoff)) return { ok: false, kind: 'invalid' };
          const binding = config?.bindings.find(b => b.locator === locator);
          await refreshCompatibility(true);
          if (!binding || !qualifiedModes().includes(binding.mode)) return { ok: true, value: { kind: 'rejected', reason: 'This environment is not qualified for delivery' } };
          return { ok: true, value: await receiver.send(locator, params.handoff) };
        }
        if (route === 'jonesCode.fence') { await refreshCompatibility(true); if (!qualifiedModes().includes('new-thread')) return { ok: false, kind: 'unavailable', reason: compatibility.reason }; }
        if ((route === 'jonesCode.lookup' || route === 'jonesCode.fence') && keys(params, ['locator', 'idempotencyKey']) && key(params.idempotencyKey)) return { ok: true, value: await receiver[route === 'jonesCode.lookup' ? 'lookup' : 'fence'](locator, String(params.idempotencyKey)) };
        if (route === 'jonesCode.readEvidence' && keys(params, ['locator', 'idempotencyKey', 'dispatchId', 'attemptId', 'receiptId']) && [params.idempotencyKey, params.dispatchId, params.attemptId, params.receiptId].every(key)) return { ok: true, value: await receiver.readEvidence(locator, String(params.idempotencyKey), params as unknown as JonesParams['jonesCode.readEvidence']) };
        return { ok: false, kind: 'invalid' };
      } catch { return { ok: false, kind: route === 'jonesCode.send' ? 'unknown' : 'unavailable' }; }
    },
  };
}

interface Profile { readonly token: string; readonly base: string; readonly label: string; readonly hostId?: string }
interface Profiles { readonly active: string | null; readonly profiles: readonly Profile[] }
export function createJonesHost(userData: string) {
  const store = jsonStore<Profiles>(join(userData, 'jones-code'), 'profiles.json');
  const hosts = new Map<string, ReturnType<typeof createJonesConnectionHost>>();
  let configuration: Profiles | undefined, serial = Promise.resolve();
  async function load() {
    configuration ??= await store.read() ?? { active: null, profiles: [] };
    if (!Array.isArray(configuration.profiles) || configuration.profiles.length > 16 || configuration.profiles.some(p => !key(p.token) || !previewTarget(p.base) || !label(p.label))) throw Error('Profiles unavailable');
    return configuration;
  }
  function host(profile: Profile) { let value = hosts.get(profile.token); if (!value) { value = createJonesConnectionHost(join(userData, 'jones-code', 'profiles', profile.token)); hosts.set(profile.token, value); } return value; }
  async function selected(hostId?: string) {
    const state = await load(); const profile = state.profiles.find(p => hostId ? p.hostId === hostId : p.token === state.active);
    if (!profile) throw Error('Environment is not enrolled'); return { profile, connection: host(profile) };
  }
  async function status() {
    const state = await load(); const snapshots = await Promise.all(state.profiles.map(async profile => ({ profile, result: await host(profile).call('jonesCode.status', {}) })));
    const active = snapshots.find(item => item.profile.token === state.active)?.result;
    const fallback: JonesStatus = { state: 'not-configured', destinations: [], descriptor: { kind: 'jones-code', label: 'Jones Code', provenance: 'jones', modes: ['existing-thread'], qualification: { level: 'unqualified', reason: 'Native Jones qualification required' } } };
    const value = active?.ok ? active.value as JonesStatus : fallback;
    const modes = [...new Set(snapshots.flatMap(item => item.result.ok ? (item.result.value as JonesStatus).descriptor.modes : []))];
    const aggregateDescriptor: JonesDescriptor = modes.length ? { ...value.descriptor, modes, qualification: { level: 'qualified', evidenceRef: 'hq-native-s1' } } : value.descriptor;
    return { ...value, descriptor: aggregateDescriptor, destinations: snapshots.flatMap(item => item.result.ok ? (item.result.value as JonesStatus).destinations : []), profiles: state.profiles.map(p => ({ token: p.token, label: p.label, active: p.token === state.active })) };
  }
  async function rememberHost(profile: Profile, hostId: string) {
    const next = serial.then(async () => { const state = await load(); const updated = { ...state, profiles: state.profiles.map(p => p.token === profile.token ? { ...p, hostId } : p) }; await store.write(updated); configuration = updated; });
    serial = next.catch(() => {}); await next;
  }
  return {
    async environment(hostId?: string) { const selectedHost = await selected(hostId); const identity = await selectedHost.connection.environment(); if (selectedHost.profile.hostId && selectedHost.profile.hostId !== identity.hostId) throw Error('Enrolled identity changed'); await rememberHost(selectedHost.profile, identity.hostId); return identity; },
    async projects(hostId?: string) { return (await selected(hostId)).connection.projects(); },
    async call(route: unknown, params: unknown): Promise<JonesResult<unknown>> {
      if (!record(params)) return { ok: false, kind: 'invalid' };
      try {
        if (route === 'jonesCode.configure') {
          if (!keys(params, ['baseUrl', 'label']) || !label(params.label)) return { ok: false, kind: 'invalid' };
          const url = previewTarget(params.baseUrl); if (!url || url.pathname !== '/' || url.search || url.hash) return { ok: false, kind: 'invalid' };
          const operation = serial.then(async (): Promise<JonesResult<unknown>> => {
            const current = await load(); const existing = current.profiles.find(p => p.base === url.origin);
            if (!existing && current.profiles.length >= 16) return { ok: false, kind: 'unavailable' };
            const profile: Profile = existing ? { ...existing, label: String(params.label) } : { token: randomUUID(), base: url.origin, label: String(params.label) };
            const result = await host(profile).call(route, params); if (!result.ok) return result;
            const next = { active: profile.token, profiles: [...current.profiles.filter(p => p.token !== profile.token), profile] }; await store.write(next); configuration = next;
            return { ok: true, value: await status() };
          }); serial = operation.then(() => {}, () => {}); return await operation;
        }
        if (route === 'jonesCode.selectProfile') {
          if (!keys(params, ['token']) || !key(params.token)) return { ok: false, kind: 'invalid' };
          const operation = serial.then(async (): Promise<JonesResult<unknown>> => { const current = await load(); if (!current.profiles.some(p => p.token === params.token)) return { ok: false, kind: 'unavailable' }; const next = { ...current, active: String(params.token) }; await store.write(next); configuration = next; return { ok: true, value: await status() }; });
          serial = operation.then(() => {}, () => {}); return await operation;
        }
        if (route === 'jonesCode.status') return keys(params, []) ? { ok: true, value: await status() } : { ok: false, kind: 'invalid' };
        let target: ReturnType<typeof createJonesConnectionHost>;
        if (typeof params.locator === 'string') {
          const current = await load(); let found: typeof target | undefined;
          for (const profile of current.profiles) { const candidate = host(profile), result = await candidate.call('jonesCode.status', {}); if (result.ok && (result.value as JonesStatus).destinations.some(destination => destination.endpoint.locator === params.locator)) { found = candidate; break; } }
          if (!found) return { ok: false, kind: 'unavailable' }; target = found;
        } else target = (await selected()).connection;
        const result = await target.call(route, params);
        if (result.ok && ['jonesCode.authorize', 'jonesCode.bind'].includes(String(route))) return { ok: true, value: await status() };
        return result;
      } catch { return { ok: false, kind: route === 'jonesCode.send' ? 'unknown' : 'unavailable' }; }
    },
  };
}
