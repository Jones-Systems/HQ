import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStoreProvider, ToastViewport, createToastStore } from '@hq/ui';
import { FIXTURE_IDS, recordCalls, resetSocialSessions, type RecordedPort } from '../../core';
import { createWorkbenchFixture, type WorkbenchFixture } from '../fixtures/examples';
import type { Visibility } from '../polling';
import { dayLabel, localDay } from '../run-history';
import { WorkbenchSection } from '../WorkbenchSection';

const CONTEXT = { id: 'fixture-project', name: 'Fixture project' };
const NOW = () => new Date('2026-10-20T12:00:00Z');

afterEach(() => {
  cleanup();
  resetSocialSessions();
});

function visibilityControl(visible = true) {
  const listeners = new Set<() => void>();
  const visibility: Visibility = { isVisible: () => visible, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  return { visibility, set(value: boolean) { visible = value; act(() => { for (const listener of [...listeners]) listener(); }); } };
}

interface Setup {
  readonly fixture: WorkbenchFixture;
  readonly recorded: RecordedPort;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly destination: () => string;
  readonly go: (destination: string) => void;
  readonly visible: ReturnType<typeof visibilityControl>;
}

function setup({ destination = 'runs', visible = true }: { destination?: string; visible?: boolean } = {}): Setup {
  const fixture = createWorkbenchFixture({ clock: NOW });
  const recorded = recordCalls(fixture.port);
  const visibleControl = visibilityControl(visible);
  const store = createToastStore();
  let current = destination;
  let go: (next: string) => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    current = where;
    go = (next) => act(() => setWhere(next));
    return (
      <ToastStoreProvider store={store}>
        <WorkbenchSection port={recorded.port} context={CONTEXT} destination={where} navigate={(next) => setWhere(next)} clock={NOW} visibility={visibleControl.visibility} pollIntervalMs={10} />
        <ToastViewport hotkey={null} />
      </ToastStoreProvider>
    );
  }
  render(<Shell />);
  return { fixture, recorded, user: userEvent.setup(), destination: () => current, go: (next) => go(next), visible: visibleControl };
}

