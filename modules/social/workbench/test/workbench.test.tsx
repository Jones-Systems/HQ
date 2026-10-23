import { useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_IDS, recordCalls, resetSocialSessions, type RecordedPort, type ToolId } from '../../core';
import { TOOL_GUIDES } from '../catalog';
import { createWorkbenchFixture, WORKBENCH_EXAMPLES, type WorkbenchFixture } from '../fixtures/examples';
import type { Visibility } from '../polling';
import { WorkbenchSection } from '../WorkbenchSection';

const CONTEXT = { id: 'fixture-project', name: 'Fixture project' };

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
  readonly unmount: () => void;
}

function setup({ destination = 'workbenches', features, visible = true, delay }: { destination?: string; features?: string[]; visible?: boolean; delay?: () => Promise<void> } = {}): Setup {
  const fixture = createWorkbenchFixture({ ...(features ? { features } : {}), ...(delay ? { delay } : {}) });
  const recorded = recordCalls(fixture.port);
  const visibleControl = visibilityControl(visible);
  let current = destination;
  let go: (next: string) => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    current = where;
    go = (next) => act(() => setWhere(next));
    return <WorkbenchSection port={recorded.port} context={CONTEXT} destination={where} navigate={(next) => setWhere(next)} visibility={visibleControl.visibility} pollIntervalMs={10} />;
  }
  const view = render(<Shell />);
  return { fixture, recorded, user: userEvent.setup(), destination: () => current, go: (next) => go(next), visible: visibleControl, unmount: view.unmount };
}

const executions = (recorded: RecordedPort) => recorded.callsOf('execution');

async function openTool(s: Setup, tool: ToolId) {
  s.go(`workbenches/${tool}`);
  await screen.findByRole('heading', { level: 1, name: (await toolName(s, tool)) });
}

async function toolName(s: Setup, tool: ToolId): Promise<string> {
  return (await s.fixture.port.snapshot()).tools.find((item) => item.id === tool)!.name;
}

async function loadExample(s: Setup) {
  await s.user.click(screen.getByRole('button', { name: 'Load example' }));
  await screen.findByText('Example data');
}

async function clickRun(s: Setup, tool: ToolId) {
  await s.user.click(screen.getByRole('button', { name: `Run ${await toolName(s, tool)}` }));
}

describe('workbench catalog and navigation', () => {
  it('groups the eight delivered tools by category and states each delivered limit', async () => {
    setup();
    for (const category of ['Discover', 'Create', 'Measure', 'Plan', 'Connect']) expect(await screen.findByRole('heading', { level: 2, name: category })).toBeTruthy();
    const cards = screen.getAllByRole('listitem').filter((item) => item.classList.contains('sw-card'));
    expect(cards).toHaveLength(8);
    for (const tool of TOOL_IDS) expect(screen.getByText(TOOL_GUIDES[tool].limit)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/No account connection, posting, live collection or scheduling/u);
  });

  it('navigation, examples, form edits, mode switches, file import and receipts make zero execution calls', async () => {
    const s = setup();
    await screen.findByRole('heading', { level: 2, name: 'Discover' });
    for (const tool of TOOL_IDS) {
      await s.user.click(screen.getByRole('button', { name: `Open ${await toolName(s, tool)}` }));
      expect(s.destination()).toBe(`workbenches/${tool}`);
      await loadExample(s);
      expect(screen.getByText(TOOL_GUIDES[tool].limit)).toBeTruthy();
      await s.user.click(screen.getByRole('tab', { name: 'Advanced JSON' }));
      expect(JSON.parse((screen.getByLabelText('Native input object') as HTMLTextAreaElement).value)).toStrictEqual(WORKBENCH_EXAMPLES[tool]);
      await s.user.click(screen.getByRole('tab', { name: /^Form/u }));
      s.go('workbenches');
      await screen.findByRole('heading', { level: 2, name: 'Discover' });
    }
    await openTool(s, 'x-studio');
    await s.user.type(screen.getByLabelText('Rough notes'), 'Typing never runs anything');
    await openTool(s, 'creator-relationships');
    const batchText = JSON.stringify({ account_id: 'a', creators: [] });
    await s.user.upload(screen.getByLabelText('Creator batch', { selector: 'input' }), new File([batchText], 'batch.json', { type: 'application/json' }));
    await screen.findByText(`batch.json · ${batchText.length} bytes`);
    s.go('runs');
    await screen.findByRole('table');
    await s.user.click(screen.getAllByRole('button', { name: /^Open receipt/u })[0]!);
    await screen.findByText(/^Run receipt/u);

    expect(executions(s.recorded)).toHaveLength(0);
    expect(s.recorded.callsOf('read').length).toBeGreaterThan(0);
  });

  it('keeps form input across a module remount without calling the service', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await s.user.type(await screen.findByLabelText('Rough notes'), 'Half-written notes');
    s.unmount();
    setup({ destination: 'workbenches/x-studio' });
    expect(((await screen.findByLabelText('Rough notes')) as HTMLTextAreaElement).value).toBe('Half-written notes');
  });
});

