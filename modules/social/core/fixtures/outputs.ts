import type { ToolId } from '../port';

/**
 * Fictional run outputs in the worker's `{ ok, result }` envelope, with the result fields the delivered recipes
 * read. The seeded succeeded runs and the example-run simulation both use them, so every result the example
 * workspace shows renders exactly as a live one would. Every value is invented.
 */
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