const executions = (recorded: RecordedPort) => recorded.callsOf('execution');
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.rh-row')];
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-run-row="${id}"]`)!;
const timeline = () => document.querySelector<HTMLElement>('.rh-timeline')!;
const panel = () => screen.queryByRole('complementary', { name: 'Selected receipt' });
const listed = () => screen.findAllByRole('button', { name: /^Open receipt/ });

describe('run history timeline', () => {
  it('groups runs by day with a status icon, status word, example label and inline reasons', async () => {
    const s = setup();
    await listed();
    const snapshot = await s.fixture.port.snapshot();
    const labels = [...new Set(snapshot.runs.map((run) => dayLabel(localDay(new Date(run.created_at)), NOW())))];
    expect([...timeline().querySelectorAll('h2')].map((heading) => heading.firstChild?.textContent)).toEqual(labels);
    expect(rows()).toHaveLength(snapshot.runs.length);

    const list = within(timeline());
    for (const label of ['Queued', 'Running', 'Succeeded', 'Failed', 'Interrupted']) expect(list.getByText(label)).toBeTruthy();
    expect(list.getAllByText('Example data')).toHaveLength(1);
    // A reason is part of the row's status, not a red paragraph.
    const interrupted = row(FIXTURE_IDS.interruptedRun);
    expect(interrupted.querySelector('.hq-indicator')?.textContent).toContain('Service restarted before completion; run again explicitly.');
    expect(row(FIXTURE_IDS.failedRun).querySelector('.hq-indicator')?.textContent).toContain('Packet 1 has no sources.');
    expect(timeline().querySelector('p[role="alert"], .sw-row-error')).toBeNull();
    expect(row(FIXTURE_IDS.failedRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('failed');
    expect(row(FIXTURE_IDS.interruptedRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('interrupted');
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('keeps each time on one short line', async () => {
    setup();
    await listed();
    for (const time of document.querySelectorAll('.rh-time')) expect(time.textContent).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/u);
  });

  it('marks queued and running runs as active, and finished runs as not', async () => {
    setup();
    await listed();
    expect(row(FIXTURE_IDS.queuedRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('queued');
    expect(row(FIXTURE_IDS.runningRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('running');
    expect(row(FIXTURE_IDS.exampleRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('succeeded');
  });

  it('shows runs last seen active as Unknown, with no advice to start them again', async () => {
    const s = setup();
    await listed();
    s.fixture.controls.setUnavailable(true);
    await s.user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(within(timeline()).getAllByText('Unknown')).toHaveLength(2));
    expect(within(timeline()).getAllByText(/Don't start it again until the status is known/u)).toHaveLength(2);
    expect(row(FIXTURE_IDS.queuedRun).querySelector('.rh-glyph')?.getAttribute('data-state')).toBe('unknown');
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('filters by tool and says when a tool has no runs', async () => {
    const s = setup();
    await listed();
    await s.user.selectOptions(screen.getByLabelText('Tool'), 'x-studio');
    expect(rows()).toHaveLength(1);
    expect(row(FIXTURE_IDS.queuedRun)).toBeTruthy();
    await s.user.selectOptions(screen.getByLabelText('Tool'), 'tiktok-intelligence');
    expect(screen.getByText(/^No .* runs$/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open workbenches' })).toBeTruthy();
  });

  it('moves between rows with the arrow keys and opens one with Enter', async () => {
    const s = setup();
    const [first] = await listed();
    first!.focus();
    await s.user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows()[1]);
    await s.user.keyboard('{End}');
    expect(document.activeElement).toBe(rows().at(-1));
    await s.user.keyboard('{Home}{Enter}');
    expect(s.destination()).toBe(`runs/${rows()[0]!.dataset.runRow}`);
  });

  it('slides a new run in at the top of its day with a colour wash', async () => {
    const s = setup();
    await listed();
    const before = rows().map((item) => item.dataset.runRow);
    const created = await s.fixture.port.submitRun('x-studio', { notes: 'A fictional note' }, false);
    await s.user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(rows()).toHaveLength(before.length + 1));
    expect(rows()[0]!.dataset.runRow).toBe(created.id);
    expect(rows()[0]!.classList.contains('hq-flash')).toBe(true);
    expect(rows().slice(1).map((item) => item.dataset.runRow)).toEqual(before);
    expect(timeline().querySelector('h2')?.firstChild?.textContent).toBe('Today');
    expect(rows().slice(1).some((item) => item.classList.contains('hq-flash'))).toBe(false);
  });
});

describe('receipt side panel', () => {
  it('opens beside the list, keeps the list, and marks the open row', async () => {
    const s = setup();
    await listed();
    const count = rows().length;
    await s.user.click(row(FIXTURE_IDS.failedRun));
    expect(s.destination()).toBe(`runs/${FIXTURE_IDS.failedRun}`);
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(within(side).getByRole('article')).toBeTruthy();
    expect(rows()).toHaveLength(count);
    expect(row(FIXTURE_IDS.failedRun).getAttribute('aria-current')).toBe('true');
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('opens straight from the runs/<id> route', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.exampleRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(await within(side).findByRole('article')).toBeTruthy();
    expect(row(FIXTURE_IDS.exampleRun).getAttribute('aria-current')).toBe('true');
  });

  it('returns to runs with Escape and puts focus back on the row', async () => {
    const s = setup();
    await listed();
    await s.user.click(row(FIXTURE_IDS.failedRun));
    await screen.findByRole('complementary', { name: 'Selected receipt' });
    await s.user.keyboard('{Escape}');
    expect(s.destination()).toBe('runs');
    await waitFor(() => expect(document.activeElement).toBe(row(FIXTURE_IDS.failedRun)));
    await waitFor(() => expect(panel()).toBeNull());
  });

  it('closes with Escape even when nothing on the page has focus', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    await screen.findByRole('complementary', { name: 'Selected receipt' });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(s.destination()).toBe('runs');
    await waitFor(() => expect(panel()).toBeNull());
  });

  it('returns to runs with Close, from inside the panel, and puts focus back on the row', async () => {
    const s = setup();
    await listed();
    await s.user.click(row(FIXTURE_IDS.interruptedRun));
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    await s.user.click(within(side).getByRole('button', { name: 'Close receipt' }));
    expect(s.destination()).toBe('runs');
    await waitFor(() => expect(document.activeElement).toBe(row(FIXTURE_IDS.interruptedRun)));
  });

  it('does not take focus when navigation elsewhere closes it', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    await screen.findByRole('complementary', { name: 'Selected receipt' });
    s.go('runs');
    await waitFor(() => expect(panel()).toBeNull());
    expect(document.activeElement).not.toBe(row(FIXTURE_IDS.failedRun));
  });

  it('reads an active run only while the page is visible, and stops when it finishes', async () => {
    const s = setup({ visible: false });
    await listed();
    s.go(`runs/${FIXTURE_IDS.runningRun}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const reads = () => s.recorded.calls().filter((call) => call.method === 'run').length;
    expect(reads()).toBe(0);
    s.visible.set(true);
    await waitFor(() => expect(reads()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(reads()).toBeGreaterThan(1);
    act(() => { s.fixture.settle(FIXTURE_IDS.runningRun); });
    const receipt = await screen.findByRole('article');
    await within(receipt).findByText('Succeeded');
    const settled = reads();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads()).toBe(settled);
    expect(executions(s.recorded)).toHaveLength(0);
  });
});

