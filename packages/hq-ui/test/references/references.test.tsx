import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Button, LinkList, LinkPicker, ReferenceChip, REFERENCE_STATUSES, type ReferenceEntry, type ReferencePort,
} from '../../src';
import { entries, envelope, NOW, OBSERVED } from './fixtures';

afterEach(() => { cleanup(); vi.useRealTimers(); delete document.documentElement.dataset.theme; });

describe.each(['light', 'dark'] as const)('reference UI in %s', (theme) => {
  beforeEach(() => { document.documentElement.dataset.theme = theme; });
  it('keeps all eight status labels, observations and snapshot provenance readable', () => {
    render(<LinkList entries={entries} projectId="demo-project" now={NOW} />);
    for (const status of REFERENCE_STATUSES) {
      const card = document.querySelector(`[data-reference-status="${status}"]`)!;
      expect(card.textContent).toContain(status[0]!.toUpperCase() + status.slice(1));
      expect(card.textContent).toContain('Autumn campaign brief');
      expect(card.textContent).toContain('Snapshot revision r1');
      expect(card.textContent).toContain('demo-workspace');
      expect(card.textContent).toContain('Fresh');
      expect(card.querySelector('time')?.getAttribute('datetime')).toBe(OBSERVED);
    }
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.querySelector('[style]')).toBeNull();
    expect(screen.getByText(/Latest title:/).textContent).toContain('Snapshot unchanged');
  });

  it('opens only fresh navigable references and keeps project mismatches read-only', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<LinkList entries={entries} projectId="demo-project" now={NOW} onOpen={open} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(3);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith(entries[0]!.envelope);
    cleanup();
    render(<ReferenceChip {...entries[0]!} projectId="another-project" now={NOW} onOpen={open} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Read-only project context/)).toBeTruthy();
  });

  it('updates only on explicit keyboard action, then restores the exact snapshot via Undo', async () => {
    const user = userEvent.setup();
    const original = entries[1]!;
    const update = vi.fn();
    const undo = vi.fn();
    const unlink = vi.fn();
    function Harness() {
      const [value, setValue] = useState<readonly ReferenceEntry[]>([original]);
      return <LinkList entries={value} projectId="demo-project" now={NOW} onUnlink={(reference) => {
        unlink(reference); setValue([]); return { undo: () => { undo(); setValue([original]); } };
      }} onUpdateSnapshot={(reference, snapshot) => {
        update(reference, snapshot);
        setValue([{ ...original, envelope: { ...reference, ...snapshot } }]);
        return { undo: () => { undo(); setValue([original]); } };
      }} />;
    }
    render(<Harness />);
    expect(update).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Update snapshot');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Undo'));
    expect(update).toHaveBeenCalledWith(original.envelope, { title: 'Autumn campaign brief — approved', sourceRevision: 'r2' });
    expect(screen.getByText('Autumn campaign brief — approved')).toBeTruthy();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(original.envelope.title)).toBeTruthy());
    expect(undo).toHaveBeenCalledOnce();
    expect(document.activeElement?.textContent).toBe('1 linked references');
    await user.tab();
    await user.keyboard(' ');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Undo'));
    expect(unlink).toHaveBeenCalledWith(original.envelope);
    expect(screen.getByText('No linked references')).toBeTruthy();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(original.envelope.title)).toBeTruthy());
    expect(original.envelope.sourceRevision).toBe('r1');
  });

  it('picker searches in the current project and supports keyboard selection, trap and Escape return', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const execute = vi.fn();
    const resolve = vi.fn();
    const open = vi.fn();
    const port = { find: vi.fn(async () => [envelope('a'), envelope('b', 'Draft copy')]), resolve, open, execute };
    function Harness() {
      const [visible, setVisible] = useState(false);
      return <><Button onClick={() => setVisible(true)}>Link to…</Button><LinkPicker open={visible} projectId="demo-project" port={port}
        onClose={() => setVisible(false)} onSelect={(reference) => { select(reference); setVisible(false); }} /></>;
    }
    render(<Harness />);
    await user.tab();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    await screen.findAllByRole('option');
    await user.type(input, 'copy');
    await waitFor(() => expect(port.find).toHaveBeenLastCalledWith('copy', { projectId: 'demo-project', limit: 30 }));
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);
    await user.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith(envelope('b', 'Draft copy'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link to…' }));
    await user.keyboard('{Enter}');
    await user.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe('Cancel');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link to…' }));
    expect(execute).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

it.each([
  { resolution: undefined, stale: false, expected: 'Unknown freshness' },
  { resolution: { status: 'available' as const, observedAt: OBSERVED }, stale: true, expected: 'Stale' },
  { resolution: { status: 'available' as const, observedAt: '2020-01-01T00:00:00Z' }, expected: 'Stale' },
  { resolution: { status: 'available' as const, observedAt: 'bad date' }, expected: 'Unknown freshness' },
  { resolution: { status: 'available' as const, observedAt: '2030-01-01T00:00:00Z' }, expected: 'Unknown freshness' },
])('never claims availability for unresolved/stale/invalid observations %#', ({ resolution, stale, expected }) => {
  render(<ReferenceChip envelope={envelope()} resolution={resolution} stale={stale} now={NOW} projectId="demo-project" />);
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('Available')).toBeNull();
  expect(screen.getByText(new RegExp(expected))).toBeTruthy();
});

it('expires observations while mounted and releases its clock on unmount', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const { unmount } = render(<ReferenceChip envelope={envelope()} resolution={{ status: 'available', observedAt: OBSERVED }} maxAgeMs={30000} projectId="demo-project" />);
  expect(screen.getByText('Available')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText('Unknown')).toBeTruthy();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('mutation failures remain visible and an unconfirmed action does not advertise Undo', async () => {
  const user = userEvent.setup();
  const unlink = vi.fn(async () => { throw new Error('conflict'); });
  render(<LinkList entries={[entries[0]!]} now={NOW} projectId="demo-project" onUnlink={unlink} />);
  await user.tab();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(unlink).toHaveBeenCalledOnce();
});

it('blocks duplicate links and overflow, validates envelopes and excludes other projects', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const a = envelope('a');
  const b = envelope('b');
  const port = { find: vi.fn(async () => [a, a, b, { ...a, entityId: 'foreign', projectId: 'other' }, { ...a, version: 2 } as never]) };
  const { rerender } = render(<LinkPicker open projectId="demo-project" port={port} existing={[a]} onClose={vi.fn()} onSelect={select} />);
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  expect(within(screen.getAllByRole('option')[0]!).getByText('Already linked')).toBeTruthy();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(select).not.toHaveBeenCalled();
  rerender(<LinkPicker open projectId="demo-project" port={port} existing={Array.from({ length: 30 }, (_, i) => envelope(String(i)))} onClose={vi.fn()} onSelect={select} />);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByText(/30-link limit/)).toBeTruthy();
});

