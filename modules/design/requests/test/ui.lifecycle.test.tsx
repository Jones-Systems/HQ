// @vitest-environment happy-dom
// Rendered markup checks through React's server renderer. They prove markup/state wiring only,
// not browser layout, interaction or the Electron runtime.
import { renderToStaticMarkup } from 'react-dom/server';
import { getByRole } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type { CompareSlotProps, NavigationIntent } from '../src/contract.ts';
import { CompareSlotFake, RequestsView } from '../ui/RequestsView.tsx';
import { RunsView } from '../ui/RunsView.tsx';
import { connectorReturn, env, frozenWithDestination, readyDraft, versionless } from './fixtures.ts';

const NOW = '2026-01-01T01:00:30.000Z';
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

describe('lifecycle markup', () => {
  test('review offers Reject beside Accept, Revise and Defer and says reject starts nothing', async () => {
    const { session, link } = await frozenWithDestination();
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={ProbeCompare} candidate={connectorReturn(link)} now={NOW} newId={newId} />);
    for (const label of ['Accept', 'Revise', 'Defer', 'Reject']) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('Reject records that you declined the result; it starts no draft and no work.');
    expect(html).toContain('data-probe-baseline="v-a1" data-probe-candidate="v-a2"');
    expect(html).toContain('<dt>Host</dt><dd>fixture-host-a</dd>');
  });

  test('a return without a comparable version shows artifacts and provenance and never mounts the compare slot', async () => {
    const { session, link } = await frozenWithDestination();
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={ProbeCompare} candidate={versionless(link)} now={NOW} newId={newId} />);
    expect(html).toContain('data-versionless="true"');
    expect(html).toContain('No comparable version was returned');
    expect(html).toContain('aria-label="Returned artifacts"');
    expect(html).toContain('<dt>Model</dt><dd>not reported</dd>');
    expect(html).not.toContain('data-probe-baseline');
    expect(html).not.toContain('data-probe-candidate');
    expect(html).not.toContain('Compare slot placeholder');
  });

  test('an owner-reported return is plainly labelled and offers no observed level', async () => {
    const { session, packet } = await frozenWithDestination();
    const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['It looks tighter.'] }))!;
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} candidate={stored} now={NOW} newId={newId} />);
    expect(html).toContain('Reported by you, outside HQ. It is not verified, and none of it counts as observed.');
    expect(html).toContain('<dt>Source</dt><dd>Owner-reported</dd>');
    expect(html).toMatch(/data-level="observed"[\s\S]*?None\./u);
    expect(html).toContain('Owner-reported</span>');
  });

  test('the inbox lists returned work, its origin and decision, and the manual form states its limits', async () => {
    const { session, link, packet } = await frozenWithDestination();
    await session.reportReturn({ packetId: packet.packetId, claims: ['By hand.'] });
    const returned = connectorReturn(link);
    await session.review(returned, 'reject', 'No');
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} now={NOW} newId={newId} />);
    expect(html).toContain('Returned work');
    expect(html).toContain('1 awaiting review');
    expect(html).toContain('Rejected</span>');
    expect(html).toContain('No comparable version');
    expect(html).toContain('Record a manual return');
    expect(html).toContain('never counts as observed or verified');
    expect(html).toContain('Open for review');
  });

  test('send is enabled only with a destination and shows why otherwise; rendering sends nothing', async () => {
    const { e, session } = await frozenWithDestination();
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} dispatch={e.connector.dispatch} now={NOW} newId={newId} />);
    const send = getByRole(markup(html), 'button', { name: 'Send packet #1…' }) as HTMLButtonElement;
    expect(send.type).toBe('button');
    expect(send.disabled).toBe(false);
    expect(html).not.toContain('Why sending is unavailable');
    expect(e.connector.sends).toHaveLength(0);
    const noDestination = env();
    const draft = await readyDraft(noDestination);
    await draft.session.freeze();
    const blocked = markup(renderToStaticMarkup(<RequestsView session={draft.session} CompareSlot={CompareSlotFake} dispatch={noDestination.connector.dispatch} now={NOW} newId={newId} />));
    expect((getByRole(blocked, 'button', { name: 'Send packet #1…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByRole(blocked, 'list', { name: 'Why sending is unavailable' }).textContent).toMatch(/destination/i);
    expect(noDestination.connector.sends).toHaveLength(0);
  });

  test('after an unknown handoff the send button is disabled and says not to resend', async () => {
    const { e, session, packet } = await frozenWithDestination();
    e.connector.failTransport = 'link dropped';
    await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} dispatch={e.connector.dispatch} now={NOW} newId={newId} />);
    const send = getByRole(markup(html), 'button', { name: 'Send packet #1…' }) as HTMLButtonElement;
    expect(send.type).toBe('button');
    expect(send.disabled).toBe(true);
    expect(html).toContain('Delivery is unknown. Reconcile with the connector; do not resend.');
    expect(html).toContain('data-handoff="unknown"');
    expect(e.connector.sends).toHaveLength(1);
  });

  test('Runs shows state, freshness, pinned and reported host/model, and the variance without a fallback', async () => {
    const { e, session, packet, link } = await frozenWithDestination();
    await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
    e.connector.set(link, 'running', { actual: { host: 'fixture-host-b' } }, '2026-01-01T00:55:00.000Z');
    await session.refreshHandoff(e.connector.status);
    const html = renderToStaticMarkup(<RunsView session={session} statusPort={e.connector.status} now={NOW} />);
    expect(html).toContain('data-handoff="running"');
    expect(html).toContain('>Stale</span>');
    expect(html).toContain('<dt>Pinned host</dt><dd>fixture-host-a</dd>');
    expect(html).toContain('<dt>Reported host</dt><dd>fixture-host-b <span class="hqr-muted">(differs from the pin)</span></dd>');
    expect(html).toContain('<dt>Reported model</dt><dd>not reported <span class="hqr-muted">(not reported by the receiver)</span></dd>');
    expect(html).toContain('Nothing was substituted by HQ.');
    expect(html).toContain('Refresh status');
    expect(e.connector.sends).toHaveLength(1);
    expect(e.connector.statusReads.length).toBeGreaterThan(0);
  });

  test('Runs without a status port says readback is not connected and still shows stored status', async () => {
    const { e, session, packet, link } = await frozenWithDestination();
    await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
    e.connector.set(link, 'queued');
    await session.refreshHandoff(e.connector.status);
    const html = renderToStaticMarkup(<RunsView session={session} now={NOW} />);
    expect(html).toContain('Status readback is not connected. Showing the last stored status.');
    expect(html).toContain('data-handoff="queued"');
    expect(html).not.toContain('Refresh status');
  });

  test('navigation buttons render without emitting any intent', async () => {
    const { e, session } = await frozenWithDestination();
    const received: NavigationIntent[] = [];
    const html = renderToStaticMarkup(<RequestsView session={session} CompareSlot={CompareSlotFake} navigation={{ navigate: (intent) => { received.push(intent); } }} now={NOW} newId={newId} />);
    expect(html).toContain('Open packet');
    expect(html).toContain('Back to request');
    expect(received).toEqual([]);
    expect(e.connector.sends).toHaveLength(0);
  });
});
