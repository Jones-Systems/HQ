// @vitest-environment happy-dom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { DesignWorkspaceContext } from '../workspace-context.tsx';
import { withSectionErrorBoundary } from '../views/SectionErrorBoundary.tsx';
import { AnnotationsView } from '../views/AnnotationsView.tsx';

const props: DesignSectionProps = {
  context: { id: 'core-recovery-fixture', name: 'Recovery example' }, appearance: 'light', sectionId: 'annotations',
  state: { read: () => undefined, write: () => true }, navigate: () => undefined,
  proposeProjectSwitch: () => undefined, onCommand: () => () => undefined,
  surface: (kind) => ({ 'data-hqd-surface': kind, style: { colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal',
    opacity: 1, isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent' } }),
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('Try again invalidates the active project before remounting its failed section', async () => {
  const original = createDesignWorkspace(null);
  original.activeProject.set({ id: 'active-recovery-project', name: 'Active example' });
  let failed = true;
  const retry = vi.fn(() => { failed = false; });
  const View = withSectionErrorBoundary(() => { if (failed) throw new Error('Synthetic load failure'); return <p>Recovered section</p>; });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<DesignWorkspaceContext.Provider value={{ ...original, retry }}><View {...props} /></DesignWorkspaceContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Recovered section');
  expect(retry).toHaveBeenCalledExactlyOnceWith('active-recovery-project');
});

it('Annotations offers the session choices and pins the selected version', async () => {
  const workspace = createDesignWorkspace(null);
  const revision = workspace.contentEvents.revision(props.context.id);
  const pending = workspace.annotationSessionFor(props.context);
  expect(workspace.annotationSessionFor(props.context, { revision })).toBe(pending);
  const initial = await pending;
  expect(initial).not.toBeNull();
  await act(async () => {
    render(<DesignWorkspaceContext.Provider value={workspace}><Suspense fallback={<p>Loading annotations</p>}>
      <AnnotationsView {...props} />
    </Suspense></DesignWorkspaceContext.Provider>);
  });
  const picker = await screen.findByRole('combobox', { name: 'Annotation version' });
  expect(Array.from(picker.querySelectorAll('option'), (option) => ({ id: option.value, label: option.textContent })))
    .toEqual(initial!.choices.map((choice) => ({ id: choice.id, label: `${choice.view ? `${choice.view} · ` : ''}${choice.label}` })));
  expect((picker as HTMLSelectElement).value).toBe(initial!.target.version);
  const next = initial!.choices.find((choice) => choice.id !== initial!.target.version)!;
  await act(async () => { fireEvent.change(picker, { target: { value: next.id } }); });
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Annotation version' }) as HTMLSelectElement).value).toBe(next.id));
  expect(screen.getByText(`pinned to ${next.id}`)).toBeTruthy();
  expect((await workspace.annotationSessionFor(props.context, { selection: next.id }))!.target.version).toBe(next.id);
});
