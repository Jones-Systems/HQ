import type { ReferenceEnvelope } from '@hq/contracts';
import { DEFAULT_BRAND_ID, type Brand, type Draft, type RunRecord, type Tool, type ToolId } from '../port';
import { MESSAGES } from '../validate';

/**
 * Fictional Social workspace data. Every brand, draft, run and example here is invented;
 * none is copied from a real workspace or the service's own example files.
 */

/** Project IDs the fictional brands map to under the proposed `hq-brand-project-v1`. */
export const FIXTURE_PROJECT_ID = 'fixture-project';
export const FIXTURE_OTHER_PROJECT_ID = 'fixture-other-project';

export function fixtureId(prefix: 'b' | 'd' | 'e', n: number): string {
  return prefix + n.toString(16).padStart(31, '0');
}

export const FIXTURE_IDS = {
  larkspur: fixtureId('b', 1),
  harbor: fixtureId('b', 2),
  autumnBlend: fixtureId('d', 1),
  steepingThread: fixtureId('d', 2),
  icedRecap: fixtureId('d', 3),
  openDay: fixtureId('d', 4),
  slowerRhythm: fixtureId('d', 5),
  queuedRun: fixtureId('e', 1),
  runningRun: fixtureId('e', 2),
  exampleRun: fixtureId('e', 3),
  failedRun: fixtureId('e', 4),
  interruptedRun: fixtureId('e', 5),
} as const;

/** Tool identities, names and categories follow the delivered catalog; descriptions are fixture text. */
export const FIXTURE_TOOLS: readonly Tool[] = [
  { id: 'tiktok-intelligence', name: 'TikTok signals', category: 'Discover', description: 'Compare post snapshots you supply. No TikTok access or live discovery.', mark: 'TK' },
  { id: 'x-intelligence', name: 'Signal inbox', category: 'Discover', description: 'Sort feed items you supply into topics with traceable evidence. No live collection.', mark: 'XI' },
  { id: 'x-studio', name: 'Writing studio', category: 'Create', description: 'Turn your notes into a local first draft for a post, thread or article. Nothing is posted.', mark: 'XS' },
  { id: 'seo-studio', name: 'SEO workbench', category: 'Create', description: 'Check source-backed article packets for editorial readiness. No live search data.', mark: 'SE' },
  { id: 'search-visibility', name: 'Search visibility', category: 'Measure', description: 'Analyze answer-search observations you supply. No live queries.', mark: 'SV' },
  { id: 'social-publisher', name: 'Channel preview', category: 'Plan', description: 'Check text against channel profiles. It never publishes or schedules.', mark: 'CP' },
  { id: 'reddit-opportunities', name: 'Reddit opportunities', category: 'Discover', description: 'Find relevant conversations in a corpus you supply. No Reddit access.', mark: 'RE' },
  { id: 'creator-relationships', name: 'Creator fit', category: 'Connect', description: 'Rank creators you supply with explicit fit and missing-evidence reasons. No outreach.', mark: 'CR' },
];

/** Example inputs. Structured tools get minimal fictional shapes, not the service's example files. */
export const FIXTURE_EXAMPLES: { readonly [T in ToolId]: Record<string, unknown> } = {
  'x-studio': { notes: 'Larkspur is hosting a free cupping hour on Saturday. Bring a mug and a question about steeping.', format: 'short_post', audience: 'Local tea drinkers', intent: 'Invite people to taste and ask questions' },
  'x-intelligence': { topic: 'Neighborhood tea', terms: ['oolong', 'steeping'], items: [{ id: 'fixture-item-1', title: 'A corner shop tries cold-brew oolong', content_text: 'A fictional shop compared three steeping times. Customer preference is unknown.', url: 'https://example.invalid/cold-brew' }] },
  'social-publisher': { caption: 'A fictional tea shop shares three steeping times. Which would you try first?', format: 'text' },
  'tiktok-intelligence': { niche: { name: 'Fictional tea rituals' }, as_of: '2026-10-01T12:00:00Z', batches: [] },
  'seo-studio': { config: { site: 'example.invalid' }, packets: [], as_of: '2026-10-01' },
  'search-visibility': { panel: { name: 'Fictional panel' }, entities: [], inventory: [], answers: [] },
  'reddit-opportunities': { bundle: { posts: [] }, as_of: '2026-10-01T12:00:00Z' },
  'creator-relationships': { batch: { creators: [] }, niche_topics: ['tea', 'slow mornings'], brand_topics: ['tea'], as_of: '2026-10-01T12:00:00Z' },
};

