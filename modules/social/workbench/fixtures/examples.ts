import {
  createFixtureWorkspace,
  type FixtureOptions, type FixtureWorkspace, type RunRecord, type SocialWorkspacePort, type ToolId,
} from '../../core';
import { WORKBENCH_OUTPUTS } from '../../core/fixtures/outputs';

/**
 * Fictional workbench examples and run outputs. Every value is invented. Top-level keys follow each tool's
 * native input contract; nested documents (niche, manifests, packets, panels, bundles, creator batches) are
 * illustrative placeholders, not the native tools' schemas, because the fixture never runs a native tool.
 * Outputs (`WORKBENCH_OUTPUTS`) use the worker's `{ ok, result }` envelope with the result fields the delivered
 * recipes read.
 */

export { WORKBENCH_OUTPUTS };

export const WORKBENCH_EXAMPLES: { readonly [T in ToolId]: Record<string, unknown> } = {
  'x-studio': {
    notes: 'Larkspur Tea Co. is hosting a free cupping hour on Saturday. Bring a mug and one question about steeping.',
    format: 'short_post', audience: 'Local tea drinkers', intent: 'Invite people to taste and ask questions',
  },
  'social-publisher': { caption: 'A fictional tea shop compares three steeping times. Which would you try first?', format: 'text' },
  'x-intelligence': {
    topic: 'Neighborhood tea', terms: ['oolong', 'steeping'],
    items: [
      { id: 'fixture-item-1', title: 'A corner shop tries cold-brew oolong', content_text: 'A fictional shop compared three steeping times. Customer preference is unknown.', url: 'https://example.invalid/cold-brew' },
      { id: 'fixture-item-2', title: 'Steeping questions at a market stall', content_text: 'Visitors asked how long to steep green tea. No survey was run.' },
    ],
  },
  'tiktok-intelligence': {
    niche: { name: 'Fictional tea rituals', terms: ['oolong', 'gongfu'] },
    as_of: '2026-10-01T12:00:00Z',
    batches: [
      { manifest: { batch_id: 'fixture-batch-1', observed_at: '2026-09-30T12:00:00Z', source: 'supplied snapshot' }, records: [{ post_id: 'fixture-post-1', views: 1200 }, { post_id: 'fixture-post-2', views: 860 }] },
      { manifest: { batch_id: 'fixture-batch-2', observed_at: '2026-10-01T12:00:00Z', source: 'supplied snapshot' }, records: [{ post_id: 'fixture-post-1', views: 1500 }] },
    ],
  },
  'seo-studio': {
    config: { site: 'example.invalid', language: 'en' },
    packets: [{ slug: 'steeping-guide', title: 'A fictional steeping guide', sources: ['https://example.invalid/steeping'] }],
    as_of: '2026-10-01',
  },
  'search-visibility': {
    panel: { name: 'Fictional tea questions', queries: ['how long to steep oolong'] },
    entities: [{ name: 'Larkspur Tea Co.', kind: 'brand' }],
    inventory: [{ url: 'https://example.invalid/steeping', title: 'Steeping guide' }],
    answers: [{ query: 'how long to steep oolong', engine: 'fixture-engine', cited: ['https://example.invalid/steeping'] }],
  },
  'reddit-opportunities': {
    bundle: { corpus: 'fixture-corpus', posts: [{ id: 'fixture-post-1', title: 'Which oolong for a beginner?' }] },
    as_of: '2026-10-01T12:00:00Z',
  },
  'creator-relationships': {
    batch: { account_id: 'fixture-account', creators: [{ handle: 'fixture-creator-a', topics: ['tea'] }, { handle: 'fixture-creator-b', topics: ['cycling'] }] },
    niche_topics: ['tea', 'slow mornings'], brand_topics: ['tea'], as_of: '2026-10-01T12:00:00Z',
  },
};

/** How long each simulated worker step takes: queued → running, then running → succeeded. */
export const EXAMPLE_RUN_STEP_MS = 1100;

export interface ExampleRunSimulation {
  /** Milliseconds per step. Default `EXAMPLE_RUN_STEP_MS`, about a second, so each state is visible. */
  readonly stepMs?: number;
}

