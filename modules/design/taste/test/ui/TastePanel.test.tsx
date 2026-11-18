import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assessmentId, clientEventId, exampleId, projectId, subjectId, type TasteClientPort, type TasteSnapshot, type TasteSubject } from '../../src/contract.ts';
import { createFakeTasteFileSystem } from '../../src/fake-file-system.ts';
import { TasteJournal } from '../../src/journal.ts';
import { TasteService } from '../../src/service.ts';
import { TastePanel } from '../../src/ui/TastePanel.tsx';
import { webCryptoSha256 } from '../../src/web-digest.ts';

/**
 * Server-rendered markup checks. They prove what the component renders for a
 * given snapshot, not browser layout or interaction.
 */

const SUBJECT: TasteSubject = { id: subjectId('subject-1'), kind: 'version', label: 'Synthetic landing v2', versionId: 'v2' };
const PROJECT = projectId('project-a');

async function service(): Promise<TasteService> {
  let tick = 0;
  const opened = await TasteJournal.open({
    fs: createFakeTasteFileSystem(), path: 'j', lockPath: 'l', sha256: webCryptoSha256,
    clock: { now: () => new Date(Date.UTC(2026, 9, 20) + tick++).toISOString() }, lockToken: 't', pid: 1,
  });
  if (opened.status !== 'opened') throw new Error('open failed');
  return new TasteService(opened.journal, { sha256: webCryptoSha256, sampleThreshold: 5 });
}

function render(client: TasteClientPort, snapshot: TasteSnapshot, extra: Partial<Parameters<typeof TastePanel>[0]> = {}) {
  return renderToStaticMarkup(<TastePanel client={client} subject={SUBJECT} projectId={PROJECT} projectName="Synthetic A"
    initialSnapshot={snapshot} newId={() => 'id'} {...extra} />);
}

describe('TastePanel rendered markup', () => {
  it('renders separate liking and description controls with the current rating checked', async () => {
    const taste = await service();
    await taste.submit({
      clientEventId: clientEventId('e1'),
      event: { type: 'assessment.recorded', assessmentId: assessmentId('a1'), scope: { kind: 'project', projectId: PROJECT }, subject: SUBJECT, judgment: 'liking', target: { kind: 'overall' }, value: 4, supersedes: null },
    });
    const html = render(taste, await taste.snapshot(PROJECT));
    expect(html).toContain('>Liking</h3>');
    expect(html).toContain('>Description</h3>');
    expect(html).toContain('This records what it is, not whether you like it.');
    const checked = (html.match(/<input type="radio"[^>]*>/gu) ?? []).filter((input) => input.includes('checked=""'));
    expect(checked.filter((input) => input.includes('aria-label="Overall'))).toEqual([expect.stringContaining('aria-label="Overall: 4, Like"')]);
    expect(checked.some((input) => input.includes('-descriptive:'))).toBe(false);
    expect(html).toContain('Include this project’s ratings in general taste');
    expect(html).not.toMatch(/type="checkbox" checked=""[^>]*\/><span>Include this project/u);
  });

  it('shows the sample-limit label for a profile under N ratings', async () => {
    const taste = await service();
    const html = render(taste, await taste.snapshot(PROJECT));
    expect(html).toContain('Limited sample: 0 rated subjects, fewer than 5');
  });

  it('labels imported examples as not the owner’s judgment', async () => {
    const taste = await service();
    await taste.submit({
      clientEventId: clientEventId('ex'),
      event: { type: 'example.imported', exampleId: exampleId('x1'), scope: { kind: 'project', projectId: PROJECT }, subject: SUBJECT, source: { kind: 'reference-library', label: 'Synthetic gallery' }, claimed: [{ judgment: 'liking', target: { kind: 'overall' }, value: 5 }] },
    });
    const html = render(taste, await taste.snapshot(PROJECT));
    expect(html).toContain('Imported · not your judgment');
    expect(html).toContain('1 imported example not counted.');
    expect(html).toContain('No ratings yet.');
  });

  it('disables every control and explains a fail-closed journal', async () => {
    const taste = await service();
    const snapshot = await taste.snapshot(PROJECT);
    const failed: TasteSnapshot = { ...snapshot, journal: { state: 'fail-closed', reason: 'incomplete-tail', verifiedRecords: 7, line: 8, head: snapshot.general.journalHead } };
    const html = render(taste, failed);
    expect(html).toContain('Read-only: storage fault (incomplete-tail) after 7 verified entries. Nothing was removed.');
    const rows = html.match(/<fieldset class="taste-row"[^>]*>/gu) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.includes('disabled'))).toBe(true);
  });

  it('renders nothing when rating controls are switched off', async () => {
    const taste = await service();
    const html = render(taste, await taste.snapshot(PROJECT), { flags: { ratingControls: false, automaticGuidance: false, legacyJournalReuse: false } });
    expect(html).toBe('');
  });
});
