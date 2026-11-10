// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectId, subjectId, type TasteClientPort, type TasteSnapshot } from '../../src/contract.ts';
import { buildProfile, projectTaste } from '../../src/profile.ts';
import { TastePanel } from '../../src/ui/TastePanel.tsx';

const A = projectId('synthetic-a');
const B = projectId('synthetic-b');
const subject = { id: subjectId('synthetic-subject'), kind: 'other' as const, label: 'Synthetic subject' };

function empty(id = A): TasteSnapshot {
  const state = projectTaste([]);
  return { journal: { state: 'open', head: state.head }, assessments: [], notes: [], examples: [], contributions: {},
    general: buildProfile(state, { kind: 'general' }), project: buildProfile(state, { kind: 'project', projectId: id }) };
}

function client(read: TasteClientPort['snapshot']): TasteClientPort {
  return { label: 'Synthetic client', snapshot: vi.fn(read),
    submit: vi.fn<TasteClientPort['submit']>(async () => ({ status: 'rejected', reason: 'synthetic' })),
    exportProfile: vi.fn(async () => ({ json: 'synthetic export for A', digest: 'a'.repeat(64), omitted: [] })) };
}

afterEach(cleanup);

describe('TastePanel project binding', () => {
  it('discards a late old-project read and keeps the new project unavailable after a failed read', async () => {
    let resolveA!: (snapshot: TasteSnapshot) => void;
    const a = client(() => new Promise<TasteSnapshot>((resolve) => { resolveA = resolve; }));
    const b = client(async () => { throw new Error('synthetic failure'); });
    const view = render(<TastePanel client={a} subject={subject} projectId={A} />);
    view.rerender(<TastePanel client={b} subject={subject} projectId={B} />);
    await screen.findByText('Taste is unavailable right now.');
    await act(async () => resolveA(empty(A)));
    expect(screen.getByText('Taste is unavailable right now.')).toBeTruthy();
    expect(screen.queryByText('Project profile')).toBeNull();
    expect(a.submit).not.toHaveBeenCalled();
    expect(b.submit).not.toHaveBeenCalled();
  });

  it('drops note drafts and exported results on project switches, including when the client object is reused', async () => {
    const port = client(async (id) => empty(id ?? A));
    const view = render(<TastePanel client={port} subject={subject} projectId={A} />);
    await screen.findByText('Project profile');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Synthetic A draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('synthetic export for A');
    view.rerender(<TastePanel client={port} subject={subject} projectId={B} />);
    await screen.findByText('Project profile');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('synthetic export for A')).toBeNull();
    expect(port.submit).not.toHaveBeenCalled();
  });

  it('drops project drafts and export results when changing to general taste', async () => {
    const port = client(async () => empty());
    render(<TastePanel client={port} subject={subject} projectId={A} />);
    await screen.findByText('Project profile');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Synthetic project draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('synthetic export for A');
    fireEvent.click(screen.getByLabelText('General taste'));
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('synthetic export for A')).toBeNull();
    expect(port.submit).not.toHaveBeenCalled();
  });

  it('hides a previously loaded snapshot if the refresh after a submit fails', async () => {
    let reads = 0;
    const port = client(async () => {
      if (reads++ > 0) throw new Error('synthetic read failure');
      return empty();
    });
    render(<TastePanel client={port} subject={subject} projectId={A} />);
    await screen.findByText('Project profile');
    fireEvent.click(screen.getByRole('radio', { name: 'Overall: 4, Like' }));
    await screen.findByText('Taste is unavailable right now.');
    expect(screen.queryByText('Project profile')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    await waitFor(() => expect(port.submit).toHaveBeenCalledTimes(1));
  });

  it('blocks export as well as ratings when the journal is corrupt', async () => {
    const snapshot = empty();
    const failed: TasteSnapshot = { ...snapshot,
      journal: { state: 'fail-closed', reason: 'incomplete-tail', verifiedRecords: 0, line: 1, head: snapshot.general.journalHead } };
    const port = client(async () => failed);
    render(<TastePanel client={port} subject={subject} projectId={A} />);
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
    expect(port.exportProfile).not.toHaveBeenCalled();
  });

  it('describes a failed acknowledgement as unknown and retries only after an explicit click', async () => {
    const port = client(async () => empty());
    const submit = vi.fn<TasteClientPort['submit']>(async () => ({ status: 'fail-closed', reason: 'sync-failed' }));
    render(<TastePanel client={{ ...port, submit }} subject={subject} projectId={A} />);
    await screen.findByText('Project profile');
    fireEvent.click(screen.getByRole('radio', { name: 'Overall: 4, Like' }));
    await screen.findByText('The save may or may not have reached the journal. Retrying sends the same entry and cannot duplicate it.');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Nothing was saved/)).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
  });
});
