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
const CALLS: [string, Call][] = [
  ['snapshot', (port) => port.snapshot()],
  ['saveDraft', (port) => port.saveDraft({ title: 'Fictional title', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 })],
  ['addBrand', (port) => port.addBrand('Fictional brand')],
  ['example', (port) => port.example('x-studio')],
  ['run', (port) => port.run(RUN_ID)],
  ['submitRun', (port) => port.submitRun('x-studio', { notes: 'Fictional notes' }, false)],
];

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

  describe('received HTTP responses branch on status; the exact { error } text is shown', () => {
    it.each<[string, ServiceResponse, PortError]>([
      ['409 full run queue', err(409, MESSAGES.queueFull), { kind: 'conflict', message: MESSAGES.queueFull }],
      ['409 stale draft', err(409, MESSAGES.conflict), { kind: 'conflict', message: MESSAGES.conflict }],
      ['400 validation', err(400, 'Choose a known tool and supply a JSON object'), { kind: 'invalid', message: MESSAGES.runInput }],
      ['422 validation', err(422, 'Fictional validation message'), { kind: 'invalid', message: 'Fictional validation message' }],
      ['403 after the main-process refresh', err(403, 'Reload the workspace before saving'), { kind: 'forbidden' }],
      ['404', err(404, 'Run not found'), { kind: 'not_found' }],
      ['500', err(500, 'The service could not complete this request. Your existing data is preserved.'), { kind: 'unknown', attemptedAt: NOW }],
      ['503', err(503, 'Fictional gateway text'), { kind: 'unknown', attemptedAt: NOW }],
      ['an unmapped 4xx', err(418, 'Fictional'), { kind: 'unknown', attemptedAt: NOW }],
      ['a 3xx (redirects are disabled in main)', ok({ error: 'moved' }, 302), { kind: 'unknown', attemptedAt: NOW }],
    ])('%s', async (_name, response, expected) => {
      const { transport, calls } = scriptedTransport([response]);
      expect(await rejection(createLiveSocialPort(transport, { now: at }).submitRun('x-studio', { notes: 'Fictional' }, false))).toEqual(expected);
      expect(calls).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['a null body', null],
      ['a non-string error', { error: 409 }],
      ['an error list', { error: ['Run queue is full.'] }],
      ['a missing error', { detail: 'Run queue is full.' }],
      ['a bare string', 'Run queue is full.'],
      ['an array body', [{ error: 'x' }]],
    ])('fails closed to unknown on a 409 with %s', async (_name, body) => {
      const { transport } = scriptedTransport([{ ok: true, status: 409, body, replayed: false }]);
      expect(await rejection(createLiveSocialPort(transport, { now: at }).submitRun('x-studio', {}, false))).toEqual({ kind: 'unknown', attemptedAt: NOW });
    });

    it.each([400, 403, 404, 422, 500])('fails closed to unknown on a %i with a malformed body', async (status) => {
      const { transport } = scriptedTransport([{ ok: true, status, body: { error: null }, replayed: false }]);
      expect(await rejection(createLiveSocialPort(transport, { now: at }).run(RUN_ID))).toEqual({ kind: 'unknown', attemptedAt: NOW });
    });
  });

  describe('transport failures', () => {
    it.each(CALLS)('%s: a known unavailable stays unavailable', async (_name, call) => {
      const { transport, calls } = scriptedTransport([{ ok: false, kind: 'unavailable' }]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual({ kind: 'unavailable' });
      expect(calls).toHaveLength(1);
    });

    it.each(CALLS)('%s: an unknown transport outcome is unknown', async (_name, call) => {
      const { transport } = scriptedTransport([{ ok: false, kind: 'unknown' }]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual({ kind: 'unknown', attemptedAt: NOW });
    });

    it.each(CALLS)('%s: a transport exception is unknown', async (_name, call) => {
      const { transport } = scriptedTransport([new Error('IPC channel closed')]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual({ kind: 'unknown', attemptedAt: NOW });
    });

    it.each<[string, unknown]>([
      ['the retired kind http', { ok: false, kind: 'http', status: 409, body: { error: MESSAGES.queueFull } }],
      ['ok:true without status', { ok: true, body: NATIVE.run, replayed: false }],
      ['ok:true without body', { ok: true, status: 200, replayed: false }],
      ['a non-integer status', { ok: true, status: '200', body: NATIVE.run, replayed: false }],
      ['a non-boolean replayed', { ok: true, status: 200, body: NATIVE.run, replayed: 'yes' }],
      ['undefined', undefined],
      ['a string', 'ok'],
    ])('treats a malformed envelope (%s) as unknown', async (_name, envelope) => {
      const { transport } = scriptedTransport([envelope]);
      expect(await rejection(createLiveSocialPort(transport, { now: at }).submitRun('x-studio', {}, false))).toEqual({ kind: 'unknown', attemptedAt: NOW });
    });
  });

  describe('fail-closed 2xx guards', () => {
    it.each<[string, Call, unknown]>([
      ['a run without status', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, status: undefined }],
      ['a run with an unknown status', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, status: 'done' }],
      ['a run with a boolean example flag', (port) => port.submitRun('x-studio', {}, false), { ...NATIVE.run, is_example: false }],
      ['an empty body', (port) => port.submitRun('x-studio', {}, false), null],
      ['a draft with archived 2', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, archived: 2 }],
      ['a draft without version', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, version: undefined }],
      ['a draft with malformed links', (port) => port.saveDraft({ title: 'T', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 }), { ...NATIVE.draft, links: [{ version: 2 }] }],
      ['a brand without a name', (port) => port.addBrand('Fictional'), { id: 'b1'.repeat(16) }],
      ['a workspace with an unknown tool', (port) => port.snapshot(), { ...NATIVE.workspace, tools: [{ ...NATIVE.workspace.tools[0], id: 'mystery' }] }],
      ['a workspace without runs', (port) => port.snapshot(), { ...NATIVE.workspace, runs: undefined }],
      ['a workspace with non-string features', (port) => port.snapshot(), { ...NATIVE.workspace, features: [1] }],
      ['a sample that is a list', (port) => port.example('x-studio'), [1, 2]],
      ['a run read missing its record fields', (port) => port.run(RUN_ID), { id: RUN_ID }],
    ])('%s is unknown', async (_name, call, body) => {
      const { transport, calls } = scriptedTransport([ok(body)]);
      expect(await rejection(call(createLiveSocialPort(transport, { now: at })))).toEqual({ kind: 'unknown', attemptedAt: NOW });
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
