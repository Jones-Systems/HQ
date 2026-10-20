import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HQ_REFERENCES_FEATURE, valueContaining, type Item } from '../../core';
import { boardItems, item, moveShape, setup, writes } from '../../board/test/fixtures';
import { Host } from '../../board/test/host';
import { NOTES_DEBOUNCE_MS } from '../edits';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Env = Awaited<ReturnType<typeof setup>>;

function openCard(env: Env, id: string) {
  render(<Host store={env.store} feedback={env.feedback} detail={env.detail} initialOpen={id} />);
  return screen.getByRole('complementary', { name: /^Card · / });
}

const patches = (env: Env) => writes(env.calls).filter((c) => c.method === 'patch');
const flush = () => act(async () => { await Promise.resolve(); });

describe('card detail autosave (RV-3)', () => {
  it('saves notes 1,200 ms after typing stops, not before, as one patch at the confirmed revision', async () => {
    const env = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const panel = openCard(env, 'it-shed');
    const notes = within(panel).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Primer first. Then' } });
    await act(async () => { vi.advanceTimersByTime(600); });
    fireEvent.change(notes, { target: { value: 'Primer first. Then two coats.' } });
    await act(async () => { vi.advanceTimersByTime(NOTES_DEBOUNCE_MS - 1); });
    expect(patches(env)).toEqual([]);
    expect(within(panel).getByText('Unsaved changes')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(patches(env).map((c) => c.args.slice(0, 3))).toEqual([['it-shed', 1, { notes: 'Primer first. Then two coats.' }]]);
    expect(env.byId('it-shed').notes).toBe('Primer first. Then two coats.');
  });

  it('leaving the notes field saves at once, and so does closing the panel mid-debounce', async () => {
    const env = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const panel = openCard(env, 'it-shed');
    const notes = within(panel).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Blur saves' } });
    await act(async () => { fireEvent.blur(notes); });
    expect(patches(env).map((c) => c.args[2])).toEqual([{ notes: 'Blur saves' }]);

    fireEvent.change(within(panel).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Close saves' } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Close card' })); });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(patches(env).map((c) => c.args[2])).toEqual([{ notes: 'Blur saves' }, { notes: 'Close saves' }]);
    // Nothing is sent a second time when the old debounce would have fired.
    await act(async () => { vi.advanceTimersByTime(NOTES_DEBOUNCE_MS * 2); });
    expect(patches(env)).toHaveLength(2);
  });

  it('a title edit commits on Enter, and Escape reverts it without sending', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-zine');
    const title = within(panel).getByRole('textbox', { name: 'Card title' });
    fireEvent.change(title, { target: { value: 'Draft a pond zine' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect((title as HTMLInputElement).value).toBe('Draft a garden zine');
    fireEvent.change(title, { target: { value: 'Draft a winter zine' } });
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
    expect(patches(env).map((c) => c.args[2])).toEqual([{ title: 'Draft a winter zine' }]);
  });

  it('offline, unsaved text is labelled as kept for this session only', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-shed');
    env.faults.readsUnavailable(true);
    await act(async () => { await env.store.poll(); });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Offline thought' } });
    expect(within(panel).getByText('this session only')).toBeTruthy();
  });
});