describe('the receipt panel', () => {
  const clipboard = (writeText: (text: string) => Promise<void>) => Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  it('keeps one header row: eyebrow, tool and status on the left, an icon Close at the far end, and no empty band above', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    const head = side.querySelector('.sw-receipt-head')!;
    expect(head.querySelector('.sw-eyebrow')?.textContent).toMatch(/^Run receipt · /u);
    expect(head.querySelector('h3')?.textContent).toBe('SEO workbench');
    const close = within(head as HTMLElement).getByRole('button', { name: 'Close receipt' });
    expect(close.textContent).toBe('');
    expect(close.closest('.sw-receipt-head-end')).toBeTruthy();
    expect(side.querySelector('.rh-peek-bar')).toBeNull();
    expect(side.firstElementChild).toBe(side.querySelector('article'));
  });

  it('gives the Run ID a full-width row of its own, selectable whole, with a quiet Copy', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    const wide = side.querySelector('.sw-fact-wide')!;
    expect(wide.querySelector('.sw-run-id')?.textContent).toBe(FIXTURE_IDS.failedRun);
    expect(within(wide as HTMLElement).getByRole('button', { name: 'Copy run ID' })).toBeTruthy();
    const css = readFileSync('modules/social/workbench/run-id.css', 'utf8');
    expect(css).toMatch(/\.sw-facts > \.sw-fact-wide \{ grid-column: 1 \/ -1; \}/u);
    expect(css).toMatch(/\.sw-run-id \{[^}]*user-select: all/u);
  });

  it('copies the full ID and says so with a toast', async () => {
    const writeText = vi.fn(async () => undefined);
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    clipboard(writeText); // after setup: user-event installs its own clipboard stub when it is set up
    await s.user.click(await screen.findByRole('button', { name: 'Copy run ID' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FIXTURE_IDS.failedRun);
    expect(await screen.findByRole('group', { name: 'Run ID copied' })).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('says so inline when the clipboard fails, and leaves the ID selectable', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    clipboard(async () => { throw new Error('denied'); });
    await s.user.click(await screen.findByRole('button', { name: 'Copy run ID' }));
    expect(await screen.findByText(/Couldn't copy it\. Select the ID/u)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Run ID copied' })).toBeNull();
    expect(document.querySelector('.sw-run-id')?.textContent).toBe(FIXTURE_IDS.failedRun);
  });

  it('shows a failed run\'s reason once', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    await within(side).findByText('The tool reported an error');
    const reason = 'Packet 1 has no sources. Add at least one source and run again.';
    // The raw result JSON, closed by default, holds the same text; what is shown is the receipt without it.
    const shown = side.cloneNode(true) as HTMLElement;
    shown.querySelector('details')?.remove();
    expect(shown.textContent!.split(reason)).toHaveLength(2);
  });
});

describe('running a run again', () => {
  it('has no Run again button: the receipt leads to the workbench with one honest line, and makes no call', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(within(side).queryByRole('button', { name: /run again/iu })).toBeNull();
    expect(within(side).getByText('To run it again, open the workbench, check the input and choose Run. HQ never resends a run on its own.')).toBeTruthy();
    expect(within(side).getByRole('button', { name: 'Open SEO workbench' })).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('leads to the workbench by navigation only; the Run there is its own explicit action', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    await s.user.click(within(side).getByRole('button', { name: 'Open SEO workbench' }));
    expect(s.destination()).toBe('workbenches/seo-studio');
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('names a tool that is not called a workbench as one', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.exampleRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(within(side).getByRole('button', { name: 'Open Signal inbox workbench' })).toBeTruthy();
  });

  it('never points an Unknown run, or one still active, at a second run', async () => {
    const s = setup();
    await listed();
    s.fixture.controls.setUnavailable(true);
    await s.user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(within(timeline()).getAllByText('Unknown')).toHaveLength(2));
    await s.user.click(row(FIXTURE_IDS.runningRun));
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(within(side).queryByRole('button', { name: /^Open .* workbench$/u })).toBeNull();
    expect(within(side).getByText(/Don't start it again until the status is known\. Use Check again/u)).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('does not offer the workbench while the run is still active', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.queuedRun}` });
    const side = await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(within(side).queryByRole('button', { name: /^Open .* workbench$/u })).toBeNull();
  });

  it('never claims anything is scheduled, published or connected', async () => {
    setup({ destination: `runs/${FIXTURE_IDS.failedRun}` });
    await screen.findByRole('complementary', { name: 'Selected receipt' });
    expect(document.body.textContent).not.toMatch(/\b(scheduled|published|connected)\b/iu);
  });
});

describe('run history stylesheet', () => {
  const css = readFileSync('modules/social/workbench/run-history.css', 'utf8');
  it('pulses only active runs and turns every pulse off under reduced motion', () => {
    expect(css).toMatch(/\.rh-glyph\[data-state="running"\]::after/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\.rh-glyph::after \{ animation: none !important/u);
    expect(css).toMatch(/:root\[data-hq-motion="reduce"\] \.rh-glyph::after \{ animation: none !important/u);
  });
  it('uses tokens, not raw colours, and no inline styles', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
    expect(css).not.toMatch(/style=/u);
  });
});
