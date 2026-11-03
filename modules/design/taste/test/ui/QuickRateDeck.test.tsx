// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState, type ReactNode } from 'react';
import { ToastStoreProvider, createToastStore, type ToastStore } from '@hq/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessmentId, clientEventId, projectId, subjectId, type AppendResult, type TasteClientPort, type TasteCommand } from '../../src/contract.ts';
import { createFakeTasteFileSystem } from '../../src/fake-file-system.ts';
import { TasteJournal } from '../../src/journal.ts';
import { TasteService } from '../../src/service.ts';
import { QuickRateDeck } from '../../src/ui/QuickRateDeck.tsx';
import { TasteQueueContext, type TasteQueueItem, type TasteQueueValue } from '../../src/ui/queue-context.ts';
import { TastePanel } from '../../src/ui/TastePanel.tsx';
import { webCryptoSha256 } from '../../src/web-digest.ts';

/**
 * Rendered checks in happy-dom: what the deck does for the keys, the outcomes and the empty queue. Real motion,
 * pointer drags and pixels need a browser; the evidence for those is recorded separately.
 */

const PROJECT = projectId('project-a');
const PRICING: TasteQueueItem = { id: 'pricing', kind: 'reference', label: 'Larkspur pricing', detail: 'larkspur.example', from: 'references' };
const BUTTON: TasteQueueItem = { id: 'button', kind: 'component', label: 'Button · Synthetic system', from: 'components' };
const CHECKOUT: TasteQueueItem = { id: 'checkout', kind: 'flow', label: 'Checkout flow', from: 'flows' };
const SUBJECT = { id: subjectId('version-subject'), kind: 'version' as const, label: 'Synthetic landing v2', versionId: 'v2' };

async function service(): Promise<TasteService> {
  let tick = 0;
  const opened = await TasteJournal.open({
    fs: createFakeTasteFileSystem(), path: 'j', lockPath: 'l', sha256: webCryptoSha256,
    clock: { now: () => new Date(Date.UTC(2026, 10, 3) + tick++).toISOString() }, lockToken: 't', pid: 1,
  });
  if (opened.status !== 'opened') throw new Error('open failed');
  return new TasteService(opened.journal, { sha256: webCryptoSha256, sampleThreshold: 5 });
}

interface Harness {
  readonly rated: TasteQueueItem[];
  readonly skipped: TasteQueueItem[];
  readonly toasts: ToastStore;
  readonly view: ReturnType<typeof render>;
}

/** Mirrors the composed view: the items live in the owner's state, and rated or skipped items leave it. */
function mount(client: TasteClientPort, initial: readonly TasteQueueItem[], withQueue = true): Harness {
  const rated: TasteQueueItem[] = [];
  const skipped: TasteQueueItem[] = [];
  const toasts = createToastStore();
  function Owner({ children }: { readonly children: ReactNode }) {
    const [items, setItems] = useState(initial);
    const drop = (item: TasteQueueItem) => setItems((list) => list.filter((entry) => entry.id !== item.id || entry.kind !== item.kind));
    const value: TasteQueueValue = {
      items,
      onRated: (item) => { rated.push(item); drop(item); },
      onSkipped: (item) => { skipped.push(item); drop(item); },
      originLabel: (from) => ({ references: 'References', components: 'Components', flows: 'Flows' }[from] ?? ''),
    };
    return <TasteQueueContext value={value}>{children}</TasteQueueContext>;
  }
  const panel = <TastePanel client={client} subject={SUBJECT} projectId={PROJECT} projectName="Synthetic A" newId={(() => { let n = 0; return () => `id-${(n += 1)}`; })()} />;
  const view = render(<ToastStoreProvider store={toasts}>{withQueue ? <Owner>{panel}</Owner> : panel}</ToastStoreProvider>);
  return { rated, skipped, toasts, view };
}

afterEach(cleanup);

const deck = () => screen.getByRole('group', { name: /^Waiting to rate/u });
const fireKey = (key: string) => fireEvent.keyDown(deck(), { key });

