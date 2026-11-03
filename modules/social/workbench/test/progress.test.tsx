import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastStore } from '@hq/ui';
import { FIXTURE_IDS, resetSocialSessions } from '../../core';
import { WORKBENCH_EXAMPLES } from '../fixtures/examples';
import { RunStepper, runSteps } from '../RunStepper';
import { WAITS_HERE, WAITS_HERE_DETAIL } from '../setup';
import { clickRun, executions, loadExample, setup, toolName, type Setup } from './support';

beforeEach(() => { toastStore.dismiss(); });
afterEach(() => {
  cleanup();
  resetSocialSessions();
  toastStore.dismiss();
  vi.unstubAllGlobals();
});

const stateOf = (list: HTMLElement) => [...list.querySelectorAll('li.sx-step')].map((item) => `${item.getAttribute('data-step')}:${item.getAttribute('data-state') ?? 'pending'}`);
const labelsOf = (list: HTMLElement) => [...list.querySelectorAll('.sx-step-label')].map((item) => item.textContent);

describe('run stepper', () => {
  it('names only what has happened: Finished until the run ends, then Succeeded, Failed, Interrupted or Unknown', () => {
    expect(runSteps('queued').map((step) => [step.label, step.state])).toEqual([['Queued', 'active'], ['Running', 'pending'], ['Finished', 'pending']]);
    expect(runSteps('running').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'active'], ['Finished', 'pending']]);
    expect(runSteps('succeeded').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'done'], ['Succeeded', 'done']]);
    expect(runSteps('failed').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'done'], ['Failed', 'failed']]);
    // A restart interrupts queued and running runs alike, so the stepper does not claim the run had started.
    expect(runSteps('interrupted').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'pending'], ['Interrupted', 'failed']]);
  });

  it('a run last seen active ends in Unknown and never shows an outcome', () => {
    expect(runSteps('unknown', 'queued').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'pending'], ['Unknown', 'unknown']]);
    expect(runSteps('unknown', 'running').map((step) => [step.label, step.state])).toEqual([['Queued', 'done'], ['Running', 'done'], ['Unknown', 'unknown']]);
    render(<RunStepper status="unknown" lastSeen="running" />);
    const list = screen.getByRole('list', { name: 'Run progress' });
    expect(stateOf(list)).toEqual(['queued:done', 'running:done', 'finished:unknown']);
    expect(labelsOf(list)).toEqual(['Queued', 'Running', 'Unknown']);
    expect(list.textContent).not.toMatch(/Succeeded|Failed|Interrupted/u);
  });

  it('marks the active step for assistive technology and spells each state out', () => {
    const view = render(<RunStepper status="running" />);
    const list = screen.getByRole('list', { name: 'Run progress' });
    const active = list.querySelector('[aria-current="step"]')!;
    expect(active.getAttribute('data-step')).toBe('running');
    expect(within(list).getByText('Queued').closest('li')!.textContent).toMatch(/done/u);
    expect(active.textContent).toMatch(/in progress/u);
    view.rerender(<RunStepper status="interrupted" />);
    expect(list.querySelector('[data-outcome="interrupted"]')).not.toBeNull();
    expect(list.querySelector('[aria-current="step"]')).toBeNull();
  });
});

