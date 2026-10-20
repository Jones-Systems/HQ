import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_REFERENCES, RUN_STATUSES, portErrorOf } from '../port';
import { createFixtureWorkspace, serviceTimestamp, type FixtureOptions } from '../fixture';
import { FIXTURE_IDS, FIXTURE_PROJECT_ID } from '../fixtures/workspace';
import { recordCalls } from '../recorder';
import { submitRunOnce } from '../runs';
import { describeSocialPortConformance, type SocialPortHarness } from './port-conformance';

/** A clock after every seeded record that ticks one second per reading. */
function tickingClock(): () => Date {
  let ms = Date.parse('2026-10-20T12:00:00Z');
  return () => new Date((ms += 1000));
}

function harness(options: FixtureOptions): SocialPortHarness {
  const { port, controls } = createFixtureWorkspace({ clock: tickingClock(), ...options });
  return {
    port, features: options.features ?? [FEATURE_HQ_REFERENCES],
    editElsewhere: (id) => void controls.editElsewhere(id, { title: 'Edited in another window' }),
    loseNextSubmitResponse: () => controls.loseNextSubmitResponse(),
    advanceRuns: (outcome) => controls.advanceRuns(outcome),
    restart: () => controls.restart(),
  };
}

describeSocialPortConformance('fixture advertising hq-references-v1', () => harness({}));
describeSocialPortConformance("fixture without features (today's service)", () => harness({ features: [] }));

describe('fixture workspace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is fictional, deterministic and covers every run status', async () => {
    const { port } = createFixtureWorkspace({ clock: tickingClock() });
    const snapshot = await port.snapshot();
    expect(new Set(snapshot.runs.map((run) => run.status))).toEqual(new Set(RUN_STATUSES));
    expect(snapshot.runs.some((run) => run.is_example === 1)).toBe(true);
    expect(snapshot.content.some((draft) => draft.archived === 1)).toBe(true);
    expect(snapshot.content.some((draft) => draft.planned_date === '')).toBe(true);
    expect(snapshot.brands.map((brand) => brand.name)).toEqual(['Harbor Lane Bakery', 'Larkspur Tea Co.', 'My workspace']);
    expect(snapshot).toEqual(await createFixtureWorkspace({ clock: tickingClock() }).port.snapshot());
  });

  it('makes no network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { port, controls } = createFixtureWorkspace({ clock: tickingClock() });
    await port.snapshot();
    const run = await port.submitRun('x-studio', { notes: 'Offline' }, false);
    controls.advanceRuns();
    controls.advanceRuns();
    controls.advanceRuns();
    await port.run(run.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('labels proposed fields: links only with hq-references-v1, project_id only with hq-brand-project-v1', async () => {
    const plain = await createFixtureWorkspace({ features: [] }).port.snapshot();
    expect(plain.content.every((draft) => !('links' in draft))).toBe(true);
    expect(plain.brands.every((brand) => !('project_id' in brand))).toBe(true);

    const proposed = createFixtureWorkspace({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT] });
    const snapshot = await proposed.port.snapshot();
    expect(snapshot.content.find((draft) => draft.id === FIXTURE_IDS.steepingThread)?.links).toHaveLength(2);
    expect(snapshot.brands.find((brand) => brand.id === FIXTURE_IDS.larkspur)?.project_id).toBe(FIXTURE_PROJECT_ID);
    expect(snapshot.brands.find((brand) => brand.id === 'default')?.project_id).toBeNull();
    expect((await proposed.port.addBrand('New brand')).project_id).toBeNull();
  });

  it('returns copies, so callers cannot change stored records', async () => {
    const { port } = createFixtureWorkspace();
    const first = await port.snapshot();
    first.content[0]!.title = 'Mutated by caller';
    first.brands.length = 0;
    const second = await port.snapshot();
    expect(second.content[0]!.title).not.toBe('Mutated by caller');
    expect(second.brands.length).toBeGreaterThan(0);
  });

  it('returns run output only once the run is terminal', async () => {
    const { port, controls } = createFixtureWorkspace({ clock: tickingClock() });
    expect(await port.run(FIXTURE_IDS.exampleRun)).toHaveProperty('output');
    expect(await port.run(FIXTURE_IDS.interruptedRun)).not.toHaveProperty('output');
    expect((await port.snapshot()).runs.every((run) => !('output' in run))).toBe(true);
    controls.advanceRuns({ ok: true, output: { ok: true, draft: 'A fictional first draft.' } });
    expect((await port.run(FIXTURE_IDS.runningRun)).output).toEqual({ ok: true, draft: 'A fictional first draft.' });
  });

  it('rejects every call while unavailable, with no effect', async () => {
    const { port, controls } = createFixtureWorkspace();
    const before = controls.inspect();
    controls.setUnavailable(true);
    for (const call of [port.snapshot(), port.addBrand('Offline'), port.submitRun('x-studio', {}, false)]) {
      expect(portErrorOf(await call.catch((reason: unknown) => reason))).toEqual({ kind: 'unavailable' });
    }
    expect(controls.inspect()).toEqual(before);
    controls.setUnavailable(false);
    await expect(port.snapshot()).resolves.toBeTruthy();
  });

  it('injects one failure per method without an effect', async () => {
    const { port, controls } = createFixtureWorkspace();
    controls.failNext('addBrand', { kind: 'forbidden' });
    expect(portErrorOf(await port.addBrand('Refused').catch((reason: unknown) => reason))).toEqual({ kind: 'forbidden' });
    expect(controls.inspect().brands.some((brand) => brand.name === 'Refused')).toBe(false);
    await expect(port.addBrand('Accepted')).resolves.toMatchObject({ name: 'Accepted' });
  });

  it('can lose a submission before the service accepts it', async () => {
    const { port, controls } = createFixtureWorkspace({ clock: tickingClock() });
    const before = controls.inspect().runs.length;
    controls.loseNextSubmitResponse({ accepted: false });
    const outcome = await submitRunOnce(port, 'x-studio', { notes: 'Never arrived' }, false);
    expect(outcome).toMatchObject({ kind: 'unknown' });
    expect(controls.inspect().runs).toHaveLength(before);
  });

  it('records rejected calls with their port error', async () => {
    const recorded = recordCalls(createFixtureWorkspace().port);
    await recorded.port.run('bad').catch(() => undefined);
    expect(recorded.calls()).toEqual([expect.objectContaining({ method: 'run', class: 'read', outcome: 'error', error: { kind: 'invalid', message: 'Invalid run ID' } })]);
    recorded.clear();
    expect(recorded.calls()).toEqual([]);
  });

  it('stamps records in the service timestamp format', () => {
    expect(serviceTimestamp(new Date('2026-10-20T12:00:00.000Z'))).toBe('2026-10-20T12:00:00+00:00');
    expect(serviceTimestamp(new Date('2026-10-20T12:00:00.042Z'))).toBe('2026-10-20T12:00:00.042000+00:00');
  });
});
