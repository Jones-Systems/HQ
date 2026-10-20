import { beforeEach, describe, expect, it } from 'vitest';
import type { ReferenceEnvelope } from '@hq/contracts';
import {
  CALL_CLASSES, CHANNELS, DEFAULT_BRAND_ID, FEATURE_HQ_REFERENCES, TOOL_CATEGORIES, TOOL_IDS,
  portErrorOf, type DraftFields, type PortError, type RunRecord, type SaveDraft, type SocialWorkspacePort, type ToolId,
} from '../port';
import { recordCalls } from '../recorder';
import { possibleRunMatches, submitRunOnce } from '../runs';
import { MESSAGES, textMessage } from '../validate';

/**
 * Shared SocialWorkspacePort conformance (spec.hq-social-work#iface.social-port.001).
 * Fixture and live adapters both pass it; a harness supplies service-side effects the port
 * itself cannot cause. Cases create their own records instead of relying on seed data.
 */
export interface SocialPortHarness {
  readonly port: SocialWorkspacePort;
  /** What the service under test advertises. */
  readonly features: readonly string[];
  /** Another client saves the draft, so the caller's version becomes stale. */
  editElsewhere(draftId: string): Promise<void> | void;
  /** The service accepts the next submission but its response never arrives. */
  loseNextSubmitResponse(): void;
  /** One service worker step (start the oldest queued run, or finish the running one). */
  advanceRuns(outcome?: { readonly ok: boolean; readonly error?: string }): Promise<unknown> | unknown;
  /** The service restarts. */
  restart(): Promise<void> | void;
}

const TERMINAL = new Set(['succeeded', 'failed', 'interrupted']);

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

function fields(overrides: Partial<DraftFields> = {}): DraftFields {
  return { title: 'Conformance draft', body: 'Body text', brand_id: DEFAULT_BRAND_ID, channel: 'General', planned_date: '', archived: 0, ...overrides };
}

function envelope(entityId: string): ReferenceEnvelope {
  return {
    version: 1, domain: 'work', projectId: 'conformance-project', kind: 'item', entityId, title: `Card ${entityId}`,
    returnDestination: { domain: 'social', destination: 'library' },
  };
}

