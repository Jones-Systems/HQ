import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { registerWorkDurability, resetWorkDurability } from '../../core/durability';
import { ToolbarCapture } from '../ToolbarCapture';
import { workSession } from '../session';
import { fixedNow, installPlanner, uninstallPlanner } from './support';

afterEach(() => { cleanup(); uninstallPlanner(); resetWorkDurability(); });

it('retains toolbar input and emits no success when device restore is pending or unreadable', async () => {
  const env = installPlanner();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = vi.fn(async () => {});
  registerWorkDurability(env.recorded.port, { async load() { await gate; throw new Error('Synthetic unreadable data'); }, save });
  const session = workSession('toolbar-durable-restore');
  session.ui.setCapture({ text: 'Keep this local text', unavailable: true });
  render(<ToolbarCapture session={session} state={{ ...session.store.getState(), save: { kind: 'offline' } }} now={fixedNow} onMore={() => {}} />);
  const keep = screen.getByRole('button', { name: 'Keep as HQ draft' });
  expect(keep.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(keep.getAttribute('aria-describedby')!)?.textContent).toContain('Reading HQ drafts');
  await act(async () => { fireEvent.click(keep); });
  expect(session.ui.getState().capture).toMatchObject({ text: 'Keep this local text', unavailable: true, date: null });
  expect(session.feedback.getState()).toEqual([]);
  await act(async () => { release(); await session.drafts.ready(); });
  await act(async () => { fireEvent.click(keep); });
  expect(session.ui.getState().capture.text).toBe('Keep this local text');
  expect(session.ui.getState().capture.error).toContain('Nothing will overwrite');
  expect(document.getElementById(keep.getAttribute('aria-describedby')!)?.textContent).toContain('Nothing will overwrite');
  expect(save).not.toHaveBeenCalled();
  expect(session.feedback.getState()).toEqual([]);
  expect(env.recorded.writes()).toEqual([]);
});

it.each([false, true])('reports pending draft persistence before settlement and retains a copy on failure %s', async failed => {
  const env = installPlanner();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  registerWorkDurability(env.recorded.port, { async load() { return null; }, async save() { await gate; if (failed) throw new Error('Synthetic device refusal'); } });
  const session = workSession(`toolbar-durable-save-${failed}`);
  await session.drafts.ready();
  session.ui.setCapture({ text: 'Keep this durable draft', unavailable: true });
  render(<ToolbarCapture session={session} state={{ ...session.store.getState(), save: { kind: 'offline' } }} now={fixedNow} onMore={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep as HQ draft' })); });
  expect(session.drafts.getState().durability).toBe('saving');
  expect(session.feedback.getState().at(-1)?.meta).toContain('device save is pending');
  expect(session.feedback.getState().at(-1)?.meta).not.toContain('HQ drafts are kept on this device');
  await act(async () => { release(); await session.drafts.settle(); });
  expect(session.drafts.getState().durability).toBe(failed ? 'failed' : 'saved');
  expect(session.drafts.getState().drafts.map(draft => draft.fields.title)).toEqual(['Keep this durable draft']);
  expect(env.recorded.writes()).toEqual([]);
});