describe('example runs in the example workspace', () => {
  it('an example run walks Queued → Running → Succeeded through normal polling, then shows its labelled results', async () => {
    const s = setup({ destination: 'workbenches/x-intelligence', example: true, pollIntervalMs: 10, simulateExampleRuns: { stepMs: 150 } });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    await clickRun(s, 'x-intelligence');
    const list = await screen.findByRole('list', { name: 'Run progress' });
    expect(stateOf(list)).toEqual(['queued:active', 'running:pending', 'finished:pending']);
    await waitFor(() => expect(stateOf(screen.getByRole('list', { name: 'Run progress' }))).toEqual(['queued:done', 'running:active', 'finished:pending']), { interval: 10, timeout: 2000 });
    await waitFor(() => expect(labelsOf(screen.getByRole('list', { name: 'Run progress' }))).toEqual(['Queued', 'Running', 'Succeeded']), { interval: 10, timeout: 2000 });

    const result = screen.getByRole('region', { name: 'Result summary' });
    expect(within(result).getByRole('heading', { name: '2 evidence records' })).toBeTruthy();
    expect(within(result).getAllByRole('rowheader').map((row) => row.textContent)).toEqual(['A corner shop tries cold-brew oolong', 'Steeping questions at a market stall']);
    // The final count is in the DOM for readers and tests; the count-up is only a CSS presentation of it.
    expect(within(result).getByText('Items').closest('div')!.textContent).toMatch(/2/u);
    const receipt = screen.getByRole('article');
    expect(within(receipt).getByText('Example data')).toBeTruthy();
    expect(screen.queryByText(WAITS_HERE)).toBeNull();
    // One explicit Run, one submission; the stepping was the fixture worker, not a retry.
    expect(executions(s.recorded)).toHaveLength(1);
    expect(s.fixture.controls.inspect().runs.at(-1)!.status).toBe('succeeded');
  });

  it('a run on the user’s own input waits here, says nothing was sent, and offers service setup', async () => {
    const opened = vi.fn();
    window.addEventListener('hq-open-settings', opened);
    try {
      const s = setup({ destination: 'workbenches/x-studio', example: true, pollIntervalMs: 10, simulateExampleRuns: { stepMs: 20 } });
      await s.user.type(await screen.findByLabelText('Rough notes'), 'My own notes about the cupping hour');
      await clickRun(s, 'x-studio');
      const receipt = await screen.findByRole('article');
      expect(within(receipt).getByText(WAITS_HERE)).toBeTruthy();
      expect(within(receipt).getByText(WAITS_HERE_DETAIL)).toBeTruthy();
      expect(WAITS_HERE).toBe('No Social service is set up, so this run waits here.');
      expect(WAITS_HERE_DETAIL).toBe('Nothing was sent.');
      expect(stateOf(within(receipt).getByRole('list', { name: 'Run progress' }))).toEqual(['queued:active', 'running:pending', 'finished:pending']);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(s.fixture.controls.inspect().runs.at(-1)!.status).toBe('queued');
      expect(executions(s.recorded)).toHaveLength(1);

      expect(opened).not.toHaveBeenCalled();
      await s.user.click(within(receipt).getByRole('button', { name: 'Set up Social service' }));
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0]![0] as CustomEvent).detail).toStrictEqual({ source: 'social' });
      expect(executions(s.recorded)).toHaveLength(1);
    } finally {
      window.removeEventListener('hq-open-settings', opened);
    }
  });

  it('outside the example workspace a queued run is not said to wait for setup', async () => {
    const s = setup({ destination: 'workbenches/x-studio', example: false, pollIntervalMs: 10 });
    await s.user.type(await screen.findByLabelText('Rough notes'), 'Notes for a live run');
    await clickRun(s, 'x-studio');
    const receipt = await screen.findByRole('article');
    expect(within(receipt).getByText(/Queued: waiting its turn/u)).toBeTruthy();
    expect(screen.queryByText(WAITS_HERE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set up Social service' })).toBeNull();
  });

  it('says before Run, in the example workspace, that a run on your own input waits here', async () => {
    const s = setup({ destination: 'workbenches/x-studio', example: true });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(new RegExp(`${WAITS_HERE.replace(/\./gu, '\\.')} Load an example`, 'u'))).toBeTruthy();
    await loadExample(s);
    expect(screen.queryByText(/Load an example to see a full run/u)).toBeNull();
  });
});

describe('seeded results', () => {
  it('the seeded succeeded run opens as tiles and a results table, labelled as example data', async () => {
    const s = setup({ destination: `runs/${FIXTURE_IDS.exampleRun}` });
    const receipt = await screen.findByRole('article');
    const result = await within(receipt).findByRole('region', { name: 'Result summary' });
    expect(within(result).getByRole('heading', { name: '2 evidence records' })).toBeTruthy();
    expect(result.querySelectorAll('.sx-tile').length).toBeGreaterThan(0);
    expect(within(result).getByRole('table')).toBeTruthy();
    expect(within(result).getAllByRole('rowheader')).toHaveLength(2);
    expect(within(receipt).getByText('Example data')).toBeTruthy();
    expect(executions(s.recorded)).toHaveLength(0);
  });
});