export function describeSocialPortConformance(label: string, createHarness: () => SocialPortHarness | Promise<SocialPortHarness>): void {
  describe(`SocialWorkspacePort conformance: ${label}`, () => {
    let harness: SocialPortHarness;
    let port: SocialWorkspacePort;
    beforeEach(async () => {
      harness = await createHarness();
      port = harness.port;
    });

    async function driveToTerminal(id: string, outcome?: { ok: boolean; error?: string }): Promise<{ run: RunRecord; seen: string[] }> {
      const seen: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const run = await port.run(id);
        if (seen.at(-1) !== run.status) seen.push(run.status);
        if (TERMINAL.has(run.status)) return { run, seen };
        await harness.advanceRuns(outcome);
      }
      throw new Error(`Run ${id} did not finish`);
    }

    describe('snapshot', () => {
      it('lists the built-in brand, the delivered tool set, runs newest first and the advertised features', async () => {
        const snapshot = await port.snapshot();
        expect(snapshot.brands).toContainEqual(expect.objectContaining({ id: DEFAULT_BRAND_ID }));
        expect(snapshot.tools.map((tool) => tool.id).sort()).toEqual([...TOOL_IDS].sort());
        for (const tool of snapshot.tools) expect(TOOL_CATEGORIES).toContain(tool.category);
        for (const draft of snapshot.content) expect(CHANNELS).toContain(draft.channel);
        expect(snapshot.runs.length).toBeLessThanOrEqual(200);
        const created = snapshot.runs.map((run) => Date.parse(run.created_at));
        expect(created).toEqual([...created].sort((a, b) => b - a));
        expect(snapshot.features).toEqual([...harness.features]);
        expect(Number.isFinite(Date.parse(snapshot.observedAt))).toBe(true);
      });
    });

    describe('drafts', () => {
      it('creates a draft at version 1, trimming the title but not the body', async () => {
        const saved = await port.saveDraft(fields({ title: '  Spaced title  ', body: '  kept as typed  ', planned_date: '2024-02-29' }));
        expect(saved).toMatchObject({ title: 'Spaced title', body: '  kept as typed  ', version: 1, planned_date: '2024-02-29', archived: 0 });
        expect(saved.id).toMatch(/^[0-9a-f]{32}$/u);
        expect((await port.snapshot()).content).toContainEqual(expect.objectContaining({ id: saved.id, version: 1 }));
      });

      it('counts title length in characters, as the service does', async () => {
        await expect(port.saveDraft(fields({ title: '🌿'.repeat(200) }))).resolves.toMatchObject({ version: 1 });
        expect(await rejection(port.saveDraft(fields({ title: '🌿'.repeat(201) })))).toEqual({ kind: 'invalid', message: textMessage('Title', 200) });
      });

      const invalidCases: [string, Record<string, unknown>, string][] = [
        ['empty title', { title: '' }, textMessage('Title', 200)],
        ['blank title', { title: ' \t ' }, textMessage('Title', 200)],
        ['long title', { title: 'x'.repeat(201) }, textMessage('Title', 200)],
        ['long body', { body: 'x'.repeat(50_001) }, textMessage('Body', 50_000, true)],
        ['unknown channel', { channel: 'Mastodon' }, MESSAGES.unknownChannel],
        ['impossible date', { planned_date: '2026-02-30' }, MESSAGES.plannedDate],
        ['unpadded date', { planned_date: '2026-2-03' }, MESSAGES.plannedDate],
        ['basic-format date', { planned_date: '20261020' }, MESSAGES.plannedDate],
        ['date with time', { planned_date: '2026-10-20T09:00' }, MESSAGES.plannedDate],
        ['null date', { planned_date: null }, MESSAGES.plannedDateText],
        ['archive state', { archived: 2 }, MESSAGES.archived],
        ['unknown brand', { brand_id: 'no-such-brand' }, MESSAGES.unknownBrand],
        ['long ID', { id: 'a'.repeat(33), version: 1 }, textMessage('ID', 32)],
        ['missing version', { id: 'a'.repeat(32) }, MESSAGES.version],
        ['title checked before channel', { title: '', channel: 'Mastodon' }, textMessage('Title', 200)],
      ];
      it.each(invalidCases)('rejects %s with the service message and stores nothing', async (_name, overrides, message) => {
        const before = (await port.snapshot()).content.length;
        const error = await rejection(port.saveDraft({ ...fields(), ...overrides } as unknown as SaveDraft));
        expect(error).toEqual({ kind: 'invalid', message });
        expect((await port.snapshot()).content).toHaveLength(before);
      });

      it('updates at the current version and increments it', async () => {
        const created = await port.saveDraft(fields());
        const updated = await port.saveDraft({ ...fields({ title: 'Renamed', channel: 'LinkedIn', archived: 1 }), id: created.id, version: created.version });
        expect(updated).toMatchObject({ id: created.id, title: 'Renamed', channel: 'LinkedIn', archived: 1, version: created.version + 1 });
      });

      it('returns a conflict for a stale version and never overwrites the other copy', async () => {
        const created = await port.saveDraft(fields({ title: 'Original' }));
        await harness.editElsewhere(created.id);
        const elsewhere = (await port.snapshot()).content.find((draft) => draft.id === created.id)!;
        expect(elsewhere.version).toBeGreaterThan(created.version);
        const error = await rejection(port.saveDraft({ ...fields({ title: 'Mine' }), id: created.id, version: created.version }));
        expect(error).toEqual({ kind: 'conflict', message: MESSAGES.conflict });
        expect((await port.snapshot()).content.find((draft) => draft.id === created.id)).toEqual(elsewhere);
      });

      it('treats an update to an unknown draft as a conflict', async () => {
        const error = await rejection(port.saveDraft({ ...fields(), id: 'f'.repeat(32), version: 1 }));
        expect(error).toEqual({ kind: 'conflict', message: MESSAGES.conflict });
      });
    });

    describe('brands', () => {
      it('adds a trimmed brand that drafts can use', async () => {
        const brand = await port.addBrand('  Conformance Brand  ');
        expect(brand.name).toBe('Conformance Brand');
        expect((await port.snapshot()).brands).toContainEqual(expect.objectContaining({ id: brand.id, name: 'Conformance Brand' }));
        await expect(port.saveDraft(fields({ brand_id: brand.id }))).resolves.toMatchObject({ brand_id: brand.id });
      });

      it.each([[''], ['   '], ['x'.repeat(81)]])('rejects the brand name %j', async (name) => {
        expect(await rejection(port.addBrand(name))).toEqual({ kind: 'invalid', message: textMessage('Brand name', 80) });
      });
    });

    describe('links (proposed hq-references-v1)', () => {
      it('saves links only when the service advertises hq-references-v1', async () => {
        const linked = fields({ links: [envelope('card-1')] });
        if (!harness.features.includes(FEATURE_HQ_REFERENCES)) {
          const before = (await port.snapshot()).content.length;
          expect(await rejection(port.saveDraft(linked))).toEqual({ kind: 'invalid', message: MESSAGES.linksUnsupported });
          expect((await port.snapshot()).content).toHaveLength(before);
          const plain = await port.saveDraft(fields({ links: [] }));
          expect(plain).not.toHaveProperty('links');
          return;
        }
        const saved = await port.saveDraft(linked);
        expect(saved.links).toEqual([envelope('card-1')]);
        const { links: _links, ...withoutLinks } = fields({ title: 'Renamed' });
        const renamed = await port.saveDraft({ ...withoutLinks, id: saved.id, version: saved.version });
        expect(renamed.links).toEqual([envelope('card-1')]);
        const tooMany = Array.from({ length: 31 }, (_, index) => envelope(`card-${index}`));
        expect(await rejection(port.saveDraft(fields({ links: tooMany })))).toEqual({ kind: 'invalid', message: MESSAGES.linksInvalid });
        const malformed = [{ ...envelope('card-2'), version: 2 }] as unknown as ReferenceEnvelope[];
        expect(await rejection(port.saveDraft(fields({ links: malformed })))).toEqual({ kind: 'invalid', message: MESSAGES.linksInvalid });
      });
    });

    describe('examples', () => {
      it.each(TOOL_IDS.map((tool) => [tool]))('loads the %s example without starting a run', async (tool) => {
        const before = (await port.snapshot()).runs.length;
        const example = await port.example(tool);
        expect(example).toBeTypeOf('object');
        expect(Array.isArray(example)).toBe(false);
        expect((await port.snapshot()).runs).toHaveLength(before);
      });

      it('rejects an unknown tool', async () => {
        expect(await rejection(port.example('no-such-tool' as ToolId))).toEqual({ kind: 'invalid', message: MESSAGES.unknownTool });
      });
    });

    describe('runs', () => {
      it('queues a submission and reports the example flag', async () => {
        const run = await port.submitRun('x-studio', { notes: 'Conformance notes' }, true);
        expect(run).toMatchObject({ tool: 'x-studio', status: 'queued', is_example: 1, finished_at: null, error: null });
        expect(run).not.toHaveProperty('output');
        expect((await port.snapshot()).runs[0]).toMatchObject({ id: run.id });
      });

      it.each([
        ['an unknown tool', 'no-such-tool', {}, false, MESSAGES.runInput],
        ['a non-object input', 'x-studio', ['notes'], false, MESSAGES.runInput],
        ['a non-boolean example flag', 'x-studio', {}, 'yes', MESSAGES.exampleFlag],
      ])('rejects %s', async (_name, tool, input, isExample, message) => {
        const error = await rejection(port.submitRun(tool as ToolId, input as Record<string, unknown>, isExample as boolean));
        expect(error).toEqual({ kind: 'invalid', message });
      });

      it('moves queued → running → succeeded with output', async () => {
        const { id } = await port.submitRun('social-publisher', { caption: 'Hello', format: 'text' }, false);
        const { run, seen } = await driveToTerminal(id);
        expect(seen).toEqual(['queued', 'running', 'succeeded']);
        expect(run.finished_at).not.toBeNull();
        expect(run.error).toBeNull();
        expect(run).toHaveProperty('output');
      });

      it('moves queued → running → failed with the error', async () => {
        const { id } = await port.submitRun('seo-studio', { config: {}, packets: [] }, false);
        const { run, seen } = await driveToTerminal(id, { ok: false, error: 'Conformance failure' });
        expect(seen).toEqual(['queued', 'running', 'failed']);
        expect(run.error).toBe('Conformance failure');
        expect(run.finished_at).not.toBeNull();
      });

      it('marks queued and running runs interrupted on restart and never resumes them', async () => {
        const { id } = await port.submitRun('x-studio', { notes: 'Interrupted' }, false);
        await harness.restart();
        const run = await port.run(id);
        expect(run).toMatchObject({ status: 'interrupted', error: MESSAGES.interrupted });
        expect(run.finished_at).not.toBeNull();
        await harness.advanceRuns();
        await harness.advanceRuns();
        expect((await port.run(id)).status).toBe('interrupted');
      });

      it('rejects a malformed run ID and reports a missing run as not found', async () => {
        expect(await rejection(port.run('not-a-run'))).toEqual({ kind: 'invalid', message: MESSAGES.runId });
        expect(await rejection(port.run('0'.repeat(32)))).toEqual({ kind: 'not_found' });
      });

      it('refuses submissions once the run queue is full', async () => {
        let error: PortError | null = null;
        for (let attempt = 0; attempt < 12 && !error; attempt += 1) {
          error = await port.submitRun('x-studio', { notes: `Fill ${attempt}` }, false).then(() => null, (reason) => portErrorOf(reason));
        }
        expect(error).toEqual({ kind: 'conflict', message: MESSAGES.queueFull });
        expect((await port.snapshot()).runs.filter((run) => run.status === 'queued')).toHaveLength(8);
      });

      it('reports a lost submission response as unknown, submits once and offers possible matches', async () => {
        const recorded = recordCalls(port);
        const knownRunIds = (await recorded.port.snapshot()).runs.map((run) => run.id);
        harness.loseNextSubmitResponse();
        const outcome = await submitRunOnce(recorded.port, 'x-studio', { notes: 'Lost response' }, false);
        expect(outcome.kind).toBe('unknown');
        expect(recorded.callsOf('execution')).toHaveLength(1);
        expect(recorded.callsOf('execution')[0]!.error).toMatchObject({ kind: 'unknown' });
        if (outcome.kind !== 'unknown') return;
        const { runs } = await recorded.port.snapshot();
        const attempt = { tool: 'x-studio' as const, isExample: false, attemptedAt: outcome.attemptedAt };
        expect(possibleRunMatches(runs, { ...attempt, knownRunIds })).toHaveLength(1);
        expect(possibleRunMatches(runs, attempt)).toHaveLength(1);
        expect(recorded.callsOf('execution')).toHaveLength(1);
      });
    });

    describe('call classification', () => {
      it('tags every call content, read or execution, with execution only for submitRun', async () => {
        const recorded = recordCalls(port);
        const snapshot = await recorded.port.snapshot();
        await recorded.port.saveDraft(fields());
        await recorded.port.addBrand('Classified');
        await recorded.port.example('x-studio');
        await recorded.port.run(snapshot.runs[0]?.id ?? (await port.submitRun('x-studio', {}, false)).id);
        await recorded.port.submitRun('x-studio', { notes: 'Classified' }, false);
        expect(recorded.calls().map((call) => [call.method, call.class])).toEqual([
          ['snapshot', 'content'], ['saveDraft', 'content'], ['addBrand', 'content'],
          ['example', 'read'], ['run', 'read'], ['submitRun', 'execution'],
        ]);
        expect(Object.entries(CALL_CLASSES).filter(([, callClass]) => callClass === 'execution')).toEqual([['submitRun', 'execution']]);
      });
    });
  });
}
