import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { setup, writes } from '../../board/test/fixtures';
import { Host } from '../../board/test/host';
import { CAPTURE_FOOTER } from '../QuickCapture';
import { DRAFT_LABEL } from '../drafts';

afterEach(cleanup);

async function open(env: Awaited<ReturnType<typeof setup>>) {
  render(<Host store={env.store} feedback={env.feedback} drafts={env.drafts} />);
  fireEvent.keyDown(screen.getByTestId('work-root'), { key: 'n' });
  const dialog = screen.getByRole('dialog', { name: 'Capture' });
  return { dialog, title: within(dialog).getByRole('textbox', { name: 'Title' }) };
}

const creates = (env: Awaited<ReturnType<typeof setup>>) => writes(env.calls).filter((c) => c.method === 'create');

describe('quick capture (RV-2)', () => {
  it('N opens capture only inside the Work surface and never while typing', async () => {
    const env = await setup();
    render(<><input aria-label="Elsewhere" /><Host store={env.store} feedback={env.feedback} initialOpen="it-zine" /></>);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Elsewhere' }), { key: 'n' });
    fireEvent.keyDown(document.body, { key: 'n' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'n' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('work-root'), { key: 'N', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('work-root'), { key: 'n' });
    expect(screen.getByRole('dialog', { name: 'Capture' })).toBeTruthy();
    expect(screen.getByText(new RegExp(CAPTURE_FOOTER.replace('.', '\\.')))).toBeTruthy();
  });

  it('creates exactly one Inbox item at the top, with no dates', async () => {
    const env = await setup();
    const { title } = await open(env);
    fireEvent.change(title, { target: { value: 'Label the jam jars' } });
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
    expect(creates(env)).toHaveLength(1);
    expect(creates(env)[0]!.args[0]).toMatchObject({ title: 'Label the jam jars', status: 'inbox', dates: [] });
    const created = env.store.getState().items.find((i) => i.title === 'Label the jam jars')!;
    expect(created.dates).toEqual([]);
    expect(env.order('inbox')[0]).toBe(created.id);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Captured “Label the jam jars” to Inbox')).toBeTruthy();
  });

  it('a date-like word only offers a suggestion; the title is saved exactly as typed', async () => {
    const env = await setup();
    const { dialog, title } = await open(env);
    fireEvent.change(title, { target: { value: 'Call the plumber tomorrow' } });
    expect(within(dialog).getByText('‘tomorrow’ looks like a date. Add Target · Thu, Oct 22? The title stays as typed.')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
    expect(creates(env)[0]!.args[0]).toMatchObject({ title: 'Call the plumber tomorrow', status: 'inbox', dates: [] });
  });

  it('adds the suggested date only when the user accepts it', async () => {
    const env = await setup();
    const { dialog, title } = await open(env);
    fireEvent.change(title, { target: { value: 'Call the plumber tomorrow' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add date' }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(creates(env)[0]!.args[0]).toMatchObject({
      title: 'Call the plumber tomorrow', status: 'inbox',
      dates: [{ kind: 'target', precision: 'day', value: '2026-10-22', time: null, end_time: null, tz: null, note: '', id: expect.any(String) }],
    });
  });

  it('Shift+Enter saves and keeps the dialog open for the next capture', async () => {
    const env = await setup();
    const { title } = await open(env);
    fireEvent.change(title, { target: { value: 'Oil the hinges' } });
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter', shiftKey: true }); });
    expect(screen.getByRole('dialog', { name: 'Capture' })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe('');
    expect(creates(env)).toHaveLength(1);
  });

  it('Add a card in a column captures into that status, still at the top', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(screen.getByRole('button', { name: 'Capture to Inbox (adds to the top)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card in Next (adds to the top)' }));
    const dialog = screen.getByRole('dialog', { name: 'Capture' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Prune the roses' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(creates(env)[0]!.args[0]).toMatchObject({ title: 'Prune the roses', status: 'next', dates: [] });
    expect(env.order('next')[0]).toBe(env.store.getState().items.find((i) => i.title === 'Prune the roses')!.id);
  });
});

describe('offline capture and HQ drafts (RW-10)', () => {
  it('offline, capture is kept as a labelled HQ draft only by explicit choice, and sent only by Send drafts', async () => {
    const env = await setup();
    env.faults.readsUnavailable(true);
    await env.store.poll();
    const { dialog, title } = await open(env);
    fireEvent.change(title, { target: { value: 'Patch the hammock' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(within(dialog).getByText('Planner unreachable')).toBeTruthy();
    expect(creates(env)).toEqual([]);
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Keep as HQ draft' })); });
    const panel = screen.getByRole('region', { name: 'HQ drafts' });
    expect(within(panel).getByText('1 HQ draft')).toBeTruthy();
    expect(within(panel).getByText(DRAFT_LABEL)).toBeTruthy();

    // Reconnecting never sends drafts on its own.
    env.faults.readsUnavailable(false);
    await act(async () => { await env.store.poll(); });
    expect(creates(env)).toEqual([]);

    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send drafts' })); });
    expect(creates(env)).toHaveLength(1);
    expect(creates(env)[0]!.args[0]).toMatchObject({ title: 'Patch the hammock', status: 'inbox', dates: [] });
    expect(screen.queryByRole('region', { name: 'HQ drafts' })).toBeNull();
  });

  it('a capture refused as unavailable is not saved and offers the HQ draft explicitly', async () => {
    const env = await setup();
    const { dialog, title } = await open(env);
    fireEvent.change(title, { target: { value: 'Patch the hammock' } });
    env.faults.next('unavailable');
    await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
    expect(within(dialog).getByRole('button', { name: 'Keep as HQ draft' })).toBeTruthy();
    expect(env.drafts.getState().drafts).toEqual([]);
    expect(env.store.getState().items.some((i) => i.title === 'Patch the hammock')).toBe(false);
  });
});