describe('receipt ID', () => {
  it('shows eight characters with the full ID as its title, and copies the full ID with a Copied toast', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const s = setup({ destination: `runs/${FIXTURE_IDS.exampleRun}` });
    const receipt = await screen.findByRole('article');
    const short = FIXTURE_IDS.exampleRun.slice(-8);
    const code = within(receipt).getByText(short);
    expect(code.tagName).toBe('CODE');
    expect(code.getAttribute('title')).toBe(FIXTURE_IDS.exampleRun);
    expect(short).toHaveLength(8);

    const copy = within(receipt).getByRole('button', { name: `Copy receipt ID ${short}` });
    expect(copy.getAttribute('title')).toContain(FIXTURE_IDS.exampleRun);
    await s.user.click(copy);
    expect(writeText).toHaveBeenCalledWith(FIXTURE_IDS.exampleRun);
    await waitFor(() => expect(toastStore.getSnapshot().map((toast) => toast.title)).toContain('Copied'));
    const toast = toastStore.getSnapshot().find((item) => item.title === 'Copied')!;
    expect(toast.tone).toBe('success');
    expect(toast.meta).toBe(FIXTURE_IDS.exampleRun);
    expect(toast.duration).toBe(8000);
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('says so when the ID could not be copied, and never claims it was', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
    const document_ = document as Document & { execCommand: (command: string) => boolean };
    const exec = vi.spyOn(document_, 'execCommand').mockReturnValue(false);
    try {
      const s = setup({ destination: `runs/${FIXTURE_IDS.exampleRun}` });
      const receipt = await screen.findByRole('article');
      await s.user.click(within(receipt).getByRole('button', { name: /^Copy receipt ID/u }));
      await waitFor(() => expect(toastStore.getSnapshot().some((toast) => toast.tone === 'danger')).toBe(true));
      expect(toastStore.getSnapshot().map((toast) => toast.title)).not.toContain('Copied');
    } finally {
      exec.mockRestore();
    }
  });
});

describe('Ctrl/⌘+Enter', () => {
  async function ready(): Promise<Setup> {
    const s = setup({ destination: 'workbenches/social-publisher' });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    return s;
  }

  it('runs the current tool once, shows the shortcut in the button hint, and is still one explicit submit', async () => {
    const s = await ready();
    const run = screen.getByRole('button', { name: `Run ${await toolName(s, 'social-publisher')}` });
    expect(run.getAttribute('aria-keyshortcuts')).toMatch(/Enter/u);
    expect(document.body.textContent).toMatch(/Ctrl ↵|⌘↵/u);
    expect(executions(s.recorded)).toHaveLength(0);
    await s.user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    expect(executions(s.recorded)[0]!.args).toStrictEqual(['social-publisher', WORKBENCH_EXAMPLES['social-publisher'], true]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('accepts the Meta key too', async () => {
    const s = await ready();
    await s.user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(executions(s.recorded)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(executions(s.recorded)).toHaveLength(1);
  });

  it('does nothing while the form is blocked: it shows the problems and makes no call', async () => {
    const s = setup({ destination: 'workbenches/creator-relationships' });
    await screen.findByRole('heading', { level: 1 });
    await s.user.keyboard('{Control>}{Enter}{/Control}');
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toMatch(/Import the creator batch file/u);
    expect(executions(s.recorded)).toHaveLength(0);
  });

  it('is ignored while a confirmation dialog is open', async () => {
    const s = setup({ destination: 'workbenches/x-studio' });
    await screen.findByRole('heading', { level: 1 });
    await loadExample(s);
    s.fixture.controls.loseNextSubmitResponse();
    await clickRun(s, 'x-studio');
    await screen.findByText('Outcome unknown');
    expect(executions(s.recorded)).toHaveLength(1);
    await s.user.click(screen.getByRole('button', { name: 'Run again…' }));
    const dialog = await screen.findByRole('alertdialog');
    await s.user.keyboard('{Control>}{Enter}{/Control}');
    expect(executions(s.recorded)).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
  });
});

describe('tool rail', () => {
  it('lists the tools by category beside the catalog and every tool page, and choosing one only navigates', async () => {
    const s = setup();
    const rail = await screen.findByRole('navigation', { name: 'Workbenches' });
    expect(within(rail).getAllByRole('group').map((group) => group.getAttribute('aria-labelledby')).length).toBe(5);
    expect(within(rail).getAllByRole('button')).toHaveLength(8);
    expect(within(rail).queryByRole('button', { current: 'page' })).toBeNull();

    await s.user.click(within(rail).getByRole('button', { name: await toolName(s, 'seo-studio') }));
    expect(s.destination()).toBe('workbenches/seo-studio');
    await screen.findByRole('heading', { level: 1, name: await toolName(s, 'seo-studio') });
    const onTool = screen.getByRole('navigation', { name: 'Workbenches' });
    expect(within(onTool).getByRole('button', { current: 'page' }).textContent).toContain(await toolName(s, 'seo-studio'));

    await s.user.click(within(onTool).getByRole('button', { name: await toolName(s, 'reddit-opportunities') }));
    expect(s.destination()).toBe('workbenches/reddit-opportunities');
    await screen.findByRole('heading', { level: 1, name: await toolName(s, 'reddit-opportunities') });
    expect(within(screen.getByRole('navigation', { name: 'Workbenches' })).getByRole('button', { current: 'page' }).textContent).toContain(await toolName(s, 'reddit-opportunities'));
    expect(executions(s.recorded)).toHaveLength(0);
  });
});
