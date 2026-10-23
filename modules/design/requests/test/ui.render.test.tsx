// @vitest-environment happy-dom
// Rendered markup checks through React's real server renderer. They prove
// markup/state wiring only, not browser layout, interaction or Electron runtime.
import { renderToStaticMarkup } from 'react-dom/server';
import { getByRole } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type { CompareSlotProps } from '../src/contract.ts';
import { linkOf } from '../src/draft.ts';
import { CompareSlotFake, RequestsView } from '../ui/RequestsView.tsx';
import { candidate, env, imageBytes, readyDraft } from './fixtures.ts';

let counter = 0;
const newId = (kind: string) => `ui-${kind}-${++counter}`;

function markup(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function ProbeCompare({ baselineVersionId, candidateVersionId }: CompareSlotProps) {
  return <div data-probe-baseline={baselineVersionId} data-probe-candidate={candidateVersionId} />;
}

describe('RequestsView rendered markup', () => {
  test('a new draft shows its privacy label, progress and freeze blockers', async () => {
    const e = env();
    const created = await e.store.createRequest();
    const session = await e.open(created.requestId);
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} newId={newId} />);
    expect(html).toContain('Private draft');
    expect(html).toContain('data-privacy="local-unsent"');
    expect(html).toContain('Not sent · stays on this device');
    expect(html).toMatch(/<li aria-current="step">Draft<\/li>/u);
    const root = markup(html);
    const freeze = getByRole(root, 'button', { name: 'Freeze request' }) as HTMLButtonElement;
    expect(freeze.type).toBe('button');
    expect(freeze.disabled).toBe(true);
    const description = freeze.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    expect([...root.querySelectorAll('[id]')].find((element) => element.id === description)?.textContent).toContain('Add at least one source version.');
    expect(html).toContain('Add at least one source version.');
    expect(html).not.toContain('Frozen packets');
    expect(html).not.toContain('Send packet');
  });

  test('unselected attachments are visibly excluded; selected ones are checked', async () => {
    const e = env();
    const { session } = await readyDraft(e);
    await session.addAttachment(imageBytes(1), { attachmentId: 'att-a', mediaType: 'image/png', label: 'Hero crop' });
    await session.addAttachment(imageBytes(2), { attachmentId: 'att-b', mediaType: 'image/png', label: 'Footer crop' });
    session.edit({ type: 'select-attachment', attachmentId: 'att-b' as never, selected: true });
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} newId={newId} />);
    expect(html).toMatch(/<input type="checkbox"\/>Hero crop <span class="hqr-muted">64 B<\/span><span class="hqr-badge hqr-badge-quiet">Not included<\/span>/u);
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Footer crop <span class="hqr-muted">64 B<\/span><\/label>/u);
    expect(html).toMatch(/<li aria-current="step">Freeze<\/li>/u);
  });

  test('after freeze, packet history shows the current packet and an explicit send that rendering never calls', async () => {
    const e = env();
    const { session } = await readyDraft(e);
    await session.freeze();
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} dispatch={e.dispatch} newId={newId} />);
    expect(html).toContain('Continuation draft');
    expect(html).toContain('<strong>#1</strong> Tighten home heading<span class="hqr-badge">Current</span>');
    expect(html).toContain('Send packet #1…');
    expect(html).toContain('No changes since packet 1.');
    expect(e.dispatch.calls).toHaveLength(0);
  });

  test('review screen separates claim levels and passes before/after to the compare slot', async () => {
    const e = env();
    const { session } = await readyDraft(e);
    const packet = (await session.freeze())!;
    const returned = candidate(linkOf(packet));
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={ProbeCompare} candidate={returned} newId={newId} />);
    expect(html).toContain('data-probe-baseline="v-a1" data-probe-candidate="v-a2"');
    expect(html).toMatch(/<li aria-current="step">Review<\/li>/u);
    expect(html).toContain('Sending is unavailable here: no qualified destination is connected.');
    expect(html).not.toContain('Send packet');
    for (const level of ['agent-reported', 'observed', 'owner-judged']) expect(html).toContain(`data-level="${level}"`);
    expect(html).toContain('Stated by the producer. Not verified by HQ.');
    expect(html.indexOf('Heading spacing reduced')).toBeLessThan(html.indexOf('data-level="observed"'));
    for (const label of ['Accept', 'Revise', 'Defer']) expect(html).toContain(`>${label}</button>`);
  });

  test('owner judgments and appended decisions render as history', async () => {
    const e = env();
    const { session } = await readyDraft(e);
    const packet = (await session.freeze())!;
    const returned = candidate(linkOf(packet));
    await session.review(returned, 'defer', 'Check mobile', [{ claimId: 'claim-spacing' as never, judgment: 'confirmed' }]);
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} candidate={returned} newId={newId} />);
    expect(html).toContain('You confirmed this · originally agent-reported');
    expect(html).toContain('Decision history');
    expect(html).toContain('<strong>defer</strong>');
    expect(html).toContain('Compare slot placeholder (labelled fake)');
  });

  test('a candidate for an unknown packet is refused', async () => {
    const e = env();
    const { session } = await readyDraft(e);
    const packet = (await session.freeze())!;
    const forged = candidate({ packetId: packet.packetId, authoringDigest: `sha256:${'f'.repeat(64)}` as never });
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} candidate={forged} newId={newId} />);
    expect(html).toContain('does not match a frozen packet');
    expect(html).not.toContain('>Accept</button>');
  });
});
