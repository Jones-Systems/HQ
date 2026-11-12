import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recordCalls, type RecordedPort, type ToolId } from '../../core';
import { createWorkbenchFixture, type WorkbenchFixture, type WorkbenchFixtureOptions } from '../fixtures/examples';
import type { Visibility } from '../polling';
import { WorkbenchSection } from '../WorkbenchSection';

export const CONTEXT = { id: 'fixture-project', name: 'Fixture project' };

export function visibilityControl(visible = true) {
  const listeners = new Set<() => void>();
  const visibility: Visibility = { isVisible: () => visible, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  return { visibility, set(value: boolean) { visible = value; act(() => { for (const listener of [...listeners]) listener(); }); } };
}

export interface Setup {
  readonly fixture: WorkbenchFixture;
  readonly recorded: RecordedPort;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly destination: () => string;
  /** Every destination the section asked to navigate to, in order. */
  readonly navigated: readonly string[];
  readonly go: (destination: string) => void;
  readonly visible: ReturnType<typeof visibilityControl>;
  readonly unmount: () => void;
}

export interface SetupOptions {
  readonly destination?: string;
  readonly features?: string[];
  readonly visible?: boolean;
  readonly delay?: () => Promise<void>;
  /** Record navigation without following it, for hand-offs to pages this section does not render (the Library). */
  readonly holdNavigation?: boolean;
  readonly example?: boolean;
  readonly pollIntervalMs?: number;
  readonly simulateExampleRuns?: WorkbenchFixtureOptions['simulateExampleRuns'];
}

export function setup({ destination = 'workbenches', features, visible = true, delay, holdNavigation = false, example, pollIntervalMs = 10, simulateExampleRuns }: SetupOptions = {}): Setup {
  const fixture = createWorkbenchFixture({ ...(features ? { features } : {}), ...(delay ? { delay } : {}), ...(simulateExampleRuns ? { simulateExampleRuns } : {}) });
  const recorded = recordCalls(fixture.port);
  const visibleControl = visibilityControl(visible);
  const navigated: string[] = [];
  let current = destination;
  let go: (next: string) => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    current = where;
    go = (next) => act(() => setWhere(next));
    return (
      <WorkbenchSection
        port={recorded.port} context={CONTEXT} destination={where} visibility={visibleControl.visibility} pollIntervalMs={pollIntervalMs}
        {...(example === undefined ? {} : { example })}
        navigate={(next) => { navigated.push(next); if (!holdNavigation) setWhere(next); }}
      />
    );
  }
  const view = render(<Shell />);
  return { fixture, recorded, user: userEvent.setup(), destination: () => current, navigated, go: (next) => go(next), visible: visibleControl, unmount: view.unmount };
}

export const executions = (recorded: RecordedPort) => recorded.callsOf('execution');

export async function toolName(s: Setup, tool: ToolId): Promise<string> {
  return (await s.fixture.port.snapshot()).tools.find((item) => item.id === tool)!.name;
}

export async function openTool(s: Setup, tool: ToolId) {
  s.go(`workbenches/${tool}`);
  await screen.findByRole('heading', { level: 1, name: (await toolName(s, tool)) });
}

export async function loadExample(s: Setup) {
  await s.user.click(screen.getByRole('button', { name: 'Load example' }));
  await screen.findByText('Example data');
}

export async function clickRun(s: Setup, tool: ToolId) {
  await s.user.click(screen.getByRole('button', { name: `Run ${await toolName(s, tool)}` }));
}
