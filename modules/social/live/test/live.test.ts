import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEATURE_HQ_REFERENCES, MESSAGES, portErrorOf, recordCalls, submitRunOnce,
  type PortError, type SocialWorkspacePort,
} from '../../core';
import { describeSocialPortConformance, type SocialPortHarness } from '../../core/test/port-conformance';
import { createLiveSocialPort } from '../port';
import { SOCIAL_SERVICE_ROUTES, socialServiceBridge, type ServiceResponse } from '../transport';
import { STUB_WORKSPACE_TOKEN, createWireStub, scriptedTransport } from './wire-stub';

/**
 * test.social-live-adapter.001: the live port passes the shared Social port suite through a fictional
 * wire-codec bridge stub, and maps hand-written synthetic exchanges in the settled seam envelope
 * (`523104b#iface.work-live-transport.001`). No exchange derives from live Social data.
 */

/** A clock after every seeded record that ticks one second per reading, shared by client and stub. */
function tickingClock(): () => Date {
  let ms = Date.parse('2026-10-20T12:00:00Z');
  return () => new Date((ms += 1000));
}

function harness(features: readonly string[]): SocialPortHarness {
  const clock = tickingClock();
  const stub = createWireStub({ clock, features });
  const { controls } = stub.service;
  return {
    port: createLiveSocialPort(stub.transport, { now: clock }),
    features,
    editElsewhere: (id) => void controls.editElsewhere(id, { title: 'Edited in another window' }),
    loseNextSubmitResponse: () => controls.loseNextSubmitResponse(),
    advanceRuns: (outcome) => controls.advanceRuns(outcome),
    restart: () => controls.restart(),
  };
}

describeSocialPortConformance('live port over a wire-codec bridge stub advertising hq-references-v1', () => harness([FEATURE_HQ_REFERENCES]));
describeSocialPortConformance("live port over a wire-codec bridge stub without features (today's service)", () => harness([]));

const NOW = '2026-10-20T12:00:00.000Z';
const at = () => new Date(NOW);
const RUN_ID = 'a1'.repeat(16);

const ok = (body: unknown, status = 200): ServiceResponse => ({ ok: true, status, body, replayed: false });
const err = (status: number, error: unknown): ServiceResponse => ({ ok: true, status, body: { error }, replayed: false });

/** Exact synthetic native bodies, shaped as the recorded `server.py` writes them. Every value is invented. */
const NATIVE = {
  workspace: {
    brands: [{ id: 'default', name: 'My workspace' }, { id: 'b0'.repeat(16), name: 'Harbor Lane Bakery' }],
    content: [{
      id: 'c0'.repeat(16), title: 'Rye loaf launch', body: 'Fictional body.', brand_id: 'b0'.repeat(16), channel: 'X',
      planned_date: '2026-11-02', archived: 0, updated_at: '2026-10-19T08:00:00+00:00', version: 3,
    }],
    runs: [{ id: RUN_ID, tool: 'x-studio', status: 'queued', is_example: 1, created_at: '2026-10-19T09:00:00+00:00', finished_at: null, error: null }],
    tools: [{ id: 'x-studio', name: 'Writing studio', category: 'Create', description: 'Fictional description.', mark: 'W' }],
    csrf: STUB_WORKSPACE_TOKEN,
  },
  run: { id: RUN_ID, tool: 'x-studio', status: 'queued', is_example: 0, created_at: '2026-10-20T12:00:01+00:00', finished_at: null, error: null },
  draft: {
    id: 'd0'.repeat(16), title: 'Fictional title', body: '', brand_id: 'default', channel: 'General',
    planned_date: '', archived: 0, updated_at: '2026-10-20T12:00:01+00:00', version: 1,
  },
} as const;

async function rejection(promise: Promise<unknown>): Promise<PortError> {
  try {
    await promise;
  } catch (reason) {
    const error = portErrorOf(reason);
    if (!error) throw reason;
    return error;
  }
  throw new Error('Expected the port call to reject');
}