export interface FixtureRun {
  record: RunRecord;
  /** Returned by `run(id)` only once the run is terminal, as the service does. */
  output?: unknown;
}

export interface FixtureSeed {
  brands: Brand[];
  content: Draft[];
  runs: FixtureRun[];
}

function citation(runId: string, title: string, draftId: string): ReferenceEnvelope {
  return {
    version: 1, domain: 'social', projectId: FIXTURE_PROJECT_ID, kind: 'run', entityId: runId, title,
    returnDestination: { domain: 'social', destination: `library/${draftId}` }, sourceRevision: '2026-10-18',
  };
}

/**
 * The seed covers every run status, a planned/unplanned/archived spread and one linked draft.
 * `links` and `project_id` are added by the fixture only when their proposed feature is advertised.
 */
export function fictionalSeed(): FixtureSeed {
  const ids = FIXTURE_IDS;
  const draft = (id: string, fields: Omit<Draft, 'id'>): Draft => ({ id, ...fields });
  return {
    brands: [
      { id: DEFAULT_BRAND_ID, name: 'My workspace' },
      { id: ids.larkspur, name: 'Larkspur Tea Co.', project_id: FIXTURE_PROJECT_ID },
      { id: ids.harbor, name: 'Harbor Lane Bakery', project_id: FIXTURE_OTHER_PROJECT_ID },
    ],
    content: [
      draft(ids.autumnBlend, { title: 'Autumn blend tasting notes', body: 'Three cups, three steeping times. Which one tastes like October?', brand_id: ids.larkspur, channel: 'LinkedIn', planned_date: '2026-10-24', archived: 0, version: 3, updated_at: '2026-10-19T16:05:00+00:00' }),
      draft(ids.steepingThread, { title: 'Steeping times thread', body: '1/ Most bitterness is a timing problem, not a leaf problem.', brand_id: ids.larkspur, channel: 'X', planned_date: '', archived: 0, version: 1, updated_at: '2026-10-18T10:30:00+00:00', links: [citation(ids.exampleRun, 'Signal inbox · Neighborhood tea', ids.steepingThread), { version: 1, domain: 'work', projectId: FIXTURE_PROJECT_ID, kind: 'item', entityId: 'fixture-item-1', title: 'Plan the cupping hour', returnDestination: { domain: 'social', destination: `library/${ids.steepingThread}` } }] }),
      draft(ids.icedRecap, { title: 'Summer iced tea recap', body: 'What we learned pouring cold brew all summer.', brand_id: ids.larkspur, channel: 'Instagram', planned_date: '2026-08-30', archived: 1, version: 2, updated_at: '2026-09-02T09:00:00+00:00' }),
      draft(ids.openDay, { title: 'Sourdough starter open day', body: 'Bring a jar; leave with a starter and a feeding schedule.', brand_id: ids.harbor, channel: 'General', planned_date: '2026-11-02', archived: 0, version: 1, updated_at: '2026-10-17T14:45:00+00:00' }),
      draft(ids.slowerRhythm, { title: 'Notes on a slower posting rhythm', body: '', brand_id: DEFAULT_BRAND_ID, channel: 'Article', planned_date: '', archived: 0, version: 1, updated_at: '2026-10-15T08:00:00+00:00' }),
    ],
    runs: [
      { record: { id: ids.queuedRun, tool: 'x-studio', status: 'queued', is_example: 0, created_at: '2026-10-19T17:02:00+00:00', finished_at: null, error: null } },
      { record: { id: ids.runningRun, tool: 'social-publisher', status: 'running', is_example: 0, created_at: '2026-10-19T17:01:00+00:00', finished_at: null, error: null } },
      { record: { id: ids.exampleRun, tool: 'x-intelligence', status: 'succeeded', is_example: 1, created_at: '2026-10-18T10:00:00+00:00', finished_at: '2026-10-18T10:00:04+00:00', error: null }, output: { ok: true, topic: 'Neighborhood tea', clusters: [{ label: 'Cold brew', items: ['fixture-item-1'] }] } },
      { record: { id: ids.failedRun, tool: 'seo-studio', status: 'failed', is_example: 0, created_at: '2026-10-17T12:00:00+00:00', finished_at: '2026-10-17T12:00:02+00:00', error: 'Packet 1 has no sources. Add at least one source and run again.' }, output: { ok: false, error: 'Packet 1 has no sources. Add at least one source and run again.' } },
      { record: { id: ids.interruptedRun, tool: 'reddit-opportunities', status: 'interrupted', is_example: 0, created_at: '2026-10-16T09:00:00+00:00', finished_at: '2026-10-16T09:05:00+00:00', error: MESSAGES.interrupted } },
    ],
  };
}
