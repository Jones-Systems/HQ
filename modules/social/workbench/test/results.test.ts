import { parseReference } from '@hq/contracts';
import { describe, expect, it } from 'vitest';
import { FEATURE_HQ_REFERENCES, TOOL_IDS, checkDraft, type RunRecord, type ToolId } from '../../core';
import { draftFromResult, runAsOf, runCitation } from '../citation';
import { WORKBENCH_OUTPUTS } from '../fixtures/examples';
import { channelFindingText, summarizeRun } from '../results';

const RUN_ID = '0123456789abcdef0123456789abcdef';

function finished(tool: ToolId, output: unknown, status: RunRecord['status'] = 'succeeded'): RunRecord {
  return { id: RUN_ID, tool, status, is_example: 1, created_at: '2026-10-19T23:59:58+00:00', finished_at: '2026-10-20T00:00:03+00:00', error: null, output };
}

describe('tool-specific result summaries', () => {
  it.each(TOOL_IDS)('%s: its synthetic example output renders a summary', (tool) => {
    const summary = summarizeRun(finished(tool, WORKBENCH_OUTPUTS[tool]));
    expect(summary?.kind).toBe('result');
    expect(summary?.heading).toBeTruthy();
  });

  it('reads the fields the delivered recipes read', () => {
    const studio = summarizeRun(finished('x-studio', WORKBENCH_OUTPUTS['x-studio']))!;
    expect(studio.draftText).toBe('Free cupping hour this Saturday at Larkspur Tea Co.\n\nBring a mug and one question about steeping. We will taste three times side by side.');

    const channels = summarizeRun(finished('social-publisher', WORKBENCH_OUTPUTS['social-publisher']))!;
    expect(channels.heading).toBe('5 channel profiles checked');
    expect(channels.entries.map((entry) => `${entry.title}:${entry.status?.label}`)).toEqual(['X:Text checks passed', 'LINKEDIN:1 preparation gap', 'INSTAGRAM:2 preparation gaps', 'TIKTOK:1 preparation gap', 'FACEBOOK:Text checks passed']);
    expect(channels.notices[0]).toMatch(/^Offline text preparation only/u);

    const creators = summarizeRun(finished('creator-relationships', WORKBENCH_OUTPUTS['creator-relationships']))!;
    expect(creators.entries[1]).toMatchObject({ title: 'fixture-creator-b', status: { label: 'needs evidence' }, meta: 'Evidence age 41.3 days · Missing: audience location' });

    expect(summarizeRun(finished('x-intelligence', WORKBENCH_OUTPUTS['x-intelligence']))!.facts).toEqual([{ label: 'items', value: '2' }, { label: 'evidence', value: '2' }]);
    expect(summarizeRun(finished('seo-studio', WORKBENCH_OUTPUTS['seo-studio']))!.heading).toBe('Some article packets need attention');
    expect(summarizeRun(finished('reddit-opportunities', WORKBENCH_OUTPUTS['reddit-opportunities']))!.notices[0]).toMatch(/packbench-observed/u);
  });

  it('maps Channel preview rule IDs to the delivered wording', () => {
    expect(channelFindingText('tiktok.format')).toMatch(/needs video/u);
    expect(channelFindingText('linkedin.owner_scope')).toMatch(/ownership/u);
    expect(channelFindingText('x.caption')).toMatch(/length profile/u);
    expect(channelFindingText('x.alt_text_present')).toBe('alt text present: not supplied or not qualified');
  });

  it('shows failures, interruptions, pending and unrecognized output honestly', () => {
    expect(summarizeRun(finished('seo-studio', { ok: false, error: 'KeyError: config' }, 'failed'))).toMatchObject({ kind: 'failed', error: 'KeyError: config' });
    expect(summarizeRun({ tool: 'x-studio', status: 'interrupted', error: 'Service restarted before completion; run again explicitly.' })).toMatchObject({ kind: 'failed', heading: 'Run interrupted' });
    expect(summarizeRun({ tool: 'x-studio', status: 'running', error: null })).toBeUndefined();
    expect(summarizeRun(finished('x-studio', { ok: true, summary: 'no result key' }))?.kind).toBe('unrecognized');
  });

  it('caps long entry lists and counts the rest', () => {
    const evidence = Array.from({ length: 25 }, (_, index) => ({ title: `Item ${index}`, text: 't' }));
    const summary = summarizeRun(finished('x-intelligence', { ok: true, result: { evidence } }))!;
    expect([summary.entries.length, summary.more]).toEqual([20, 5]);
  });
});

describe('Start draft citation', () => {
  const run = finished('x-studio', WORKBENCH_OUTPUTS['x-studio']);

  it('is a valid run reference with the as-of date as sourceRevision', () => {
    const citation = runCitation(run, 'Writing studio', 'fixture-project');
    expect(parseReference(citation)).toEqual(citation);
    expect(citation).toEqual({
      version: 1, domain: 'social', projectId: 'fixture-project', kind: 'run', entityId: RUN_ID,
      title: 'Writing studio run · 2026-10-20 · example', returnDestination: { domain: 'social', destination: 'library' }, sourceRevision: '2026-10-20',
    });
    expect(runAsOf({ created_at: '2026-10-19T10:00:00+00:00', finished_at: null })).toBe('2026-10-19');
  });

  it('carries links only when the service advertises hq-references-v1, and validates either way', () => {
    const summary = summarizeRun(run)!;
    const citation = runCitation(run, 'Writing studio', 'fixture-project');
    const withLinks = draftFromResult(run, 'Writing studio', summary, citation, [FEATURE_HQ_REFERENCES]);
    const without = draftFromResult(run, 'Writing studio', summary, citation, []);
    expect(withLinks.links).toEqual([citation]);
    expect('links' in without).toBe(false);
    expect(withLinks).toMatchObject({ title: 'EXAMPLE — Free cupping hour this Saturday at Larkspur Tea Co.', channel: 'X', planned_date: '', archived: 0, brand_id: 'default' });
    expect(checkDraft(withLinks, { features: [FEATURE_HQ_REFERENCES] }).ok).toBe(true);
    expect(checkDraft(without, { features: [] }).ok).toBe(true);
  });

  it('starts other tools\' drafts from the summary with a stated basis', () => {
    const channels = finished('social-publisher', WORKBENCH_OUTPUTS['social-publisher']);
    const fields = draftFromResult(channels, 'Channel preview', summarizeRun(channels)!, runCitation(channels, 'Channel preview', 'p'), []);
    expect(fields.title).toBe('EXAMPLE — Channel preview findings · 2026-10-20');
    expect(fields.body).toMatch(/^5 channel profiles checked\n\nX: Text checks passed\./u);
    expect(fields.body).toMatch(/Source: Channel preview run 89abcdef, example data as of 2026-10-20\.$/u);
  });
});
