import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { REFERENCE_STATUSES, type ReferencePort, type ReferenceResolution } from '@hq/ui';
import { HQ_REFERENCES_FEATURE, useWorkState, type Item } from '../../core';
import { CardDetail } from '../../detail';
import { WorkToasts } from '../../board/WorkToasts';
import { setup, fixedNow, NOW, item, writes } from '../../board/test/fixtures';
import { envelope } from './fixtures';
import { createEditor } from '../../detail/edits';
import { WorkModule } from '../../index';
import { resetWorkSessions, setWorkSessionPort } from '../../nav/session';
import { Host, syntheticLayout, columnX, belowCard } from '../../board/test/host';

afterEach(() => { cleanup(); resetWorkSessions(); setWorkSessionPort(null); vi.restoreAllMocks(); });
type Env = Awaited<ReturnType<typeof setup>>;
const source = (references: Item['references'] = []) => item('source', 'Synthetic source', 'inbox', 1, { references });
const linked = () => [{ id: 'ref-0001', kind: 'hq' as const, label: envelope.title, target: envelope }];
function port(resolution: Partial<ReferenceResolution> = {}): ReferencePort {
  return {
    find: vi.fn().mockResolvedValue([envelope]),
    resolve: vi.fn().mockResolvedValue({ status: 'available', observedAt: NOW, latestTitle: envelope.title, latestRevision: '1', ...resolution }),
    open: vi.fn(),
  };
}
function DetailHost({ env, references }: { env: Env; references: ReferencePort }) {
  const state = useWorkState(env.store, { pollMs: 1e9 });
  return <><CardDetail store={env.store} state={state} feedback={env.feedback} detail={env.detail} itemId="source"
    projectId={envelope.projectId} references={references} onClose={() => {}} now={fixedNow} />
    <WorkToasts store={env.store} state={state} feedback={env.feedback} /></>;
}
const click = async (name: string | RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
async function addByPaste(target = envelope) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Paste reference JSON' }), { target: { value: JSON.stringify(target) } });
  await click('Add reference');
}
const noExecution = (env: Env) => expect(env.calls.every((call) => ['snapshot', 'version', 'history', 'patch', 'move'].includes(call.method))).toBe(true);

