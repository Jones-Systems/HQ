import {
  createFixtureWorkspace,
  type FixtureOptions, type FixtureWorkspace, type RunRecord, type SocialWorkspacePort, type ToolId,
} from '../../core';

/**
 * Fictional workbench examples and run outputs. Every value is invented. Top-level keys follow each tool's
 * native input contract; nested documents (niche, manifests, packets, panels, bundles, creator batches) are
 * illustrative placeholders, not the native tools' schemas, because the fixture never runs a native tool.
 * Outputs use the worker's `{ ok, result }` envelope with the result fields the delivered recipes read.
 */

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

export const WORKBENCH_OUTPUTS: { readonly [T in ToolId]: Record<string, unknown> } = {
  'x-studio': { ok: true, result: { content: { blocks: [{ text: 'Free cupping hour this Saturday at Larkspur Tea Co.' }, { text: 'Bring a mug and one question about steeping. We will taste three times side by side.' }] } } },
  'social-publisher': {
    ok: true,
    result: {
      qualification: 'Offline text preparation only. Account access and media are unverified; no consent or posting occurs.',
      channels: [
        { platform: 'x', findings: [{ rule_id: 'x.caption', status: 'pass' }] },
        { platform: 'linkedin', findings: [{ rule_id: 'linkedin.owner_scope', status: 'fail' }] },
        { platform: 'instagram', findings: [{ rule_id: 'instagram.format', status: 'fail' }, { rule_id: 'instagram.owner_scope', status: 'fail' }] },
        { platform: 'tiktok', findings: [{ rule_id: 'tiktok.format', status: 'fail' }] },
        { platform: 'facebook', findings: [{ rule_id: 'facebook.caption', status: 'pass' }] },
      ],
    },
  },
  'x-intelligence': {
    ok: true,
    result: {
      counts: { items: 2, evidence: 2 },
      evidence: [
        { title: 'A corner shop tries cold-brew oolong', text: 'Matched "oolong" and "steeping" in supplied item fixture-item-1.' },
        { title: 'Steeping questions at a market stall', text: 'Matched "steeping" in supplied item fixture-item-2.' },
      ],
    },
  },
  'tiktok-intelligence': { ok: true, result: { niche: 'Fictional tea rituals', as_of: '2026-10-01T12:00:00Z', posts: [{ post_id: 'fixture-post-1' }, { post_id: 'fixture-post-2' }], qualifications: ['Supplied snapshots only.'] } },
  'seo-studio': { ok: true, result: { ok: false, packets: [{ slug: 'steeping-guide', findings: ['Needs a second source.'] }] } },
  'search-visibility': { ok: true, result: { queries: 1, citations: [{ url: 'https://example.invalid/steeping', count: 1 }], coverage: 1 } },
  'reddit-opportunities': { ok: true, result: { import: { posts: 1 }, analysis: { opportunities: [{ id: 'fixture-post-1', score: 0.7 }] }, profile: 'example-product (illustrative built-in profile; rankings apply to that profile)' } },
  'creator-relationships': {
    ok: true,
    result: {
      creators: [
        { handle: 'fixture-creator-a', status: 'strong_fit', niche_matches: ['tea'], age_days: 3.5, missing_evidence: {} },
        { handle: 'fixture-creator-b', status: 'needs_evidence', niche_matches: [], age_days: 41.25, missing_evidence: { audience_location: 'not supplied' } },
      ],
    },
  },
};

export interface WorkbenchFixture extends FixtureWorkspace {
  /**
   * Runs the fixture worker until `runId` (or every queued run) is terminal, giving each run its tool's
   * fictional output. It stands in for the service's worker; it is never reachable from the UI.
   */
  settle(runId?: string, outcome?: (tool: ToolId) => { ok: boolean; error?: string; output?: Record<string, unknown> }): RunRecord | null;
}

/** The core fixture with workbench examples: `example()` is still a recorded read with the fixture's faults. */
export function createWorkbenchFixture(options: FixtureOptions = {}): WorkbenchFixture {
  const fixture = createFixtureWorkspace(options);
  const base = fixture.port;
  const port: SocialWorkspacePort = {
    snapshot: () => base.snapshot(),
    saveDraft: (draft) => base.saveDraft(draft),
    addBrand: (name) => base.addBrand(name),
    run: (id) => base.run(id),
    submitRun: (tool, input, isExample) => base.submitRun(tool, input, isExample),
    async example(tool) {
      await base.example(tool);
      return structuredClone(WORKBENCH_EXAMPLES[tool]);
    },
  };
  const defaultOutcome = (tool: ToolId) => ({ ok: true, output: WORKBENCH_OUTPUTS[tool] });
  return {
    port,
    controls: fixture.controls,
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
