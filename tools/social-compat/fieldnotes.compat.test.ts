import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReferenceEnvelope } from '@hq/contracts';
import type { ServiceResponse } from '@hq/contracts/services';
import { createServices, sendHttp, type Transport } from '../../apps/desktop/electron/services';
import { endpoint, openServiceConfig, type ServiceConfig } from '../../apps/desktop/electron/service-config';
import {
  ACTIVE_RUN_STATUSES, MESSAGES, SLOT_MESSAGES, TOOL_IDS, checkDraft, portErrorOf,
  type Draft, type DraftFields, type PortError, type RunRecord, type SaveDraft, type ToolId,
} from '../../modules/social/core';
import { createLiveSocialPort } from '../../modules/social/live';
import { summarizeRun } from '../../modules/social/workbench/results';
import { FieldnotesInstance, readEnvironment, revisionOf } from './fieldnotes';

/**
 * HQ's real desktop Social bridge (`createServices` + `sendHttp`) and live port (`createLiveSocialPort`)
 * against a real, disposable, loopback-only Fieldnotes. Fixtures here are fictional and written for this
 * check; nothing is read from the Fieldnotes checkout's own data. Capability-dependent checks (links) follow
 * the features the service advertises, so one file covers a revision with and without `hq-references-v1`.
 */

const TIMEBOX = 'hq-editorial-timebox-v1';
const REFERENCES = 'hq-references-v1';
const RUN_LIMIT_MS = 90_000;
const hex32 = /^[0-9a-f]{32}$/;

const environment = readEnvironment();
const fieldnotes = await FieldnotesInstance.create(environment);
afterAll(() => fieldnotes.dispose());
const revision = await revisionOf(environment.root);

async function rawWorkspace(): Promise<{ features: string[]; runs: unknown[]; bytes: number }> {
  const response = await fetch(new URL('api/workspace', fieldnotes.url));
  const buffer = Buffer.from(await response.arrayBuffer());
  return { ...(JSON.parse(buffer.toString('utf8')) as { features: string[]; runs: unknown[] }), bytes: buffer.length };
}
const features = (await rawWorkspace()).features;
const timebox = features.includes(TIMEBOX);
const references = features.includes(REFERENCES);

/** The real `sendHttp`, with every exchange written down so a check can name the exact wire sequence. */
interface Exchange { readonly method: string; readonly path: string; readonly status: number | 'lost'; readonly body?: string }
const recording = (log: Exchange[]): Transport => async (url, call) => {
  const response = await sendHttp(url, call);
  log.push({ method: call.method, path: call.path, status: response.ok ? response.status : 'lost', ...(call.body === undefined ? {} : { body: call.body }) });
  return response;
};
const configFor = (base: URL): ServiceConfig => ({
  get: (domain) => (domain === 'social' ? base : null),
  status: () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }),
  set: async () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }),
});

const exchanges: Exchange[] = [];
const main = createServices(configFor(fieldnotes.url), recording(exchanges));
const port = createLiveSocialPort({ call: main.social });
const wire = (from: number) => exchanges.slice(from).map(({ method, path, status }) => `${method} ${path} ${status}`);
const lastContentBody = (from: number): Record<string, unknown> =>
  JSON.parse(exchanges.slice(from).filter((exchange) => exchange.path === '/api/content').at(-1)?.body ?? 'null') as Record<string, unknown>;

async function rejection(promise: Promise<unknown>): Promise<PortError> {
  try {
    await promise;
  } catch (reason) {
    const error = portErrorOf(reason);
    if (error) return error;
    throw reason;
  }
  throw new Error('Expected the call to be rejected, but it resolved');
}
function answered(response: ServiceResponse): { status: number; body: unknown } {
  if (!response.ok) throw new Error(`The bridge reported a transport failure (${response.kind}), not an HTTP answer`);
  return response;
}

const fieldsOf = (d: Draft) => ({ title: d.title, body: d.body, brand_id: d.brand_id, channel: d.channel, planned_date: d.planned_date, archived: d.archived });
const draft = (overrides: Partial<DraftFields> = {}): SaveDraft => ({ title: 'Compat draft', body: 'A fictional body for the compatibility check.', brand_id: 'default', channel: 'General', planned_date: '', archived: 0, ...overrides });
const update = (current: Draft, overrides: Partial<DraftFields> = {}): SaveDraft => ({ ...fieldsOf(current), id: current.id, version: current.version, ...overrides });
const link = (entityId: string, extra: Partial<ReferenceEnvelope> = {}): ReferenceEnvelope => ({
  version: 1, domain: 'work', projectId: 'compat-project', kind: 'item', entityId, title: `Compat reference ${entityId}`,
  returnDestination: { domain: 'work', destination: `board/${entityId}` }, ...extra,
});