type Call = (port: SocialWorkspacePort) => Promise<unknown>;
type RouteClass = 'read' | 'mutation';
/** Every port method, by the class of its single route: `workspace`, `sample`, `run` read; the rest mutate. */
const CALLS: [string, RouteClass, Call][] = [
  ['snapshot', 'read', (port) => port.snapshot()],
  ['example', 'read', (port) => port.example('x-studio')],
  ['run', 'read', (port) => port.run(RUN_ID)],
  ['saveDraft', 'mutation', (port) => port.saveDraft({ title: 'Fictional title', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 })],
  ['addBrand', 'mutation', (port) => port.addBrand('Fictional brand')],
  ['submitRun', 'mutation', (port) => port.submitRun('x-studio', { notes: 'Fictional notes' }, false)],
];
/** The settled seam: an uncertain read is `unavailable`; an uncertain mutation is `unknown`. */
const UNCERTAIN: { readonly [C in RouteClass]: PortError } = { read: { kind: 'unavailable' }, mutation: { kind: 'unknown', attemptedAt: NOW } };

describe('live Social port: exact synthetic exchanges', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps the native workspace body: client observedAt, features [] when absent, no workspace token', async () => {
    const { transport, calls } = scriptedTransport([ok(NATIVE.workspace)]);
    const snapshot = await createLiveSocialPort(transport, { now: at }).snapshot();
    expect(calls).toEqual([{ route: 'workspace', params: {} }]);
    expect(snapshot).toStrictEqual({
      brands: NATIVE.workspace.brands, content: NATIVE.workspace.content, runs: NATIVE.workspace.runs,
      tools: NATIVE.workspace.tools, features: [], observedAt: NOW,
    });
    expect(JSON.stringify(snapshot)).not.toContain(STUB_WORKSPACE_TOKEN);
  });

  it('keeps advertised features and accepts and ignores replayed', async () => {
    const { transport } = scriptedTransport([{ ok: true, status: 200, body: { ...NATIVE.workspace, features: [FEATURE_HQ_REFERENCES] }, replayed: true }]);
    expect((await createLiveSocialPort(transport, { now: at }).snapshot()).features).toEqual([FEATURE_HQ_REFERENCES]);
  });

  it('sends exactly the closed routes with the service request bodies and no transport details', async () => {
    const { transport, calls } = scriptedTransport([ok({}), ok(NATIVE.run), ok(NATIVE.draft), ok(NATIVE.draft), ok({ id: 'b1'.repeat(16), name: 'Fictional brand' }), ok(NATIVE.run)]);
    const port = createLiveSocialPort(transport, { now: at });
    await port.example('x-studio');
    await port.run(RUN_ID);
    await port.saveDraft({ title: '  Fictional title  ', body: ' kept ', brand_id: 'default', channel: 'General', planned_date: '', archived: 0, links: [] });
    await port.saveDraft({ title: 'Fictional title', body: '', brand_id: 'default', channel: 'X', planned_date: '2026-11-02', archived: 1, id: 'd0'.repeat(16), version: 4 });
    await port.addBrand('  Fictional brand ');
    await port.submitRun('x-studio', { notes: 'Fictional notes' }, true);
    expect(calls).toEqual([
      { route: 'sample', params: { tool: 'x-studio' } },
      { route: 'run', params: { id: RUN_ID } },
      { route: 'saveContent', params: { title: 'Fictional title', body: ' kept ', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 } },
      { route: 'saveContent', params: { title: 'Fictional title', body: '', brand_id: 'default', channel: 'X', planned_date: '2026-11-02', archived: 1, id: 'd0'.repeat(16), version: 4 } },
      { route: 'addBrand', params: { name: 'Fictional brand' } },
      { route: 'submitRun', params: { tool: 'x-studio', input: { notes: 'Fictional notes' }, is_example: true } },
    ]);
    expect(calls.every((call) => (SOCIAL_SERVICE_ROUTES as readonly string[]).includes(call.route))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/https?:|token|csrf|header|X-Workspace/iu);
  });

  it('validates before sending: invalid drafts, brands, runs, tools and run IDs make zero transport calls', async () => {
    const { transport, calls } = scriptedTransport([]);
    const port = createLiveSocialPort(transport, { now: at });
    expect(await rejection(port.saveDraft({ title: '', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(port.addBrand('   '))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(port.submitRun('x-studio', ['notes'] as unknown as Record<string, unknown>, false))).toEqual({ kind: 'invalid', message: MESSAGES.runInput });
    expect(await rejection(port.example('no-such-tool' as never))).toEqual({ kind: 'invalid', message: MESSAGES.unknownTool });
    expect(await rejection(port.run('not-a-run'))).toEqual({ kind: 'invalid', message: MESSAGES.runId });
    expect(calls).toEqual([]);
  });

  it('rejects links locally, after one capability read, when the service does not advertise hq-references-v1', async () => {
    const { transport, calls } = scriptedTransport([ok(NATIVE.workspace)]);
    const port = createLiveSocialPort(transport, { now: at });
    const links = [{ version: 1, domain: 'work', projectId: 'p', kind: 'item', entityId: 'card-1', title: 'Card', returnDestination: { domain: 'social', destination: 'library' } }];
    const draft = { title: 'Linked', body: '', brand_id: 'default', channel: 'General' as const, planned_date: '', archived: 0 as const, links: links as never };
    expect(await rejection(port.saveDraft(draft))).toEqual({ kind: 'invalid', message: MESSAGES.linksUnsupported });
    expect(await rejection(port.saveDraft(draft))).toEqual({ kind: 'invalid', message: MESSAGES.linksUnsupported });
    expect(calls.map((call) => call.route)).toEqual(['workspace']);
  });

  it.each<[string, unknown]>([
    ['a transport exception', new Error('IPC channel closed')],
    ['an unknown transport outcome', { ok: false, kind: 'unknown' }],
    ['a known unavailable', { ok: false, kind: 'unavailable' }],
    ['a 500', err(500, 'The service could not complete this request. Your existing data is preserved.')],
    ['a 403', err(403, 'Unrecognized host')],
    ['a malformed workspace body', ok({ brands: 'none' })],
  ])('makes no mutation and is unavailable when the capability pre-read fails with %s', async (_name, outcome) => {
    const { transport, calls } = scriptedTransport([outcome]);
    const links = [{ version: 1, domain: 'work', projectId: 'p', kind: 'item', entityId: 'card-1', title: 'Card', returnDestination: { domain: 'social', destination: 'library' } }];
    const draft = { title: 'Linked', body: '', brand_id: 'default', channel: 'General' as const, planned_date: '', archived: 0 as const, links: links as never };
    expect(await rejection(createLiveSocialPort(transport, { now: at }).saveDraft(draft))).toEqual({ kind: 'unavailable' });
    expect(calls.map((call) => call.route)).toEqual(['workspace']);
  });

  describe.each(CALLS)('%s (%s route): received HTTP responses branch on status', (_method, routeClass, call) => {
    it.each<[string, ServiceResponse, PortError]>([
      ['409 full run queue', err(409, MESSAGES.queueFull), { kind: 'conflict', message: MESSAGES.queueFull }],
      ['409 stale draft', err(409, MESSAGES.conflict), { kind: 'conflict', message: MESSAGES.conflict }],
      ['400 validation', err(400, 'Choose a known tool and supply a JSON object'), { kind: 'invalid', message: MESSAGES.runInput }],
      ['422 validation', err(422, 'Fictional validation message'), { kind: 'invalid', message: 'Fictional validation message' }],
      ['403 after the main-process refresh', err(403, 'Reload the workspace before saving'), { kind: 'forbidden' }],
      ['404', err(404, 'Run not found'), { kind: 'not_found' }],
    ])('a known %s keeps its meaning and exact { error } text', async (_name, response, expected) => {
      const { transport, calls } = scriptedTransport([response]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual(expected);
      expect(calls).toHaveLength(1);
    });

    it.each<[string, ServiceResponse]>([
      ['500', err(500, 'The service could not complete this request. Your existing data is preserved.')],
      ['503', err(503, 'Fictional gateway text')],
      ['an unmapped 4xx', err(418, 'Fictional')],
      ['a 3xx (redirects are disabled in main)', ok({ error: 'moved' }, 302)],
      ['409 with a null body', ok(null, 409)],
      ['409 with a non-string error', err(409, 409)],
      ['409 with an error list', err(409, ['Run queue is full.'])],
      ['409 with a missing error', ok({ detail: 'Run queue is full.' }, 409)],
      ['409 with a bare string', ok('Run queue is full.', 409)],
      ['409 with an array body', ok([{ error: 'x' }], 409)],
      ...[400, 403, 404, 422, 500].map((status): [string, ServiceResponse] => [`${status} with a null error`, err(status, null)]),
    ])('an uncertain %s is unavailable on a read and unknown on a mutation', async (_name, response) => {
      const { transport, calls } = scriptedTransport([response]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual(UNCERTAIN[routeClass]);
      expect(calls).toHaveLength(1);
    });
  });

  describe.each(CALLS)('%s (%s route): transport failures', (_method, routeClass, call) => {
    it('a known unavailable stays unavailable', async () => {
      const { transport, calls } = scriptedTransport([{ ok: false, kind: 'unavailable' }]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual({ kind: 'unavailable' });
      expect(calls).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['an unknown transport outcome', { ok: false, kind: 'unknown' }],
      ['a transport exception', new Error('IPC channel closed')],
      ['the retired kind http', { ok: false, kind: 'http', status: 409, body: { error: MESSAGES.queueFull } }],
      ['ok:true without status', { ok: true, body: NATIVE.run, replayed: false }],
      ['ok:true without body', { ok: true, status: 200, replayed: false }],
      ['a non-integer status', { ok: true, status: '200', body: NATIVE.run, replayed: false }],
      ['a non-boolean replayed', { ok: true, status: 200, body: NATIVE.run, replayed: 'yes' }],
      ['an undefined envelope', undefined],
      ['a string envelope', 'ok'],
    ])('%s is unavailable on a read and unknown on a mutation', async (_name, outcome) => {
      const { transport, calls } = scriptedTransport([outcome]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual(UNCERTAIN[routeClass]);
      expect(calls).toHaveLength(1);
    });
  });

  describe('fail-closed 2xx guards', () => {
    it.each<[string, RouteClass, Call, unknown]>([
      ['a run without status', 'mutation', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, status: undefined }],
      ['a run with an unknown status', 'mutation', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, status: 'done' }],
      ['a run with a boolean example flag', 'mutation', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, is_example: false }],
      ['an empty submit body', 'mutation', (port) => port.submitRun('x-studio', {}, false), null],
      ['a draft with archived 2', 'mutation', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, archived: 2 }],
      ['a draft without version', 'mutation', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, version: undefined }],
      ['a draft with malformed links', 'mutation', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, links: [{ version: 2 }] }],
      ['a brand without a name', 'mutation', (port) => port.addBrand('Fictional'), { id: 'b1'.repeat(16) }],
      ['a workspace with an unknown tool', 'read', (port) => port.snapshot(), { ...NATIVE.workspace, tools: [{ ...NATIVE.workspace.tools[0], id: 'mystery' }] }],
      ['a workspace without runs', 'read', (port) => port.snapshot(), { ...NATIVE.workspace, runs: undefined }],
      ['a workspace with non-string features', 'read', (port) => port.snapshot(), { ...NATIVE.workspace, features: [1] }],
      ['an empty workspace body', 'read', (port) => port.snapshot(), null],
      ['a sample that is a list', 'read', (port) => port.example('x-studio'), [1, 2]],
      ['a run read missing its record fields', 'read', (port) => port.run(RUN_ID), { id: RUN_ID }],
    ])('%s (%s) is uncertain', async (_name, routeClass, call, body) => {
      const { transport, calls } = scriptedTransport([ok(body)]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual(UNCERTAIN[routeClass]);
      expect(calls).toHaveLength(1);
    });

    it('drops fields the port does not promise', async () => {
      const { transport } = scriptedTransport([ok({ ...NATIVE.draft, extra: 'dropped' })]);
      const saved = await createLiveSocialPort(transport, { now: at }).saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 });
      expect(saved).toStrictEqual(NATIVE.draft);
    });
  });

  describe('submitRun is never retried', () => {
    it.each<[string, ServiceResponse | Error | unknown]>([
      ['a thrown transport error', new Error('timeout')],
      ['ok:false unknown', { ok: false, kind: 'unknown' }],
      ['a malformed 2xx result', ok({ id: RUN_ID })],
      ['a 500', err(500, 'The service could not complete this request. Your existing data is preserved.')],
      ['ok:false unavailable', { ok: false, kind: 'unavailable' }],
      ['a 409 full queue', err(409, MESSAGES.queueFull)],
    ])('makes exactly one submit call after %s', async (_name, response) => {
      const { transport, calls } = scriptedTransport([response]);
      const recorded = recordCalls(createLiveSocialPort(transport, { now: at }));
      await submitRunOnce(recorded.port, 'x-studio', { notes: 'Once' }, false);
      expect(calls).toEqual([{ route: 'submitRun', params: { tool: 'x-studio', input: { notes: 'Once' }, is_example: false } }]);
      expect(recorded.callsOf('execution')).toHaveLength(1);
    });

    it('reports a lost result as unknown with exactly one submit call, and the stub service holds exactly one new run', async () => {
      const clock = tickingClock();
      const stub = createWireStub({ clock, features: [] });
      const port = createLiveSocialPort(stub.transport, { now: clock });
      const before = stub.service.controls.inspect().runs.length;
      stub.service.controls.loseNextSubmitResponse();
      const outcome = await submitRunOnce(port, 'x-studio', { notes: 'Lost' }, false);
      expect(outcome.kind).toBe('unknown');
      expect(stub.callsTo('submitRun')).toHaveLength(1);
      expect(stub.service.controls.inspect().runs).toHaveLength(before + 1);
    });
  });

  it('makes no network request from the renderer side', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const stub = createWireStub({ clock: tickingClock(), features: [] });
    const port = createLiveSocialPort(stub.transport);
    await port.snapshot();
    await port.submitRun('x-studio', { notes: 'Offline' }, false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('socialServiceBridge', () => {
  it('returns the Social transport only when it is structurally valid', () => {
    const social = { call: async () => ({ ok: false, kind: 'unavailable' }) };
    expect(socialServiceBridge({ hqServices: { social } })).toBe(social);
    expect(socialServiceBridge({})).toBeNull();
    expect(socialServiceBridge({ hqServices: null })).toBeNull();
    expect(socialServiceBridge({ hqServices: { social: {} } })).toBeNull();
    expect(socialServiceBridge({ hqServices: { social: { call: 'workspace' } } })).toBeNull();
    expect(socialServiceBridge({ hqServices: { work: social } })).toBeNull();
    expect(socialServiceBridge(undefined)).toBeNull();
  });
});

import { FEATURE_HQ_EDITORIAL_TIMEBOX, SLOT_MESSAGES } from '../../core';
import { guardDraft, guardWorkspace } from '../guards';

describe('live editorial timebox contract', () => {
  const slot = { start: '09:15', duration_minutes: 30, timezone: 'America/New_York' };
  it('sends one canonical slot save and no execution, learning capability once if needed', async () => {
    const stub = createWireStub({ features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    const port = createLiveSocialPort(stub.transport);
    const draft = (await stub.service.port.snapshot()).content.find((item) => item.planned_date && !item.archived)!;
    const saved = await port.saveDraft({ ...draft, planning_slot: slot });
    expect(saved.planning_slot).toEqual(slot);
    expect(stub.calls.map((call) => call.route)).toEqual(['workspace', 'saveContent']);
    expect(stub.callsTo('saveContent')[0]!.params).toMatchObject({ planning_slot: slot, version: draft.version });
    await port.saveDraft({ ...saved, planning_slot: undefined });
    expect(stub.callsTo('saveContent')[1]!.params).toMatchObject({ planning_slot: null });
  });
  it('rejects a timed save without capability and leaves date-only saves compatible', async () => {
    const stub = createWireStub({ features: [] });
    const port = createLiveSocialPort(stub.transport);
    const draft = (await port.snapshot()).content.find((item) => item.planned_date && !item.archived)!;
    await expect(port.saveDraft({ ...draft, planning_slot: slot })).rejects.toMatchObject({ error: { kind: 'invalid', message: SLOT_MESSAGES.unsupported } });
    expect(stub.callsTo('saveContent')).toHaveLength(0);
    await port.saveDraft({ ...draft, planning_slot: null });
    expect(stub.callsTo('saveContent')[0]!.params).not.toHaveProperty('planning_slot');
  });
  it('rejects malformed known slots and strips unsupported valid slots', () => {
    const draft = NATIVE.workspace.content[0]!;
    expect(guardDraft({ ...draft, planning_slot: { ...slot, extra: true } })).toBeNull();
    expect(guardDraft({ ...draft, planning_slot: slot }, [])).not.toHaveProperty('planning_slot');
    expect(guardWorkspace({ ...NATIVE.workspace, features: [FEATURE_HQ_EDITORIAL_TIMEBOX], content: [{ ...draft, planning_slot: [] }] })).toBeNull();
  });
  it('keeps the authoritative service validation message and never retries', async () => {
    const workspace = { ...NATIVE.workspace, features: [FEATURE_HQ_EDITORIAL_TIMEBOX] };
    const scripted = scriptedTransport([ok(workspace), err(400, SLOT_MESSAGES.dst)]);
    const port = createLiveSocialPort(scripted.transport);
    const draft = (await port.snapshot()).content[0]!;
    await expect(port.saveDraft({ ...draft, planning_slot: slot })).rejects.toMatchObject({ error: { kind: 'invalid', message: SLOT_MESSAGES.dst } });
    expect(scripted.calls.map((call) => call.route)).toEqual(['workspace', 'saveContent']);
  });
});