describe('QuickRateDeck without a queue', () => {
  it('renders nothing at all when Taste is mounted on its own', async () => {
    const taste = await service();
    const html = renderToStaticMarkup(<QuickRateDeck client={taste} scope={{ kind: 'general' }} snapshot={await taste.snapshot(null)}
      newId={() => 'id'} disabled={false} onSaved={() => undefined} />);
    expect(html).toBe('');
    mount(taste, [PRICING], false);
    await screen.findByText('Project profile');
    expect(screen.queryByText('Waiting to rate')).toBeNull();
    expect(screen.queryByText(/Rate taste/u)).toBeNull();
  });

  it('shows one compact hint, and no deck, when the queue is empty', async () => {
    const taste = await service();
    mount(taste, []);
    await screen.findByText('Project profile');
    expect(screen.getByText(/Send references, components or flows here with/u).textContent).toContain('Rate taste');
    expect(screen.queryByRole('group', { name: /^Waiting to rate/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});

describe('QuickRateDeck cards', () => {
  it('shows the front card with its kind and origin, the next one behind it, and the shortcuts', async () => {
    const taste = await service();
    mount(taste, [PRICING, BUTTON, CHECKOUT]);
    await screen.findByText('Project profile');
    expect(screen.getByRole('heading', { name: 'Waiting to rate' })).toBeTruthy();
    expect(screen.getByText('3 waiting')).toBeTruthy();
    const front = deck().querySelector('[data-position="front"]') as HTMLElement;
    const peek = deck().querySelector('[data-position="peek"]') as HTMLElement;
    expect(within(front).getByText('Larkspur pricing')).toBeTruthy();
    expect(within(front).getByText('Reference')).toBeTruthy();
    expect(within(front).getByText('From References')).toBeTruthy();
    expect(peek.getAttribute('aria-hidden')).toBe('true');
    expect(peek.textContent).toContain('Button · Synthetic system');
    expect(deck().querySelectorAll('.taste-deck-card').length).toBe(2);
    const legend = screen.getByRole('list', { name: 'Keyboard shortcuts' }).textContent ?? '';
    for (const text of ['Not for me · 2', 'Like · 4', 'Love · 5', 'Skip', 'Exact']) expect(legend).toContain(text);
    for (const name of ['Not for me, rating 2', 'Like, rating 4', 'Love, rating 5', 'Skip']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('shows a data image in a preserved-content well and leaves it untouched, and a glyph when there is none', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const taste = await service();
    mount(taste, [{ ...PRICING, imageUrl: png }, { ...BUTTON, imageUrl: 'https://elsewhere.example/a.png' }]);
    await screen.findByText('Project profile');
    const well = deck().querySelector('[data-hq-content="captured"]') as HTMLElement;
    const image = well.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(png);
    expect(image.getAttribute('style')).toBeNull();
    expect(well.getAttribute('style') ?? '').not.toMatch(/opacity|filter/u);
    // The second card's image is on another origin, so it is never requested.
    expect(deck().querySelectorAll('img').length).toBe(1);
    expect(deck().querySelector('[data-position="peek"] .taste-deck-glyph')).toBeTruthy();
  });
});

describe('QuickRateDeck keyboard', () => {
  it('rates the front card from the arrow keys, confirms it, and moves to the next card', async () => {
    const taste = await service();
    const submit = vi.spyOn(taste, 'submit');
    const { rated, toasts } = mount(taste, [PRICING, BUTTON]);
    await screen.findByText('Project profile');
    fireKey('ArrowRight');
    await waitFor(() => expect(rated).toEqual([PRICING]));
    expect(submit).toHaveBeenCalledTimes(1);
    const command = submit.mock.calls[0]![0] as TasteCommand;
    expect(command.event).toMatchObject({
      type: 'assessment.recorded', judgment: 'liking', target: { kind: 'overall' }, value: 4, supersedes: null,
      scope: { kind: 'project', projectId: PROJECT }, subject: { id: 'reference:pricing', kind: 'reference', label: 'Larkspur pricing' },
    });
    // The next card is in front, and the owner sees both the inline state and the toast.
    await waitFor(() => expect(deck().querySelector('[data-position="front"]')?.textContent).toContain('Button · Synthetic system'));
    expect(screen.getByText('1 waiting')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Just rated' }).textContent).toContain('Larkspur pricing');
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
    expect(toasts.getSnapshot().map((toast) => [toast.tone, toast.title])).toEqual([['success', 'Saved “Larkspur pricing” as Like · 4']]);
    // The journal read back shows it: the panel's own snapshot now holds the entry.
    await waitFor(() => expect(screen.getByText('1 entry · verified')).toBeTruthy());
  });

  it('records ← as 2, ↑ as 5 and the number keys exactly, in the general scope when chosen', async () => {
    const taste = await service();
    const submit = vi.spyOn(taste, 'submit');
    const { rated } = mount(taste, [PRICING, BUTTON, CHECKOUT]);
    await screen.findByText('Project profile');
    fireKey('ArrowLeft');
    await waitFor(() => expect(rated.length).toBe(1));
    fireKey('3');
    await waitFor(() => expect(rated.length).toBe(2));
    fireEvent.click(screen.getByLabelText('General taste'));
    fireKey('ArrowUp');
    await waitFor(() => expect(rated.length).toBe(3));
    const values = submit.mock.calls.map(([command]) => (command.event.type === 'assessment.recorded' ? command.event.value : null));
    expect(values).toEqual([2, 3, 5]);
    expect(submit.mock.calls.map(([command]) => (command.event.type === 'assessment.recorded' ? command.event.scope.kind : null)))
      .toEqual(['project', 'project', 'general']);
    expect(screen.getByText(/Everything waiting is rated/u)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Just rated' }).children.length).toBe(3);
  });

  it('skips with ↓ or S without writing anything', async () => {
    const taste = await service();
    const submit = vi.spyOn(taste, 'submit');
    const { rated, skipped, toasts } = mount(taste, [PRICING, BUTTON, CHECKOUT]);
    await screen.findByText('Project profile');
    fireKey('ArrowDown');
    await waitFor(() => expect(skipped).toEqual([PRICING]));
    fireKey('s');
    await waitFor(() => expect(skipped).toEqual([PRICING, BUTTON]));
    expect(rated).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
    expect(toasts.getSnapshot()).toEqual([]);
    expect(screen.getByText('1 waiting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(skipped.length).toBe(3));
  });

  it('keeps keyboard focus in the deck after the last card is rated', async () => {
    const taste = await service();
    const { rated } = mount(taste, [PRICING]);
    await screen.findByText('Project profile');
    deck().focus();
    fireKey('ArrowRight');
    await waitFor(() => expect(rated).toEqual([PRICING]));
    const done = await screen.findByText(/Everything waiting is rated/u);
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  it('rates from the exact 1–5 disclosure', async () => {
    const taste = await service();
    const submit = vi.spyOn(taste, 'submit');
    const { rated } = mount(taste, [PRICING, BUTTON]);
    await screen.findByText('Project profile');
    const toggle = screen.getByRole('button', { name: 'Exact rating' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(await screen.findByRole('button', { name: '1, Strongly dislike' }));
    await waitFor(() => expect(rated).toEqual([PRICING]));
    expect((submit.mock.calls[0]![0].event as { value: number }).value).toBe(1);
  });

  it('ignores keys typed into a text field and chorded keys', async () => {
    const taste = await service();
    const submit = vi.spyOn(taste, 'submit');
    mount(taste, [PRICING]);
    await screen.findByText('Project profile');
    fireEvent.keyDown(deck(), { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(deck(), { key: 'x' });
    const field = document.createElement('textarea');
    deck().appendChild(field);
    fireEvent.keyDown(field, { key: 's' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not rate while the journal is read-only', async () => {
    const taste = await service();
    const snapshot = await taste.snapshot(PROJECT);
    const failed = { ...snapshot, journal: { state: 'fail-closed' as const, reason: 'incomplete-tail' as const, verifiedRecords: 0, line: 1, head: snapshot.general.journalHead } };
    const client: TasteClientPort = { ...taste, label: taste.label, snapshot: async () => failed, submit: vi.fn(taste.submit.bind(taste)), exportProfile: taste.exportProfile.bind(taste) };
    mount(client, [PRICING]);
    await screen.findByText('Ratings are paused while the journal is read-only.');
    fireKey('ArrowRight');
    fireEvent.click(screen.getByRole('button', { name: 'Like, rating 4' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.submit).not.toHaveBeenCalled();
  });
});

describe('QuickRateDeck outcomes', () => {
  function clientWith(taste: TasteService, submit: TasteClientPort['submit']): TasteClientPort {
    return { label: taste.label, snapshot: taste.snapshot.bind(taste), submit: vi.fn(submit), exportProfile: taste.exportProfile.bind(taste) };
  }

  it('keeps the card, says nothing was saved, and raises an error toast when the journal refuses', async () => {
    const taste = await service();
    const client = clientWith(taste, async () => ({ status: 'rejected', reason: 'stale-supersede' }));
    const { rated, toasts } = mount(client, [PRICING, BUTTON]);
    await screen.findByText('Project profile');
    fireKey('ArrowRight');
    await waitFor(() => expect(toasts.getSnapshot()[0]?.tone).toBe('danger'));
    expect(toasts.getSnapshot()[0]?.title).toBe("Couldn't save the rating");
    expect(rated).toEqual([]);
    expect(deck().querySelector('[data-position="front"]')?.textContent).toContain('Larkspur pricing');
    expect(screen.getByText('2 waiting')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Just rated' })).toBeNull();
    expect(screen.queryByText(/^Saved$/u)).toBeNull();
    expect(toasts.getSnapshot().some((toast) => toast.tone === 'success')).toBe(false);
    // The card can be rated again once the refusal is understood.
    expect(screen.getByRole('alert').textContent).toContain('still waiting');
  });

  it('keeps the card and marks it unknown when the save may or may not have landed', async () => {
    const taste = await service();
    const submit = vi.fn<TasteClientPort['submit']>(async () => ({ status: 'fail-closed', reason: 'sync-failed' }));
    const { rated, toasts } = mount(clientWith(taste, submit), [PRICING, BUTTON]);
    await screen.findByText('Project profile');
    fireKey('ArrowRight');
    await waitFor(() => expect(toasts.getSnapshot()[0]?.tone).toBe('unknown'));
    expect(toasts.getSnapshot()[0]?.action?.label).toBe('Check');
    expect(rated).toEqual([]);
    const card = deck().querySelector('[data-position="front"]') as HTMLElement;
    expect(card.getAttribute('data-state')).toBe('unknown');
    expect(card.textContent).toContain('Larkspur pricing');
    expect(screen.getByText('Rating not confirmed')).toBeTruthy();
    expect(screen.queryByText(/^Saved$/u)).toBeNull();
    // Nothing else can be rated, by key or by button, while this one is unconfirmed.
    fireKey('ArrowLeft');
    fireEvent.click(screen.getByRole('button', { name: 'Love, rating 5' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown submit as unknown, checks the journal without writing, and retries the identical entry', async () => {
    const taste = await service();
    let attempts = 0;
    const submit = vi.fn<TasteClientPort['submit']>(async (command): Promise<AppendResult> => {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic timeout');
      return taste.submit(command);
    });
    const { rated, toasts } = mount(clientWith(taste, submit), [PRICING, BUTTON]);
    await screen.findByText('Project profile');
    fireKey('ArrowRight');
    await waitFor(() => expect(toasts.getSnapshot()[0]?.tone).toBe('unknown'));
    // Check reads the journal: the entry is not there, so nothing is claimed and nothing is written.
    fireEvent.click(within(deck()).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(toasts.getSnapshot()[0]?.title).toBe('Not in the journal yet'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(rated).toEqual([]);
    // Retry sends the very same entry; once the journal confirms it, the card leaves.
    fireEvent.click(within(deck()).getByRole('button', { name: 'Retry same entry' }));
    await waitFor(() => expect(rated).toEqual([PRICING]));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
    expect(toasts.getSnapshot().map((toast) => toast.tone)).toEqual(['success']);
  });

  it('counts an entry that did land after an unconfirmed answer as saved when checked', async () => {
    const taste = await service();
    const submit = vi.fn<TasteClientPort['submit']>(async (command) => {
      await taste.submit(command);
      return { status: 'fail-closed', reason: 'sync-failed' };
    });
    const { rated, toasts } = mount(clientWith(taste, submit), [PRICING]);
    await screen.findByText('Project profile');
    fireKey('ArrowUp');
    await waitFor(() => expect(toasts.getSnapshot()[0]?.tone).toBe('unknown'));
    fireEvent.click(within(deck()).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(rated).toEqual([PRICING]));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(toasts.getSnapshot().map((toast) => toast.tone)).toEqual(['success']);
  });

  it('does not write again when the journal already holds that rating for the item', async () => {
    const taste = await service();
    await taste.submit({
      clientEventId: clientEventId('seed'),
      event: {
        type: 'assessment.recorded', assessmentId: assessmentId('seed-a'), scope: { kind: 'project', projectId: PROJECT },
        subject: { id: subjectId('reference:pricing'), kind: 'reference', label: 'Larkspur pricing' },
        judgment: 'liking', target: { kind: 'overall' }, value: 4, supersedes: null,
      },
    });
    const submit = vi.spyOn(taste, 'submit');
    const { rated } = mount(taste, [PRICING]);
    await screen.findByText('Project profile');
    fireKey('ArrowRight');
    await waitFor(() => expect(rated).toEqual([PRICING]));
    expect(submit).not.toHaveBeenCalled();
  });
});