describe('card detail conflicts', () => {
  it('notes changed elsewhere since typing began: nothing is sent until the user chooses, and Keep mine re-sends', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-shed');
    const notes = within(panel).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Primer first. Mine.' } });
    await env.device.patch('it-shed', 1, { notes: 'Sand first. Theirs.' }, env.otherRid());
    await act(async () => { await env.store.poll(); });
    await act(async () => { fireEvent.blur(notes); });

    const banner = within(panel).getByRole('alert');
    expect(banner.textContent).toContain('The notes changed in the Planner since you started editing.');
    expect(patches(env)).toEqual([]);
    expect((within(panel).getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value).toBe('Primer first. Mine.');

    await act(async () => { fireEvent.click(within(banner).getByRole('button', { name: 'Keep mine' })); });
    expect(patches(env).map((c) => c.args.slice(0, 3))).toEqual([['it-shed', 2, { notes: 'Primer first. Mine.' }]]);
    expect(env.byId('it-shed').notes).toBe('Primer first. Mine.');
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('Use theirs drops the unsent text, shows the Planner value and sends nothing', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-shed');
    const notes = within(panel).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Primer first. Mine.' } });
    await env.device.patch('it-shed', 1, { notes: 'Sand first. Theirs.' }, env.otherRid());
    await act(async () => { await env.store.poll(); });
    await act(async () => { fireEvent.blur(notes); });
    fireEvent.click(within(panel).getByRole('button', { name: 'Use theirs' }));
    expect((within(panel).getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value).toBe('Sand first. Theirs.');
    expect(within(panel).queryByRole('alert')).toBeNull();
    expect(patches(env)).toEqual([]);
  });

  it('a different field changed elsewhere: the edit is re-applied at the new revision without asking', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-shed');
    await env.device.patch('it-shed', 1, { title: 'Repaint the shed green' }, env.otherRid());
    const notes = within(panel).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Primer first. Two coats.' } });
    await act(async () => { fireEvent.blur(notes); });
    expect(patches(env).map((c) => c.args.slice(0, 3))).toEqual([
      ['it-shed', 1, { notes: 'Primer first. Two coats.' }],
      ['it-shed', 2, { notes: 'Primer first. Two coats.' }],
    ]);
    expect(env.byId('it-shed')).toMatchObject({ title: 'Repaint the shed green', notes: 'Primer first. Two coats.', revision: 3 });
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('a select edit that meets a changed value elsewhere asks instead of overwriting', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-zine');
    await env.device.patch('it-zine', 1, { motivation: 'want' }, env.otherRid());
    await act(async () => { fireEvent.change(within(panel).getByRole('combobox', { name: 'Why' }), { target: { value: 'need' } }); });
    expect(within(panel).getByRole('alert').textContent).toContain('The why changed in the Planner');
    expect(patches(env)).toHaveLength(1);
    fireEvent.click(within(panel).getByRole('button', { name: 'Use theirs' }));
    expect(env.byId('it-zine').motivation).toBe('want');
    expect(patches(env)).toHaveLength(1);
  });
});

describe('card detail status and Undo', () => {
  it('a status pill is a move to the top, and Undo restores the exact place', async () => {
    const env = await setup();
    const before = env.layout();
    const panel = openCard(env, 'it-bread');
    const pills = within(panel).getByRole('group', { name: 'Status' });
    expect(within(pills).getByRole('button', { name: 'Next' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(within(pills).getByRole('button', { name: 'Active' })); });

    const moved = writes(env.calls);
    expect(moved.map(moveShape)).toEqual([{ method: 'move', args: ['it-bread', 1, 'active', { place: 'top' }] }]);
    expect(env.order('active')[0]).toBe('it-bread');
    expect(screen.getByRole('complementary', { name: 'Card · Active' })).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    const undone = writes(env.calls).slice(moved.length);
    expect(undone.map(moveShape)).toEqual([{ method: 'move', args: ['it-bread', 2, 'next', { after_id: 'it-zine' }] }]);
    expect(env.layout()).toEqual(before);
    expect(writes(env.calls).some((c) => c.method === 'patch')).toBe(false);
  });

  it('pressing the current status sends nothing', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-bread');
    await act(async () => { fireEvent.click(within(within(panel).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Next' })); });
    expect(writes(env.calls)).toEqual([]);
  });

  it('a field edit shows Saved with Undo, and Undo restores the old value', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-zine');
    await act(async () => { fireEvent.change(within(panel).getByRole('combobox', { name: 'Why' }), { target: { value: 'need' } }); });
    expect(env.byId('it-zine').motivation).toBe('need');
    expect(screen.getByText('Saved why')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(patches(env).map((c) => c.args.slice(0, 3))).toEqual([
      ['it-zine', 1, { motivation: 'need' }],
      ['it-zine', 2, { motivation: 'exploring' }],
    ]);
    expect(env.byId('it-zine').motivation).toBe('exploring');
    expect(screen.getByText('Undone: Saved why')).toBeTruthy();
  });
});

describe('card detail checklist, dates and links', () => {
  it('adds, ticks and reorders steps with Alt+↓, keeping step identity', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-shed');
    const adder = within(panel).getByRole('textbox', { name: 'New step' });
    fireEvent.change(adder, { target: { value: 'Buy primer' } });
    await act(async () => { fireEvent.keyDown(adder, { key: 'Enter' }); });
    fireEvent.change(adder, { target: { value: 'Wash the walls' } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Add step' })); });
    expect(within(panel).getByText('0 of 2 done')).toBeTruthy();

    await act(async () => { fireEvent.click(within(panel).getByRole('checkbox', { name: 'Done: Wash the walls' })); });
    expect(within(panel).getByText('1 of 2 done')).toBeTruthy();

    const [first, second] = env.byId('it-shed').next_steps;
    await act(async () => { fireEvent.keyDown(within(panel).getByRole('checkbox', { name: 'Done: Buy primer' }), { key: 'ArrowDown', altKey: true }); });
    expect(env.byId('it-shed').next_steps.map((s) => [s.id, s.text, s.done])).toEqual([
      [second!.id, 'Wash the walls', true], [first!.id, 'Buy primer', false],
    ]);
    expect(document.activeElement).toBe(within(panel).getByRole('checkbox', { name: 'Done: Buy primer' }));
    expect(patches(env).map((c) => Object.keys(c.args[2] as object))).toEqual([['next_steps'], ['next_steps'], ['next_steps'], ['next_steps']]);
  });

  it('adds a typed date only on Save date, keeps a precision change on the same period, and shows Planner errors', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-zine');
    expect(within(panel).getByText('No dates. Nothing is dated unless you add one.')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '+ Add a date' }));
    const form = within(panel).getByRole('group', { name: 'Add a date' });
    expect(writes(env.calls)).toEqual([]);

    const precision = within(form).getByRole('combobox', { name: 'Precision' });
    fireEvent.change(precision, { target: { value: 'week' } });
    const week = within(form).getByRole('textbox', { name: /Week/u }) as HTMLInputElement;
    expect(week.value).toBe(valueContaining('week', '2026-10-21'));
    fireEvent.change(week, { target: { value: 'next fortnight' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save date' })); });
    expect(within(form).getByRole('alert').textContent).not.toBe('');
    expect(env.byId('it-zine').dates).toEqual([]);

    fireEvent.change(precision, { target: { value: 'day' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Kind' }), { target: { value: 'deadline' } });
    fireEvent.change(within(form).getByLabelText(/^Day/u), { target: { value: '2026-10-30' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save date' })); });
    expect(patches(env).at(-1)!.args[2]).toEqual({
      dates: [{ id: expect.any(String), kind: 'deadline', precision: 'day', value: '2026-10-30', time: null, end_time: null, tz: null, note: '' }],
    });
    expect(within(panel).queryByRole('group', { name: 'Add a date' })).toBeNull();
    expect(env.byId('it-zine').dates).toMatchObject([{ kind: 'deadline', value: '2026-10-30' }]);
  });

  it('links open outside HQ with no opener and no port call; HQ references are read-only provenance', async () => {
    const target = {
      version: 1 as const, domain: 'social' as const, projectId: 'fixture-project', kind: 'draft', entityId: 'draft-1',
      title: 'Spring post', returnDestination: { domain: 'work' as const, destination: 'home' },
    };
    const items: Item[] = [
      ...boardItems().filter((i) => i.id !== 'it-zine'),
      item('it-zine', 'Draft a garden zine', 'next', 1024, {
        references: [
          { id: 'ref-web', kind: 'url', label: 'Zine layout notes', url: 'https://example.com/zine' },
          { id: 'ref-hq', kind: 'hq', label: 'Spring post', target },
        ],
      }),
    ];
    const env = await setup({ items, features: [HQ_REFERENCES_FEATURE] });
    const panel = openCard(env, 'it-zine');
    const links = within(panel).getByRole('region', { name: 'Links' });
    const link = within(links).getByRole('link', { name: /Zine layout notes/u });
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')])
      .toEqual(['https://example.com/zine', '_blank', 'noopener noreferrer']);
    expect(within(links).getByText('example.com')).toBeTruthy();

    const calls = env.calls.length;
    fireEvent.click(link);
    expect(env.calls).toHaveLength(calls);

    expect(within(links).getAllByRole('link')).toHaveLength(1);
    expect(within(links).getByText('HQ · social · draft')).toBeTruthy();
    expect(within(links).getByText('Not resolved')).toBeTruthy();
    expect(within(links).getByText(/Read-only here; following it never starts anything\./u)).toBeTruthy();
  });

  it('adds a web link through the Planner and shows its validation message for a bad address', async () => {
    const env = await setup();
    const panel = openCard(env, 'it-zine');
    const links = within(panel).getByRole('region', { name: 'Links' });
    fireEvent.click(within(links).getByRole('button', { name: '+ Add link' }));
    fireEvent.change(within(links).getByRole('textbox', { name: 'Label' }), { target: { value: 'Paper sizes' } });
    fireEvent.change(within(links).getByRole('textbox', { name: /Web address/u }), { target: { value: 'javascript:alert(1)' } });
    await act(async () => { fireEvent.click(within(links).getByRole('button', { name: 'Save link' })); });
    expect(within(links).getByRole('alert').textContent).not.toBe('');
    expect(env.byId('it-zine').references).toEqual([]);

    fireEvent.change(within(links).getByRole('textbox', { name: /Web address/u }), { target: { value: 'https://example.org/paper' } });
    await act(async () => { fireEvent.click(within(links).getByRole('button', { name: 'Save link' })); });
    expect(env.byId('it-zine').references).toMatchObject([{ kind: 'url', label: 'Paper sizes', url: 'https://example.org/paper' }]);
  });
});

describe('card detail states', () => {
  it('an item missing from the snapshot says so and changes nothing', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} detail={env.detail} initialOpen="it-gone" />);
    expect(screen.getByText('This item isn’t in the Planner snapshot')).toBeTruthy();
    expect(writes(env.calls)).toEqual([]);
  });

  it('an archived item says archive is not Done, and Restore un-archives it', async () => {
    const env = await setup({ items: [...boardItems(), item('it-old', 'Old fence plan', 'considering', 4096, { archived_at: '2026-10-10T10:00:00.000Z' })] });
    const panel = openCard(env, 'it-old');
    const status = within(panel).getByRole('status');
    expect(status.textContent).toContain('not on the board; archive is not Done');
    await act(async () => { fireEvent.click(within(status).getByRole('button', { name: 'Restore' })); });
    expect(writes(env.calls).map((c) => [c.method, ...c.args.slice(0, 3)])).toEqual([['setArchived', 'it-old', 1, false]]);
    expect(env.byId('it-old').archived_at).toBeNull();
  });
});