it('discards late responses after a query or project change', async () => {
  const user = userEvent.setup();
  const resolvers: ((value: readonly ReturnType<typeof envelope>[]) => void)[] = [];
  const port: Pick<ReferencePort, 'find'> = { find: vi.fn(() => new Promise<readonly ReturnType<typeof envelope>[]>((resolve) => resolvers.push(resolve))) };
  const { rerender } = render(<LinkPicker open projectId="demo-project" port={port} onClose={vi.fn()} onSelect={vi.fn()} />);
  await waitFor(() => expect(resolvers).toHaveLength(1));
  expect(screen.getByText('Searching…')).toBeTruthy();
  await user.type(screen.getByRole('combobox'), 'a');
  await waitFor(() => expect(resolvers).toHaveLength(2));
  await act(async () => { resolvers[1]!([envelope('new', 'New result')]); });
  expect(screen.getByText('New result')).toBeTruthy();
  await act(async () => { resolvers[0]!([envelope('old', 'Old result')]); });
  expect(screen.queryByText('Old result')).toBeNull();
  rerender(<LinkPicker open projectId="next-project" port={port} onClose={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.queryByRole('option')).toBeNull();
  await waitFor(() => expect(resolvers).toHaveLength(3));
  await act(async () => { resolvers[2]!([]); });
  expect(screen.getByText('No references found.')).toBeTruthy();
});

it('reports search errors and retries explicitly without selecting or mutating', async () => {
  const user = userEvent.setup();
  const find = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  const select = vi.fn();
  render(<LinkPicker open projectId="demo-project" port={{ find }} onClose={vi.fn()} onSelect={select} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  await user.tab();
  expect(document.activeElement?.textContent).toBe('Retry search');
  await user.keyboard('{Enter}');
  await screen.findByText('No references found.');
  expect(document.activeElement).toBe(screen.getByRole('combobox'));
  expect(find).toHaveBeenCalledTimes(2);
  expect(select).not.toHaveBeenCalled();
});

it('guards pending mutations and keeps failed Undo available with an honest error', async () => {
  const user = userEvent.setup();
  let finish!: (value: { undo: () => Promise<void> }) => void;
  const unlink = vi.fn(() => new Promise<{ undo: () => Promise<void> }>((resolve) => { finish = resolve; }));
  const undo = vi.fn(async () => { throw new Error('version conflict'); });
  render(<LinkList entries={[entries[0]!]} now={NOW} projectId="demo-project" onUnlink={unlink} />);
  await user.tab();
  await user.keyboard('{Enter}{Enter}');
  expect(unlink).toHaveBeenCalledOnce();
  expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('true');
  await act(async () => { finish({ undo }); });
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Undo was not confirmed. Check the source record before trying again.');
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  expect(undo).toHaveBeenCalledOnce();
});

it('never offers snapshot updates for invalid, stale, unavailable or foreign observations', () => {
  const cases: ReferenceEntry[] = [
    { ...entries[1]!, stale: true },
    { ...entries[1]!, envelope: { ...envelope('foreign'), projectId: 'other' } },
    { ...entries[1]!, envelope: envelope('invalid'), resolution: { ...entries[1]!.resolution!, latestTitle: '  ' } },
    ...entries.filter((entry) => !['changed', 'available'].includes(entry.resolution!.status)),
  ];
  render(<LinkList entries={cases} now={NOW} projectId="demo-project" onUpdateSnapshot={vi.fn()} />);
  expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
});

it('all explicit actions use only their narrow callbacks and never an execution capability', async () => {
  const user = userEvent.setup();
  const execute = vi.fn();
  const readTarget = Object.freeze({ ...entries[1]!.envelope });
  const serialized = JSON.stringify(readTarget);
  const recorder = {
    open: vi.fn(), unlink: vi.fn(() => ({ undo: vi.fn() })), update: vi.fn(() => ({ undo: vi.fn() })), execute,
  };
  render(<LinkList entries={[{ ...entries[1]!, envelope: readTarget }]} now={NOW} projectId="demo-project"
    onOpen={recorder.open} onUnlink={recorder.unlink} onUpdateSnapshot={recorder.update} />);
  await user.tab();
  await user.keyboard('{Enter}');
  await user.tab();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Undo'));
  await user.keyboard('{Enter}');
  await user.tab();
  await user.tab();
  await user.tab();
  expect(document.activeElement?.textContent).toBe('Update snapshot');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Undo'));
  await user.keyboard('{Enter}');
  expect(recorder.open).toHaveBeenCalledOnce();
  expect(recorder.unlink).toHaveBeenCalledOnce();
  expect(recorder.update).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(JSON.stringify(readTarget)).toBe(serialized);
});