describe('explicit Run', () => {
  it.each(TOOL_IDS)('%s: one Run submits once with the exact example input, and its result renders', async (tool) => {
    const s = setup({ destination: `workbenches/${tool}` });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    await clickRun(s, tool);
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    const call = executions(s.recorded)[0]!;
    expect(call.method).toBe('submitRun');
    expect(call.args).toStrictEqual([tool, WORKBENCH_EXAMPLES[tool], true]);
    const runId = s.fixture.controls.inspect().runs.at(-1)!.id;
    await screen.findByText('Queued');
    act(() => { s.fixture.settle(runId); });
    await screen.findByText('Succeeded', {}, { timeout: 2000 });
    expect(screen.getByLabelText('Result summary')).toBeTruthy();
    expect(screen.getByText('Raw result JSON')).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('submits form-built input for the simple-field tools exactly as entered', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await s.user.type(await screen.findByLabelText('Rough notes'), 'Cupping hour');
    await s.user.selectOptions(screen.getByLabelText('Format'), 'thread');
    await s.user.type(screen.getByLabelText(/^Audience/u), 'Tea clubs');
    await clickRun(s, 'x-studio');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    expect(executions(s.recorded)[0]!.args).toStrictEqual(['x-studio', { notes: 'Cupping hour', format: 'thread', audience: 'Tea clubs' }, false]);

    await openTool(s, 'social-publisher');
    await s.user.type(screen.getByLabelText('Caption'), 'Three steeping times');
    await clickRun(s, 'social-publisher');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(2));
    expect(executions(s.recorded)[1]!.args).toStrictEqual(['social-publisher', { caption: 'Three steeping times', format: 'text' }, false]);

    await openTool(s, 'x-intelligence');
    await s.user.type(screen.getByLabelText('Topic name'), 'Tea');
    await s.user.type(screen.getByLabelText('Matching terms'), 'oolong{Enter}steeping,');
    await s.user.click(screen.getByRole('button', { name: 'Add item' }));
    await s.user.type(screen.getByLabelText('Text'), 'A fictional observation');
    await clickRun(s, 'x-intelligence');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(3));
    expect(executions(s.recorded)[2]!.args).toStrictEqual(['x-intelligence', { topic: 'Tea', terms: ['oolong', 'steeping'], items: [{ id: 'item-1', content_text: 'A fictional observation' }] }, false]);
  });

  it('builds structured input from typed file imports with a shape preview', async () => {
    const s = setup({ destination: 'workbenches/tiktok-intelligence' });
    const json = (value: unknown, name: string) => new File([JSON.stringify(value)], name, { type: 'application/json' });
    await s.user.upload(await screen.findByLabelText('Niche definition', { selector: 'input' }), json({ name: 'Niche' }, 'niche.json'));
    await s.user.upload(screen.getByLabelText('Batch 1 manifest', { selector: 'input' }), json({ batch_id: 'b1' }, 'manifest.json'));
    await s.user.upload(screen.getByLabelText('Batch 1 records', { selector: 'input' }), json([{ post: 1 }, { post: 2 }], 'records.json'));
    expect(await screen.findByText('2 records')).toBeTruthy();
    expect(screen.getByText('Object · 1 key (name)')).toBeTruthy();
    const asOf = screen.getByLabelText('Data as of');
    await s.user.clear(asOf);
    await s.user.type(asOf, '2026-10-01T12:00:00Z');
    expect(executions(s.recorded)).toHaveLength(0);
    await clickRun(s, 'tiktok-intelligence');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    expect(executions(s.recorded)[0]!.args).toStrictEqual(['tiktok-intelligence', { niche: { name: 'Niche' }, as_of: '2026-10-01T12:00:00Z', batches: [{ manifest: { batch_id: 'b1' }, records: [{ post: 1 }, { post: 2 }] }] }, false]);

    await openTool(s, 'search-visibility');
    await s.user.upload(screen.getByLabelText('Answer observations', { selector: 'input' }), new File(['{"q":1}\n{"q":2}\n'], 'answers.jsonl'));
    expect(await screen.findByText('2 observations')).toBeTruthy();
    await s.user.upload(screen.getByLabelText('Query panel', { selector: 'input' }), new File(['{ broken'], 'panel.json'));
    expect(await screen.findByText(/^panel\.json: Not valid JSON/u)).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('a blocked Run makes no call and moves focus to the problem summary', async () => {
    const s = setup({ destination: 'workbenches/creator-relationships' });
    await screen.findByRole('heading', { level: 1 });
    await clickRun(s, 'creator-relationships');
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toMatch(/Import the creator batch file/u);
    await waitFor(() => expect(document.activeElement).toBe(summary));
    await s.user.click(within(summary).getByRole('button', { name: 'Add at least one niche topic.' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Niche topics'));
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('marks an edited example as supplied input, not an example run', async () => {
    const s = setup({ destination: 'workbenches/social-publisher' });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    await s.user.type(screen.getByLabelText('Caption'), '!');
    expect(screen.getByText('Edited example')).toBeTruthy();
    await clickRun(s, 'social-publisher');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    expect(executions(s.recorded)[0]!.args).toStrictEqual(['social-publisher', { caption: `${WORKBENCH_EXAMPLES['social-publisher'].caption as string}!`, format: 'text' }, false]);
  });

  it('a lost response renders unknown with possible matches and never resubmits', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    s.fixture.controls.loseNextSubmitResponse();
    await clickRun(s, 'x-studio');
    expect(await screen.findByText('Outcome unknown')).toBeTruthy();
    const created = s.fixture.controls.inspect().runs.at(-1)!;
    const matches = await screen.findByRole('region', { name: 'Possible matches' });
    expect(await within(matches).findByRole('button', { name: `Open receipt ${created.id.slice(-8)}` })).toBeTruthy();
    // The seeded queued Writing studio run is not new, so it is not offered as a match.
    expect(within(matches).getAllByRole('button', { name: /^Open receipt/u })).toHaveLength(1);
    expect(screen.queryByText('Succeeded')).toBeNull();
    expect(executions(s.recorded)).toHaveLength(1);

    await s.user.click(within(matches).getByRole('button', { name: 'Check run history again' }));
    s.go('workbenches');
    await openTool(s, 'x-studio');
    expect(await screen.findByText('Outcome unknown')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(executions(s.recorded)).toHaveLength(1);

    await s.user.click(screen.getByRole('button', { name: 'Run again…' }));
    const dialog = await screen.findByRole('alertdialog');
    await s.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(executions(s.recorded)).toHaveLength(1);
    await s.user.click(screen.getByRole('button', { name: 'Run again…' }));
    await s.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(2));
  });

  it('a definite rejection is shown as not run, without a retry', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    s.fixture.controls.failNext('submitRun', { kind: 'conflict', message: 'Run queue is full. Wait for a run to finish.' });
    await clickRun(s, 'x-studio');
    expect(await screen.findByText('Run queue is full. Wait for a run to finish.')).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('pauses runs with a reason while the service is unreachable', async () => {
    const fixture = createWorkbenchFixture();
    fixture.controls.setUnavailable(true);
    const recorded = recordCalls(fixture.port);
    render(<WorkbenchSection port={recorded.port} context={CONTEXT} destination="workbenches/x-studio" navigate={() => {}} />);
    expect(await screen.findByText('Social service unreachable')).toBeTruthy();
    const run = screen.getByRole('button', { name: 'Run x-studio' }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText('Runs pause while the Social service is unreachable.')).toBeTruthy();
    expect(recorded.callsOf('execution')).toHaveLength(0);
  });
});

describe('run history and polling', () => {
  it('lists statuses, times, errors and example labels; active runs read only while visible', async () => {
    const s = setup({ destination: 'runs', visible: false });
    const table = await screen.findByRole('table');
    for (const label of ['Queued', 'Running', 'Succeeded', 'Failed', 'Interrupted']) expect(within(table).getByText(label)).toBeTruthy();
    expect(within(table).getByText('Example data')).toBeTruthy();
    expect(within(table).getByText('Service restarted before completion; run again explicitly.')).toBeTruthy();

    const running = s.fixture.controls.inspect().runs.find((run) => run.status === 'running')!;
    s.go(`runs/${running.id}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const reads = () => s.recorded.calls().filter((call) => call.method === 'run').length;
    expect(reads()).toBe(0);
    s.visible.set(true);
    await waitFor(() => expect(reads()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(reads()).toBeGreaterThan(1);
    act(() => { s.fixture.settle(running.id); });
    const receipt = await screen.findByRole('article');
    await within(receipt).findByText('Succeeded');
    const settled = reads();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads()).toBe(settled);
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('shows runs last seen active as Unknown when the service stops answering', async () => {
    const s = setup({ destination: 'runs' });
    await screen.findByRole('table');
    s.fixture.controls.setUnavailable(true);
    await s.user.click(screen.getByRole('button', { name: 'Refresh' }));
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByText('Unknown')).toHaveLength(2));
    expect(within(table).getAllByText(/Don't start it again until the status is known/u)).toHaveLength(2);
  });
});

describe('Start draft from a result', () => {
  async function finishedStudioRun(s: Setup) {
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    await clickRun(s, 'x-studio');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    const runId = s.fixture.controls.inspect().runs.at(-1)!.id;
    act(() => { s.fixture.settle(runId); });
    await screen.findByText('Succeeded', {}, { timeout: 2000 });
    return runId;
  }

  it('saves one draft whose citation is persisted under hq-references-v1', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    const runId = await finishedStudioRun(s);
    const before = s.fixture.controls.inspect().content.length;
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(screen.getByText('Unsaved draft')).toBeTruthy();
    expect(screen.getByText('Will be saved with the draft')).toBeTruthy();
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toHaveLength(0);
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(await screen.findByText('Saved with the draft')).toBeTruthy();
    const saves = s.recorded.calls().filter((call) => call.method === 'saveDraft');
    expect(saves).toHaveLength(1);
    const content = s.fixture.controls.inspect().content;
    expect(content).toHaveLength(before + 1);
    const draft = content.at(-1)!;
    expect(draft.links).toEqual([expect.objectContaining({ kind: 'run', entityId: runId, domain: 'social', projectId: CONTEXT.id })]);
    await s.user.click(screen.getByRole('button', { name: 'Open in library' }));
    expect(s.destination()).toBe(`library/${draft.id}`);
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('shows an unknown save with Check and blocks saving again until the check says it did not happen', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await finishedStudioRun(s);
    const before = s.fixture.controls.inspect().content.length;
    const saves = () => s.recorded.calls().filter((call) => call.method === 'saveDraft');
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    s.fixture.controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: '2026-10-20T12:00:00Z' });
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(await screen.findByText('Save result unknown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(saves()).toHaveLength(1);
    await s.user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/the save did not happen/u)).toBeTruthy();
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    await screen.findByText('Draft in library');
    expect(saves()).toHaveLength(2);
    expect(s.fixture.controls.inspect().content).toHaveLength(before + 1);
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('keeps Discard unavailable while the first save is in flight', async () => {
    let release: () => void = () => undefined;
    let gate: Promise<void> = Promise.resolve();
    const s = setup({ destination: 'workbenches/x-studio', delay: () => gate });
    await finishedStudioRun(s);
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    gate = new Promise((resolve) => { release = resolve; });
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(await screen.findByText('Saving…', { selector: '[role="status"]' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => release());
    await screen.findByText('Draft in library');
  });

  it('without hq-references-v1 the citation is shown as not saved and never silently dropped', async () => {
    const s = setup({ destination: 'workbenches/x-studio', features: [] });
    await finishedStudioRun(s);
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(screen.getByText('Not saved — needs Social service support')).toBeTruthy();
    await s.user.click(screen.getByRole('button', { name: 'Save to library' }));
    await screen.findByText('Draft in library');
    expect(screen.getByText('Not saved — needs Social service support')).toBeTruthy();
    expect(screen.getByText('Citation details')).toBeTruthy();
    const draft = s.fixture.controls.inspect().content.at(-1)!;
    expect('links' in draft).toBe(false);
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toHaveLength(1);
    expect(executions(s.recorded)).toHaveLength(1);
  });
});