describe('synthetic source Links integration', () => {
  it('searches, links at the confirmed revision, opens only through the reference port, and undoes creation', async () => {
    const env = await setup({ items: [source()], features: [HQ_REFERENCES_FEATURE] });
    const references = port();
    render(<DetailHost env={env} references={references} />);
    await click('Link to…');
    await screen.findByRole('option', { name: /Sort the seed packets/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Search references' }), { target: { value: 'seed' } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: /Sort the seed packets/ })); });
    expect(references.find).toHaveBeenLastCalledWith('seed', { projectId: envelope.projectId, limit: 30 });
    expect(writes(env.calls)[0]!.args.slice(0, 2)).toEqual(['source', 1]);
    expect(env.byId('source').references[0]).toMatchObject({ kind: 'hq', target: envelope });
    await click(`Open ${envelope.title}`);
    expect(references.open).toHaveBeenCalledWith(envelope, { label: 'Synthetic source', to: { domain: 'work', destination: 'item/source' } });
    await click('Undo');
    expect(env.byId('source').references).toEqual([]);
    expect(writes(env.calls).map((c) => c.args[1])).toEqual([1, 2]);
    noExecution(env);
  });
  it('unlinks and offers revision-guarded Undo without touching the target', async () => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={env} references={port()} />);
    await click(`Unlink ${envelope.title}`);
    expect(env.byId('source').references).toEqual([]);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!); });
    expect(env.byId('source').references).toEqual(linked());
    expect(writes(env.calls).map((call) => call.args.slice(0, 2))).toEqual([['source', 1], ['source', 2]]);
    noExecution(env);
  });
  it('leaves snapshots unchanged until Update snapshot, then supports Undo', async () => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={env} references={port({ status: 'changed', latestTitle: 'New snapshot', latestRevision: '2' })} />);
    await screen.findByText('Changed');
    expect(writes(env.calls)).toEqual([]);
    expect(env.byId('source').references).toEqual(linked());
    await click(`Update snapshot ${envelope.title}`);
    expect(env.byId('source').references[0]).toMatchObject({ target: { title: 'New snapshot', sourceRevision: '2' } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!); });
    expect(env.byId('source').references).toEqual(linked());
    noExecution(env);
  });
  it('rejects duplicate, malformed and other-project paste and drop; shares the 30-link limit with ordinary links', async () => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={env} references={port()} />);
    await addByPaste();
    expect(screen.getByText('This reference is already linked.')).toBeTruthy();
    await addByPaste({ ...envelope, projectId: 'other' });
    expect(screen.getByText('Choose a valid reference in this project.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste reference JSON' }), { target: { value: '{' } });
    await click('Add reference');
    expect(screen.getByText('Invalid reference JSON.')).toBeTruthy();
    await act(async () => { fireEvent.drop(screen.getByRole('textbox', { name: 'Paste reference JSON' }), {
      dataTransfer: { getData: () => JSON.stringify({ ...envelope, entityId: 'second' }) },
    }); });
    expect(env.byId('source').references).toHaveLength(2);
    cleanup();
    const full = await setup({ items: [source(Array.from({ length: 30 }, (_, i) => ({ id: `web-ref-${i}`, kind: 'url', label: 'Web', url: 'https://example.org' })))], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={full} references={port()} />);
    expect((screen.getByRole('button', { name: 'Link to…' }) as HTMLButtonElement).disabled).toBe(true);
    await addByPaste();
    expect(writes(full.calls)).toEqual([]);
    noExecution(env);
  });
  it('does not create or remove HQ links without the persistence capability', async () => {
    const env = await setup({ items: [source(linked())] });
    render(<DetailHost env={env} references={port()} />);
    expect(screen.queryByRole('button', { name: 'Link to…' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unlink / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Update snapshot / })).toBeNull();
    expect(screen.getByText(/does not advertise hq-references-v1/)).toBeTruthy();
    expect(writes(env.calls)).toEqual([]);
  });
  it('uses the card conflict UI, keeps their changes on Use theirs, and explicitly applies Keep mine at the new revision', async () => {
    const env = await setup({ items: [source()], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={env} references={port()} />);
    const theirs = [{ id: 'other-ref', kind: 'url' as const, label: 'Other device', url: 'https://example.org' }];
    await env.device.patch('source', 1, { references: theirs }, env.otherRid());
    await addByPaste();
    expect(screen.getAllByText(/Changed elsewhere/).length).toBeGreaterThan(0);
    expect(env.byId('source').references).toEqual(theirs);
    await click('Use theirs');
    expect(writes(env.calls)).toHaveLength(1);
    await env.device.patch('source', 2, { references: [] }, env.otherRid());
    await addByPaste();
    await click('Keep mine');
    expect(env.byId('source').references).toHaveLength(2);
    expect(writes(env.calls).map((call) => call.args[1])).toEqual([1, 2, 3]);
    noExecution(env);
  });
  it('detects a refreshed reference base before dispatch and refuses Undo over a later reference edit', async () => {
    const env = await setup({ items: [source()], features: [HQ_REFERENCES_FEATURE] });
    const editor = createEditor(env.store, env.feedback, env.detail, 'source');
    await env.device.patch('source', 1, { references: linked() }, env.otherRid());
    await env.store.poll();
    expect(await editor.save({ references: [] }, { base: { references: [] } })).toMatchObject({ status: 'failed', error: { kind: 'revision_conflict' } });
    expect(writes(env.calls)).toEqual([]);
    const result = await editor.save({ references: [] });
    if (result.status !== 'saved') throw new Error('Expected saved');
    await env.device.patch('source', 3, { references: linked() }, env.otherRid());
    expect(await env.store.undoEntry(result.undoId!)).toMatchObject({ status: 'refused' });
    expect(env.fixture.control.stored()[0]!.references).toEqual(linked());
  });
  it.each(REFERENCE_STATUSES)('renders %s with observation and freshness truthfully', async (status) => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    render(<DetailHost env={env} references={port({ status })} />);
    await act(async () => { await Promise.resolve(); });
    const chip = document.querySelector(`[data-reference-status="${status}"]`)!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('Fresh');
    expect(chip.querySelector('time')!.dateTime).toBe(NOW);
    if (['unknown', 'unavailable', 'missing', 'forbidden'].includes(status)) {
      expect((within(chip as HTMLElement).getByRole('button', { name: /^Open / }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(writes(env.calls)).toEqual([]);
  });
  it('never calls stale or unresolved references available, and makes project mismatches read-only', async () => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    const references = port({ observedAt: '2020-01-01T00:00:00Z' });
    const view = render(<DetailHost env={env} references={references} />);
    expect(screen.getByText('Unknown')).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Available')).toBeNull();
    expect(screen.getByText(/Stale/)).toBeTruthy();
    const moved = port({ status: 'moved', targetProjectId: 'other-project' });
    view.rerender(<DetailHost env={env} references={moved} />);
    await screen.findByText('Read-only project context: other-project');
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unlink / })).toBeNull();
    expect(writes(env.calls)).toEqual([]);
    expect(moved.open).not.toHaveBeenCalled();
  });
  it('retains pending/unknown write recovery and never blindly retries a link mutation', async () => {
    const env = await setup({ items: [source()], features: [HQ_REFERENCES_FEATURE] });
    env.faults.next('lose-response');
    render(<DetailHost env={env} references={port()} />);
    await addByPaste();
    expect(env.store.getState().unconfirmed).toHaveLength(1);
    expect(writes(env.calls)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Link to…' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('optional module mount renders return context informationally with zero navigation or execution', async () => {
    const env = await setup({ items: [source()], features: [HQ_REFERENCES_FEATURE] });
    setWorkSessionPort(env.fixture.port);
    const navigate = vi.fn(); const references = port();
    render(<WorkModule context={{ id: envelope.projectId, name: 'Synthetic' }} destination="item/source" appearance="light"
      desktop={{ platform: 'browser', versions: { electron: null } }} navigate={navigate} references={references}
      returnContext={{ label: 'Synthetic draft', to: { domain: 'social', destination: 'draft/example' } }} />);
    await screen.findByText('From Synthetic draft · social · draft/example');
    expect(navigate).not.toHaveBeenCalled(); expect(references.open).not.toHaveBeenCalled();
    noExecution(env);
  });
  it('dragging a linked card performs only a revision-guarded Planner move and preserves envelopes', async () => {
    const env = await setup({ items: [source(linked())], features: [HQ_REFERENCES_FEATURE] });
    syntheticLayout();
    render(<Host store={env.store} feedback={env.feedback} detail={env.detail} />);
    const card = document.querySelector('[data-card-id="source"]')!;
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: columnX('inbox'), clientY: 120 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: columnX('next'), clientY: belowCard(-1) });
    await act(async () => { fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: columnX('next'), clientY: belowCard(-1) }); });
    expect(env.byId('source').status).toBe('next');
    expect(env.byId('source').references).toEqual(linked());
    expect(writes(env.calls).map((call) => call.method)).toEqual(['move']);
    noExecution(env);
  });
});
