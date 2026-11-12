import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickCapture } from '../QuickCapture';
import { createDraftStore } from '../drafts';
import { setup, writes } from '../../board/test/fixtures';
import { durableDrafts, registerWorkDurability, resetWorkDurability } from '../../core/durability';
import { createFixturePlanner } from '../../core/fixtures/adapter';

afterEach(() => { cleanup(); resetWorkDurability(); });

it('keeps typed capture text on a pending or unreadable restore, with a visible action reason and no send', async () => {
  const env = await setup();
  const port = createFixturePlanner().port;
  let release!: () => void;
  const load = new Promise<void>((resolve) => { release = resolve; });
  registerWorkDurability(port, { async load() { await load; throw new Error('synthetic unreadable data'); }, async save() { throw new Error('must not save'); } });
  const drafts = createDraftStore({ durableDrafts: durableDrafts(port) });
  render(<QuickCapture open onClose={() => { throw new Error('must retain capture'); }} store={env.store}
    state={{ ...env.store.getState(), save: { kind: 'offline' } }} feedback={env.feedback} drafts={drafts} />);
  const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Retain this synthetic capture' } });
  await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
  const keep = screen.getByRole('button', { name: 'Keep as HQ draft' });
  expect(keep.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(keep.getAttribute('aria-describedby')!)?.textContent).toContain('Reading');
  await act(async () => { fireEvent.click(keep); });
  expect(title.value).toBe('Retain this synthetic capture');
  await act(async () => { release(); await drafts.ready(); });
  expect(keep.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(keep.getAttribute('aria-describedby')!)?.textContent).toContain('Nothing will overwrite');
  expect(title.value).toBe('Retain this synthetic capture');
  expect(writes(env.calls)).toEqual([]);
});
