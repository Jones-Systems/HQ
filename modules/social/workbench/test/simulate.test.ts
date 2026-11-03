import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_IDS, createFixtureWorkspace } from '../../core';
import { WORKBENCH_OUTPUTS, WORKBENCH_EXAMPLES, createWorkbenchFixture, disposeWorkbenchFixture, EXAMPLE_RUN_STEP_MS } from '../fixtures/examples';
import { summarizeRun } from '../results';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const lastRun = (fixture: ReturnType<typeof createWorkbenchFixture>) => fixture.controls.inspect().runs.at(-1)!;

describe('example-run simulation', () => {
  it('is off unless opted in: a submitted example run stays queued', async () => {
    const fixture = createWorkbenchFixture();
    await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    await vi.advanceTimersByTimeAsync(EXAMPLE_RUN_STEP_MS * 5);
    expect(lastRun(fixture).status).toBe('queued');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('walks an example run queued → running → succeeded with the tool output, one step at a time', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 1000 } });
    const created = await fixture.port.submitRun('social-publisher', WORKBENCH_EXAMPLES['social-publisher'], true);
    expect(created.status).toBe('queued');
    await vi.advanceTimersByTimeAsync(999);
    expect((await fixture.port.run(created.id)).status).toBe('queued');
    await vi.advanceTimersByTimeAsync(1);
    expect((await fixture.port.run(created.id)).status).toBe('running');
    await vi.advanceTimersByTimeAsync(999);
    expect((await fixture.port.run(created.id)).status).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    const done = await fixture.port.run(created.id);
    expect(done.status).toBe('succeeded');
    expect(done.is_example).toBe(1);
    expect(done.output).toStrictEqual(WORKBENCH_OUTPUTS['social-publisher']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses about a second per step by default', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: true });
    const created = await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    await vi.advanceTimersByTimeAsync(EXAMPLE_RUN_STEP_MS);
    expect((await fixture.port.run(created.id)).status).toBe('running');
    await vi.advanceTimersByTimeAsync(EXAMPLE_RUN_STEP_MS);
    expect((await fixture.port.run(created.id)).status).toBe('succeeded');
    expect(EXAMPLE_RUN_STEP_MS).toBeGreaterThanOrEqual(800);
    expect(EXAMPLE_RUN_STEP_MS).toBeLessThanOrEqual(1500);
  });

  it('leaves a run on the user’s own input queued: nothing is simulated for it', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    const created = await fixture.port.submitRun('x-studio', { notes: 'My own notes' }, false);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await fixture.port.run(created.id)).status).toBe('queued');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the seeded active runs alone while it steps only its own run', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    const seeded = fixture.controls.inspect().runs.filter((run) => run.status === 'queued' || run.status === 'running');
    expect(seeded.length).toBeGreaterThan(0);
    const created = await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    await vi.advanceTimersByTimeAsync(500);
    expect((await fixture.port.run(created.id)).status).toBe('succeeded');
    for (const run of seeded) expect(fixture.controls.inspect().runs.find((item) => item.id === run.id)!.status).toBe(run.status);
  });

  it('never moves a run another control already ended: a restart interrupts it for good', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    const created = await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    fixture.controls.restart();
    await vi.advanceTimersByTimeAsync(1000);
    const after = await fixture.port.run(created.id);
    expect(after.status).toBe('interrupted');
    expect(after.output).toBeUndefined();
  });

  it('also simulates a run whose response was lost, because the service worker would still run it', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    fixture.controls.loseNextSubmitResponse();
    await expect(fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true)).rejects.toMatchObject({ error: { kind: 'unknown' } });
    const created = lastRun(fixture);
    expect(created.status).toBe('queued');
    await vi.advanceTimersByTimeAsync(500);
    expect(lastRun(fixture).status).toBe('succeeded');
  });

  it('dispose clears the timers and stops the simulation; it is safe to call twice', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    const created = await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fixture.dispose();
    fixture.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await fixture.port.run(created.id)).status).toBe('queued');
    // Submitting after dispose creates the run but starts no simulation.
    const later = await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    expect(vi.getTimerCount()).toBe(0);
    expect(later.status).toBe('queued');
  });

  it('disposeWorkbenchFixture disposes the fixture that owns the port and ignores any other port', async () => {
    const fixture = createWorkbenchFixture({ simulateExampleRuns: { stepMs: 100 } });
    await fixture.port.submitRun('x-studio', WORKBENCH_EXAMPLES['x-studio'], true);
    disposeWorkbenchFixture(createFixtureWorkspace().port);
    disposeWorkbenchFixture(null);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    disposeWorkbenchFixture(fixture.port);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('advanceRuns with a run ID', () => {
  it('steps only that run, and returns null when it is not queued or running', () => {
    const fixture = createWorkbenchFixture();
    const queued = fixture.controls.inspect().runs.find((run) => run.status === 'queued')!;
    expect(fixture.controls.advanceRuns(undefined, queued.id)?.status).toBe('running');
    const running = fixture.controls.inspect().runs.filter((run) => run.status === 'running');
    expect(running.map((run) => run.id)).toContain(queued.id);
    expect(fixture.controls.advanceRuns({ ok: true }, FIXTURE_IDS.exampleRun)).toBeNull();
    expect(fixture.controls.advanceRuns(undefined, 'no-such-run')).toBeNull();
  });
});

describe('seeded results', () => {
  it('the seeded succeeded run carries a real result shape that the workbench can summarise', async () => {
    const fixture = createWorkbenchFixture();
    const run = await fixture.port.run(FIXTURE_IDS.exampleRun);
    expect(run.status).toBe('succeeded');
    expect(summarizeRun(run)).toMatchObject({ kind: 'result' });
  });
});
