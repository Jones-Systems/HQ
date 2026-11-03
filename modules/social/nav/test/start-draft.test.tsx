import { useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModulePort } from '@hq/contracts';
import { FIXTURE_PROJECT_ID, recordCalls, resetSocialSessions, socialSession, type RecordedPort } from '../../core';
import { createWorkbenchFixture, type WorkbenchFixture } from '../../workbench/fixtures/examples';
import { SocialDomain } from '..';

/**
 * Start draft end to end: a finished workbench run, the Library's composer prefilled from it, and what stays unsaved.
 * The workbench and the Library are mounted together in the domain, as the shell mounts them.
 */

const NOW = () => new Date('2026-10-20T12:00:00Z');
const CONTEXT = { id: FIXTURE_PROJECT_ID, name: 'Larkspur project' };

afterEach(() => {
  cleanup();
  resetSocialSessions();
  localStorage.removeItem('hq.social.sidebar.v1');
});

interface Setup {
  readonly fixture: WorkbenchFixture;
  readonly recorded: RecordedPort;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly destination: () => string;
  readonly go: (destination: string) => void;
}

function setup({ destination, features }: { destination: string; features?: string[] }): Setup {
  const fixture = createWorkbenchFixture({ ...(features ? { features } : {}), clock: NOW });
  const recorded = recordCalls(fixture.port);
  let current = destination;
  let go: (next: string) => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    current = where;
    go = (next) => act(() => setWhere(next));
    const port: ModulePort = {
      context: CONTEXT, destination: where, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: setWhere,
    };
    return <SocialDomain {...port} port={recorded.port} example now={NOW} />;
  }
  render(<Shell />);
  return { fixture, recorded, user: userEvent.setup(), destination: () => current, go: (next) => go(next) };
}

const effects = (s: Setup) => s.recorded.calls().filter((call) => call.class === 'execution' || (call.class === 'content' && call.method !== 'snapshot'));
const executions = (s: Setup) => s.recorded.callsOf('execution');
const saves = (s: Setup) => s.recorded.calls().filter((call) => call.method === 'saveDraft');

async function finishedStudioRun(s: Setup) {
  await screen.findByRole('heading', { level: 1, name: 'Writing studio' });
  await s.user.click(screen.getByRole('button', { name: 'Load example' }));
  await screen.findByText('Example data');
  await s.user.click(screen.getByRole('button', { name: 'Run Writing studio' }));
  await waitFor(() => expect(executions(s)).toHaveLength(1));
  const runId = s.fixture.controls.inspect().runs.at(-1)!.id;
  act(() => { s.fixture.settle(runId); });
  await screen.findByText('Succeeded', {}, { timeout: 4000 });
  return runId;
}

describe('Start draft from a workbench result into the Library', () => {
  it('lands in the Library composer, prefilled, showing its source run, unsaved, with nothing sent', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    const runId = await finishedStudioRun(s);
    const before = s.fixture.controls.inspect().content.length;

    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(s.destination()).toBe('library/new');

    const composer = await screen.findByRole('region', { name: 'New draft' });
    const origin = within(composer).getByRole('group', { name: 'Where this draft came from' });
    expect(origin.textContent).toContain('From run · Writing studio · 20 Oct 2026');
    expect(origin.textContent).toContain('Built from example data');
    expect(within(origin).getByText('Example data')).toBeTruthy();
    expect(origin.textContent).toMatch(/saved with the draft when you save/u);

    // Prefilled from the result, in the example's own words.
    const title = within(composer).getByLabelText('Title') as HTMLInputElement;
    const body = within(composer).getByLabelText('Body') as HTMLTextAreaElement;
    expect(title.value).toMatch(/^EXAMPLE — /u);
    expect(body.value.length).toBeGreaterThan(0);
    const editor = socialSession(CONTEXT.id).getState().editors.new!;
    expect(editor.base).toBeNull();
    expect(editor.fields.links).toEqual([expect.objectContaining({ kind: 'run', entityId: runId, domain: 'social', projectId: CONTEXT.id })]);
    expect(within(composer).getByRole('button', { name: 'Save draft' })).toBeTruthy();
    expect(within(composer).getByRole('button', { name: 'Close' })).toBeTruthy();

    // Unsaved, and nothing but the one explicit Run ever left the workbench.
    expect(saves(s)).toHaveLength(0);
    expect(s.fixture.controls.inspect().content).toHaveLength(before);
    expect(executions(s)).toHaveLength(1);
    expect(effects(s).filter((call) => call.method !== 'submitRun')).toHaveLength(0);
  });

  it('saves only when Save draft is pressed, with the run citation, and the receipt then reads Draft saved', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    const runId = await finishedStudioRun(s);
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    const composer = await screen.findByRole('region', { name: 'New draft' });
    await s.user.click(within(composer).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saves(s)).toHaveLength(1));
    const saved = s.fixture.controls.inspect().content.at(-1)!;
    expect(saved.links).toEqual([expect.objectContaining({ kind: 'run', entityId: runId })]);

    s.go('workbenches/x-studio');
    await screen.findByRole('heading', { level: 1, name: 'Writing studio' });
    // The page remembers the run only through data: a stored draft that cites it.
    s.go(`runs/${runId}`);
    const receipt = await screen.findByRole('article');
    expect(await within(receipt).findByText('Draft saved')).toBeTruthy();
    await s.user.click(within(receipt).getByRole('button', { name: 'Open saved draft' }));
    expect(s.destination()).toBe(`library/${saved.id}`);
    expect(executions(s)).toHaveLength(1);
    expect(saves(s)).toHaveLength(1);
  });

  it('keeps text already in the new-draft composer and offers a choice instead of replacing it', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await finishedStudioRun(s);
    socialSession(CONTEXT.id).openEditor('new', null, { title: 'My own idea', body: 'Written before the run finished', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 });
    await s.user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(s.destination()).toBe('workbenches/x-studio');
    await s.user.click(await screen.findByRole('button', { name: 'Open the unsaved draft' }));
    expect(s.destination()).toBe('library/new');
    const composer = await screen.findByRole('region', { name: 'New draft' });
    expect((within(composer).getByLabelText('Title') as HTMLInputElement).value).toBe('My own idea');
    expect(within(composer).queryByRole('group', { name: 'Where this draft came from' })).toBeNull();
    expect(saves(s)).toHaveLength(0);

    s.go('workbenches/x-studio');
    await s.user.click(await screen.findByRole('button', { name: 'Start draft' }));
    await s.user.click(await screen.findByRole('button', { name: 'Replace it with this result' }));
    expect(s.destination()).toBe('library/new');
    const replaced = await screen.findByRole('region', { name: 'New draft' });
    expect(within(replaced).getByRole('group', { name: 'Where this draft came from' }).textContent).toContain('From run · Writing studio');
    expect(saves(s)).toHaveLength(0);
  });
});