async function settle(id: string): Promise<RunRecord> {
  const deadline = Date.now() + RUN_LIMIT_MS;
  for (;;) {
    const run = await port.run(id);
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) return run;
    if (Date.now() > deadline) throw new Error(`Run ${id} was still ${run.status} after ${RUN_LIMIT_MS} ms`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

const shared: { draft?: Draft; durations: Map<ToolId, number>; backlog: string[] } = { durations: new Map(), backlog: [] };
const slowest = (): ToolId => [...shared.durations].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'x-studio';

describe(`Fieldnotes ${revision.slice(0, 9)} [${features.join(', ') || 'no features'}]`, () => {
  console.info(`[compat] revision ${revision}; features ${JSON.stringify(features)}; loopback ${fieldnotes.url.origin}`);

  it('snapshot: the guards accept the real workspace and the CSRF token stays inside the bridge', async () => {
    const raw = answered(await main.social('workspace', {}));
    expect(raw.status).toBe(200);
    expect(raw.body).not.toHaveProperty('csrf');
    for (const key of ['brands', 'content', 'runs', 'tools', 'features']) expect(raw.body).toHaveProperty(key);
    const snapshot = await port.snapshot();
    expect(snapshot.brands).toContainEqual({ id: 'default', name: 'My workspace' });
    expect(snapshot.content).toEqual([]);
    expect(snapshot.runs).toEqual([]);
    expect(snapshot.tools.map((tool) => tool.id).sort()).toEqual([...TOOL_IDS].sort());
    expect(snapshot.features).toEqual(features);
    expect(Number.isNaN(Date.parse(snapshot.observedAt))).toBe(false);
  });

  it('addBrand: creates a brand that the next snapshot lists', async () => {
    const brand = await port.addBrand('  Compat Brand  ');
    expect(brand).toEqual({ id: expect.stringMatching(hex32), name: 'Compat Brand' });
    expect((await port.snapshot()).brands.map((item) => item.name)).toEqual(['Compat Brand', 'My workspace']);
  });

  it('saveDraft: create and update advance the version and appear in the next snapshot', async () => {
    const brand = (await port.snapshot()).brands.find((item) => item.name === 'Compat Brand')!;
    const created = await port.saveDraft(draft({ title: 'First draft', brand_id: brand.id, channel: 'LinkedIn', planned_date: '2026-11-10' }));
    expect(created).toMatchObject({ id: expect.stringMatching(hex32), version: 1, title: 'First draft', brand_id: brand.id, channel: 'LinkedIn', planned_date: '2026-11-10', archived: 0 });
    const updated = await port.saveDraft(update(created, { title: 'First draft, edited', archived: 1 }));
    expect(updated).toMatchObject({ id: created.id, version: 2, title: 'First draft, edited', archived: 1 });
    expect(Number.isNaN(Date.parse(updated.updated_at))).toBe(false);
    expect((await port.snapshot()).content.find((item) => item.id === created.id)).toEqual(updated);
    shared.draft = updated;
  });

  it('saveDraft: a stale version, or an unknown id, is a conflict carrying the service text', async () => {
    const current = shared.draft!;
    const stale = await rejection(port.saveDraft({ ...fieldsOf(current), title: 'Stale write', id: current.id, version: current.version - 1 }));
    expect(stale).toEqual({ kind: 'conflict', message: MESSAGES.conflict });
    const unknown = await rejection(port.saveDraft({ ...fieldsOf(current), id: 'f'.repeat(32), version: 1 }));
    expect(unknown).toEqual({ kind: 'conflict', message: MESSAGES.conflict });
    expect((await port.snapshot()).content.find((item) => item.id === current.id)).toEqual(current);
  });

  it('saveDraft: an unknown brand is invalid with the service text', async () => {
    expect(await rejection(port.saveDraft(draft({ brand_id: 'no-such-brand' })))).toEqual({ kind: 'invalid', message: MESSAGES.unknownBrand });
  });

  it("saveDraft: the service's validation text matches HQ's local rules (sent past the port)", async () => {
    const valid = { title: 'Parity', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 };
    const slot = { start: '09:30', duration_minutes: 60, timezone: 'America/New_York' };
    const cases: Record<string, Record<string, unknown>> = {
      'blank title': { title: '   ' },
      'title over 200 characters': { title: 'x'.repeat(201) },
      'body over 50,000 characters': { body: 'x'.repeat(50_001) },
      'unknown channel': { channel: 'Telegram' },
      'impossible date': { planned_date: '2026-02-30' },
      ...(timebox ? {
        'slot without a date': { planning_slot: slot },
        'slot start off the quarter hour': { planned_date: '2026-11-10', planning_slot: { ...slot, start: '09:10' } },
        'slot duration off the quarter hour': { planned_date: '2026-11-10', planning_slot: { ...slot, duration_minutes: 20 } },
        'slot past midnight': { planned_date: '2026-11-10', planning_slot: { ...slot, start: '23:30', duration_minutes: 60 } },
        'slot in an unknown zone': { planned_date: '2026-11-10', planning_slot: { ...slot, timezone: 'Mars/Olympus' } },
        'slot in a daylight-saving gap': { planned_date: '2027-03-14', planning_slot: { start: '02:30', duration_minutes: 30, timezone: 'America/New_York' } },
      } : {}),
    };
    // The service answers an out-of-range calendar date with Python's own text. HQ never shows it, because the
    // port rejects such a date locally first, so only the 400 is required and any difference is logged.
    const textMayDiffer = new Set(['impossible date']);
    const mismatches: string[] = [];
    for (const [name, override] of Object.entries(cases)) {
      const body = { ...valid, ...override };
      const local = checkDraft(body, { features: timebox ? [TIMEBOX] : [] });
      const remote = answered(await main.social('saveContent', body));
      const text = (remote.body as { error?: string }).error;
      const localText = local.ok ? 'accepted' : local.error.message;
      if (text !== localText) console.info(`[compat] validation text differs for "${name}": HQ "${localText}", service "${text ?? ''}"`);
      if (local.ok || remote.status !== 400 || (text !== localText && !textMayDiffer.has(name))) mismatches.push(`${name}: HQ "${localText}" vs service ${remote.status} "${text ?? ''}"`);
    }
    expect(mismatches).toEqual([]);
  });

  it('planning slots: set, replace, keep and clear', async () => {
    const slotA = { start: '09:30', duration_minutes: 60, timezone: 'America/New_York' };
    const slotB = { start: '14:00', duration_minutes: 30, timezone: 'America/New_York' };
    if (!timebox) {
      expect(await rejection(port.saveDraft(draft({ planned_date: '2026-11-10', planning_slot: slotA })))).toEqual({ kind: 'invalid', message: SLOT_MESSAGES.unsupported });
      return;
    }
    const set = await port.saveDraft(draft({ title: 'Slot draft', planned_date: '2026-11-10', planning_slot: slotA }));
    expect(set.planning_slot).toEqual(slotA);
    // Keep: the service keeps the stored slot when the request omits it. Sent past the port, which names the slot.
    const kept = answered(await main.social('saveContent', { ...fieldsOf(set), id: set.id, version: set.version, title: 'Kept slot' }));
    expect(kept).toMatchObject({ status: 200, body: { version: 2, planning_slot: slotA } });
    const replaced = await port.saveDraft(update(kept.body as Draft, { planning_slot: slotB }));
    expect(replaced.planning_slot).toEqual(slotB);
    const cleared = await port.saveDraft(update(replaced, { planning_slot: null }));
    expect(cleared.planning_slot).toBeNull();
    const reset = await port.saveDraft(update(cleared, { planning_slot: slotA }));
    // Once the features are known the port sends an omitted slot as an explicit null, which clears it.
    const mark = exchanges.length;
    const omitted = await port.saveDraft(update(reset));
    expect(omitted.planning_slot).toBeNull();
    expect(lastContentBody(mark)).toHaveProperty('planning_slot', null);
    // A port that has not read the workspace yet sends nothing for an omitted slot, so the service keeps it.
    const stored = await port.saveDraft(update(omitted, { planning_slot: slotA }));
    const fresh = createLiveSocialPort({ call: main.social });
    const before = exchanges.length;
    await fresh.saveDraft(update(stored, { title: 'Kept by a port with no features yet' }));
    expect(lastContentBody(before)).not.toHaveProperty('planning_slot');
    expect((await port.snapshot()).content.find((item) => item.id === stored.id)?.planning_slot).toEqual(slotA);
  });

  it(references ? 'links (hq-references-v1): save, preserve when absent, clear with [], reject a duplicate target' : 'links (no hq-references-v1): the port refuses them locally and sends nothing', async () => {
    const first = link('compat-a');
    const second = link('compat-b', { sourceRevision: 'revision-7', workspaceId: 'workspace-1' });
    if (!references) {
      const mark = exchanges.length;
      expect(await rejection(port.saveDraft(draft({ links: [first] })))).toEqual({ kind: 'invalid', message: MESSAGES.linksUnsupported });
      expect(exchanges.length).toBe(mark);
      const plain = await port.saveDraft(draft({ title: 'Empty links are simply not sent', links: [] }));
      expect(plain.links).toBeUndefined();
      expect(lastContentBody(mark)).not.toHaveProperty('links');
      // Why the guard matters: past the port, this service accepts the field and silently drops it.
      const dropped = answered(await main.social('saveContent', { ...fieldsOf(plain), links: [first] }));
      expect(dropped.status).toBe(200);
      expect(dropped.body).not.toHaveProperty('links');
      return;
    }
    const created = await port.saveDraft(draft({ title: 'Linked draft', links: [first, second] }));
    expect(created.links).toEqual([first, second]);
    const mark = exchanges.length;
    const preserved = await port.saveDraft(update(created, { title: 'Linked draft, renamed' }));
    expect(lastContentBody(mark)).not.toHaveProperty('links');
    expect(preserved.links).toEqual([first, second]);
    expect((await port.snapshot()).content.find((item) => item.id === created.id)?.links).toEqual([first, second]);
    const cleared = await port.saveDraft(update(preserved, { links: [] }));
    expect(cleared.links).toEqual([]);
    const duplicate = await rejection(port.saveDraft(update(cleared, { links: [first, { ...first, title: 'Same target, other title' }] })));
    expect(duplicate.kind).toBe('invalid');
    console.info(`[compat] duplicate link target text: ${JSON.stringify('message' in duplicate ? duplicate.message : '')}`);
    expect((await port.snapshot()).content.find((item) => item.id === created.id)?.links).toEqual([]);
  });

  it('example: a sample for all eight tools; an unknown tool is invalid or a 400', async () => {
    for (const tool of TOOL_IDS) {
      const sample = await port.example(tool);
      expect(Object.keys(sample).length, `${tool} sample has no fields`).toBeGreaterThan(0);
      console.info(`[compat] example ${tool}: fields ${Object.keys(sample).join(', ')}`);
    }
    expect(answered(await main.social('sample', { tool: 'no-such-tool' }))).toMatchObject({ status: 400, body: { error: MESSAGES.unknownTool } });
    expect(await rejection(port.example('no-such-tool' as ToolId))).toEqual({ kind: 'invalid', message: MESSAGES.unknownTool });
  });

  it.each(TOOL_IDS)('run %s: the example submits, reaches a terminal state and summarizes as a result', async (tool) => {
    const submitted = await port.submitRun(tool, await port.example(tool), true);
    expect(submitted).toMatchObject({ id: expect.stringMatching(hex32), tool, is_example: 1 });
    expect(['queued', 'running']).toContain(submitted.status);
    const started = Date.now();
    const done = await settle(submitted.id);
    shared.durations.set(tool, Date.now() - started);
    const summary = summarizeRun(done);
    console.info(`[compat] run ${tool}: ${done.status}, summary ${summary?.kind}, ${Date.now() - started} ms${summary?.kind === 'failed' ? `, ${summary.error}` : ''}`);
    expect(summary?.kind, `${tool}: ${summary?.error ?? done.error ?? 'no summary'}`).toBe('result');
  }, RUN_LIMIT_MS + 10_000);

  it('run: an unknown id is not_found; a malformed id is invalid', async () => {
    expect(await rejection(port.run('0'.repeat(32)))).toEqual({ kind: 'not_found' });
    expect(answered(await main.social('run', { id: 'zzzzzz' }))).toMatchObject({ status: 400, body: { error: MESSAGES.runId } });
  });

  it('queue: when it is full the next run is a conflict carrying the service text', async () => {
    const tool = slowest();
    const input = await port.example(tool);
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      try {
        shared.backlog.push((await port.submitRun(tool, input, true)).id);
      } catch (reason) {
        expect(portErrorOf(reason)).toEqual({ kind: 'conflict', message: MESSAGES.queueFull });
        console.info(`[compat] queue full after ${shared.backlog.length} accepted ${tool} runs`);
        return;
      }
    }
    throw new Error(`The queue did not fill in 16 submissions of ${tool}; its runs finish too quickly to reproduce this here`);
  });

  describe('after a Fieldnotes restart', () => {
    beforeAll(() => fieldnotes.restart());

    it('saveContent: the first save refreshes the token exactly once, then succeeds', async () => {
      const mark = exchanges.length;
      const saved = await port.saveDraft(draft({ title: 'Saved after a restart' }));
      expect(saved.version).toBe(1);
      expect(wire(mark)).toEqual(['POST /api/content 403', 'GET /api/workspace 200', 'POST /api/content 200']);
      const next = exchanges.length;
      await port.saveDraft(update(saved, { title: 'Saved again' }));
      expect(wire(next)).toEqual(['POST /api/content 200']);
    });

    it('runs queued or running at the restart are interrupted, never retried, and summarize as failed', async () => {
      expect(shared.backlog.length, 'the queue check must leave a backlog').toBeGreaterThan(1);
      const runs: RunRecord[] = [];
      for (const id of shared.backlog) runs.push(await port.run(id));
      expect(runs.filter((run) => ACTIVE_RUN_STATUSES.includes(run.status))).toEqual([]);
      const interrupted = runs.filter((run) => run.status === 'interrupted');
      expect(interrupted.length).toBeGreaterThan(0);
      for (const run of interrupted) {
        expect(run.error).toBe(MESSAGES.interrupted);
        expect(run).not.toHaveProperty('output');
        expect(summarizeRun(run)).toMatchObject({ kind: 'failed', heading: 'Run interrupted', error: MESSAGES.interrupted });
      }
      console.info(`[compat] backlog of ${runs.length}: ${interrupted.length} interrupted, ${runs.length - interrupted.length} finished before the restart`);
    });
  });

  describe('after a second Fieldnotes restart', () => {
    beforeAll(() => fieldnotes.restart());

    it('submitRun: a stale token is forbidden and never resent, until a workspace read refreshes it', async () => {
      const input = await port.example('x-studio');
      const runsBefore = (await rawWorkspace()).runs.length;
      const mark = exchanges.length;
      expect(await rejection(port.submitRun('x-studio', input, true))).toEqual({ kind: 'forbidden' });
      expect(wire(mark)).toEqual(['POST /api/runs 403']);
      expect((await port.snapshot()).runs.length, 'the refused submission must not create a run').toBe(runsBefore);
      const run = await port.submitRun('x-studio', input, true);
      expect(run.id).toMatch(hex32);
      expect(wire(mark)).toEqual(['POST /api/runs 403', 'GET /api/workspace 200', 'POST /api/runs 200']);
    });
  });

  it('host: a localhost Host header against a 127.0.0.1 binding is a 403 Unrecognized host', async () => {
    const log: Exchange[] = [];
    const viaName = createServices(configFor(new URL(`http://localhost:${fieldnotes.port}`)), recording(log));
    expect(answered(await viaName.social('workspace', {}))).toMatchObject({ status: 403, body: { error: 'Unrecognized host' } });
    expect(await rejection(createLiveSocialPort({ call: viaName.social }).snapshot())).toEqual({ kind: 'forbidden' });
    expect(log.map((exchange) => exchange.status)).toEqual([403, 403]);
  });

  it('endpoint: HQ rejects a non-loopback HTTP address and accepts the loopback one', async () => {
    expect(endpoint('http://100.64.0.1:8000')).toBeNull();
    expect(endpoint('http://fieldnotes.example:8000')).toBeNull();
    expect(endpoint(fieldnotes.url.href)?.origin).toBe(fieldnotes.url.origin);
    const directory = await mkdtemp(join(tmpdir(), 'hq-fieldnotes-config-'));
    try {
      const config = await openServiceConfig(directory);
      expect(await config.set({ domain: 'social', baseUrl: 'http://100.64.0.1:8000' })).toEqual({ configured: false, policy: 'rejected', transport: null });
      expect(config.get('social')).toBeNull();
      expect(await config.set({ domain: 'social', baseUrl: fieldnotes.url.href })).toEqual({ configured: true, policy: 'ok', transport: 'loopback-http' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('response cap: a large library makes the snapshot unavailable (the 2,000,000-byte cap)', async () => {
    const body = 'x'.repeat(50_000);
    for (let index = 0; index < 45; index += 1) await port.saveDraft(draft({ title: `Large draft ${index}`, body }));
    const { bytes } = await rawWorkspace();
    expect(bytes, 'the workspace should exceed the bridge cap for this check to mean anything').toBeGreaterThan(2_000_000);
    expect(await rejection(port.snapshot())).toEqual({ kind: 'unavailable' });
    console.info(`[compat] workspace of 45 drafts at 50,000 characters is ${bytes} bytes`);
  }, 60_000);
});
