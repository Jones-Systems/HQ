import { Suspense } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { DesignWorkspaceContext } from '../workspace-context.tsx';
import { ImportsView } from '../views/ImportsView.tsx';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props: DesignSectionProps = {
  context: { id: 'rights-example', name: 'Example' }, appearance: 'light', sectionId: 'imports',
  state: { read: () => undefined, write: () => true }, navigate: () => undefined,
  proposeProjectSwitch: () => undefined, onCommand: () => () => undefined,
  surface: (kind) => ({ 'data-hqd-surface': kind, style: { colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal',
    opacity: 1, isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent' } }),
};

it('requires explicit rights and discards a prepared plan when the statement changes', async () => {
  const workspace = createDesignWorkspace(null);
  await act(async () => { render(<DesignWorkspaceContext.Provider value={workspace}>
    <Suspense fallback={<p>Loading</p>}><ImportsView {...props} /></Suspense>
  </DesignWorkspaceContext.Provider>); });
  const choose = () => screen.getByRole('button', { name: 'Choose files…' }) as HTMLButtonElement;
  expect(choose().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Rights basis'), { target: { value: 'licensed' } });
  fireEvent.change(screen.getByLabelText('Rights holder'), { target: { value: 'Example creator' } });
  expect(choose().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('License (required)'), { target: { value: 'Example license' } });
  expect(choose().disabled).toBe(false);
  fireEvent.click(choose());
  await screen.findByRole('heading', { name: 'Review the import' });
  fireEvent.change(screen.getByLabelText('Rights holder'), { target: { value: 'Another example creator' } });
  await screen.findByRole('heading', { name: 'Choose files to import' });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Review the import' })).toBeNull());
});

it.each(['licensed', 'permission', 'public-domain'] as const)('permits an explicit %s statement in bridged presentation', async (basis) => {
  // Keep data synthetic while exercising the same rights controls as the native picker.
  const workspace = { ...createDesignWorkspace(null), bridged: true };
  await act(async () => { render(<DesignWorkspaceContext.Provider value={workspace}>
    <Suspense fallback={<p>Loading</p>}><ImportsView {...props} /></Suspense>
  </DesignWorkspaceContext.Provider>); });
  const choose = () => screen.getByRole('button', { name: 'Choose files…' }) as HTMLButtonElement;
  expect(choose().disabled).toBe(true);
  expect((screen.getByRole('option', { name: basis === 'public-domain' ? 'Public domain' : basis === 'licensed' ? 'Licensed' : 'Permission' }) as HTMLOptionElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Rights basis'), { target: { value: basis } });
  fireEvent.change(screen.getByLabelText('Rights holder'), { target: { value: 'Synthetic rights holder' } });
  if (basis === 'licensed') {
    expect(choose().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('License (required)'), { target: { value: 'Synthetic license' } });
  }
  expect(choose().disabled).toBe(false);
  fireEvent.click(choose());
  await screen.findByRole('heading', { name: 'Review the import' });
});