export interface WorkbenchFixtureOptions extends FixtureOptions {
  /**
   * Opt in (default off): a run submitted as an example walks queued → running → succeeded on real timers and
   * finishes with the tool's fictional output. Runs on the user's own input, and the seeded runs, are left as
   * they are, and a run another control has already moved on (restart, `advanceRuns`) is never stepped again.
   * Nothing auto-advances unless this is set, so tests that drive runs through `controls` stay deterministic.
   */
  readonly simulateExampleRuns?: boolean | ExampleRunSimulation;
}

export interface WorkbenchFixture extends FixtureWorkspace {
  /**
   * Runs the fixture worker until `runId` (or every queued run) is terminal, giving each run its tool's
   * fictional output. It stands in for the service's worker; it is never reachable from the UI.
   */
  settle(runId?: string, outcome?: (tool: ToolId) => { ok: boolean; error?: string; output?: Record<string, unknown> }): RunRecord | null;
  /** Stops the example-run simulation and clears its timers. Safe to call again; runs stay as they were. */
  dispose(): void;
}

const disposers = new WeakMap<SocialWorkspacePort, () => void>();

/** Disposes the fixture that owns `port`, if it is one. Call it when a module-level port is replaced. */
export function disposeWorkbenchFixture(port: SocialWorkspacePort | null | undefined): void {
  if (port) disposers.get(port)?.();
}

/** The core fixture with workbench examples: `example()` is still a recorded read with the fixture's faults. */
export function createWorkbenchFixture(options: WorkbenchFixtureOptions = {}): WorkbenchFixture {
  const { simulateExampleRuns, ...fixtureOptions } = options;
  const stepMs = typeof simulateExampleRuns === 'object' ? simulateExampleRuns.stepMs ?? EXAMPLE_RUN_STEP_MS : EXAMPLE_RUN_STEP_MS;
  const fixture = createFixtureWorkspace(fixtureOptions);
  const base = fixture.port;

  // The example-run worker: real timers, stepping one run at a time through the fixture's own `advanceRuns`.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const later = (action: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) action();
    }, ms);
    timers.add(timer);
  };
  const simulate = (runId: string, tool: ToolId) => later(() => {
    // Start the run; null means something else already moved it on, so the simulation stands down.
    if (!fixture.controls.advanceRuns(undefined, runId)) return;
    later(() => { fixture.controls.advanceRuns({ ok: true, output: structuredClone(WORKBENCH_OUTPUTS[tool]) }, runId); }, stepMs);
  }, stepMs);

  const port: SocialWorkspacePort = {
    snapshot: () => base.snapshot(),
    saveDraft: (draft) => base.saveDraft(draft),
    addBrand: (name) => base.addBrand(name),
    run: (id) => base.run(id),
    async submitRun(tool, input, isExample) {
      if (!simulateExampleRuns || disposed) return base.submitRun(tool, input, isExample);
      const known = new Set(fixture.controls.inspect().runs.map((run) => run.id));
      try {
        return await base.submitRun(tool, input, isExample);
      } finally {
        // Also covers a lost response that still created the run: the service worker would run it either way.
        for (const run of fixture.controls.inspect().runs) {
          if (!known.has(run.id) && run.is_example === 1 && run.status === 'queued') simulate(run.id, run.tool);
        }
      }
    },
    async example(tool) {
      await base.example(tool);
      return structuredClone(WORKBENCH_EXAMPLES[tool]);
    },
  };
  const dispose = () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  disposers.set(port, dispose);
  const defaultOutcome = (tool: ToolId) => ({ ok: true, output: WORKBENCH_OUTPUTS[tool] });
  return {
    port,
    controls: fixture.controls,
    dispose,
    settle(runId, outcome = defaultOutcome) {
      for (let step = 0; step < 100; step += 1) {
        const runs = fixture.controls.inspect().runs;
        const target = runId ? runs.find((run) => run.id === runId) : undefined;
        if (target && target.status !== 'queued' && target.status !== 'running') return target;
        const running = runs.find((run) => run.status === 'running');
        const next = running ? fixture.controls.advanceRuns(outcome(running.tool)) : fixture.controls.advanceRuns();
        if (!next) return target ?? null;
      }
      throw new Error('The fixture worker did not settle');
    },
  };
}
