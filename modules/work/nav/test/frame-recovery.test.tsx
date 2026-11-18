import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { WorkDomain, workSession } from '..';
import { fixedNow, installPlanner, uninstallPlanner } from './support';

const context = parseProjectContext({ id: 'frame-recovery', name: 'Frame fixture' })!;
const port = (destination: string): ModulePort => ({
  context, destination, appearance: 'light', navigate: vi.fn(),
  desktop: { platform: 'browser', versions: { electron: null } },
});

beforeEach(() => { installPlanner(); });
afterEach(() => { cleanup(); uninstallPlanner(); vi.restoreAllMocks(); });

it('offers Done in Glance through one move with an exact Undo', async () => {
  const session = workSession(context.id);
  await session.store.load();
  const item = session.store.getState().items.find((candidate) => candidate.status === 'active')!;
  const original = item.status;
  render(<WorkDomain {...port('glance')} now={fixedNow} />);
  const now = within(screen.getByRole('region', { name: 'Now' }));
  await act(async () => { fireEvent.click(now.getByRole('button', { name: `Mark “${item.title}” done` })); });
  await waitFor(() => expect(session.store.getState().items.find((candidate) => candidate.id === item.id)?.status).toBe('done'));
  expect(session.store.getState().undo).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
  expect(session.store.getState().items.find((candidate) => candidate.id === item.id)?.status).toBe(original);
  expect(session.store.getState().undo).toHaveLength(0);
});

it('keeps number shortcuts out of the capture textbox', async () => {
  const session = workSession(context.id);
  await session.store.load();
  const props = port('list');
  const view = render(<WorkDomain {...props} now={fixedNow} />);
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Capture to Inbox' }), { key: '1' });
  expect(props.navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(view.container.querySelector('.wd-domain')!, { key: '1' });
  expect(props.navigate).toHaveBeenCalledExactlyOnceWith('glance');
  expect(session.store.getState().undo).toHaveLength(0);
});

it('mounts narrow detail as a modal with a keyboard close route', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600, height: 500, top: 0, left: 0, right: 600, bottom: 500, x: 0, y: 0,
    toJSON: () => ({}),
  });
  const session = workSession(context.id);
  await session.store.load();
  const id = session.store.getState().items[0]!.id;
  const props = port(`item/${id}`);
  render(<WorkDomain {...props} now={fixedNow} />);
  const sheet = await screen.findByRole('dialog', { name: 'Card details' });
  expect(sheet.getAttribute('aria-modal')).toBe('true');
  expect(within(sheet).getByRole('textbox', { name: 'Card title' })).toBeTruthy();
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(props.navigate).toHaveBeenCalledExactlyOnceWith(session.ui.getState().lastPage);
});
