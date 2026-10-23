// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModulePort, ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceProvider } from '@hq/contracts/references';
import { createReferencePort, RESOLUTION_MAX_AGE } from './references';
import { App } from './App';
const envelope: ReferenceEnvelope = { version: 1, domain: 'work', projectId: 'hq-local', kind: 'item', entityId: 'one', title: 'Card', returnDestination: { domain: 'design', destination: 'home' } };
vi.mock('./reference-providers', () => ({ REFERENCE_PROVIDERS: [{ domain: 'work', kinds: ['item'], find: async () => [], resolve: async () => ({ status: 'available', observedAt: new Date().toISOString(), destination: 'item/one' }) }] }));
vi.mock('./modules', () => {
  function Source(props: ModulePort) {
    return createElement('section', {}, createElement('p', {}, `Source ${props.destination}`), createElement('button', { onClick: () => props.navigate('draft/one') }, 'Select source draft'),
      createElement('button', { onClick: () => props.references?.open(envelope, { label: 'Design draft', to: { domain: 'design', destination: props.destination } }) }, 'Open card'),
      createElement('button', { onClick: () => props.references?.open({ ...envelope, projectId: 'elsewhere' }, { label: 'Design draft', to: { domain: 'design', destination: props.destination } }) }, 'Open other project'));
  }
  function Target(props: ModulePort) { return createElement('p', {}, `Target ${props.destination}; return ${props.returnContext?.label ?? 'none'}`); }
  return { DOMAIN_LABELS: { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' }, MODULES: { design: Source, social: Target, work: Target, wiki: Target }, MODULE_PRESENTATION: {} };
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function provider(resolve = vi.fn(async () => ({ status: 'available' as const, observedAt: new Date(1000).toISOString(), destination: 'item/one' }))) {
  return { domain: 'work' as const, kinds: ['item'], find: vi.fn(async () => [envelope, envelope]), resolve } satisfies ReferenceProvider;
}
it('aggregates read-only providers, deduplicates, caches per identity, and refreshes stale observations', async () => {
  let now = 1000; const p = provider(), open = vi.fn(), notice = vi.fn(); const port = createReferencePort([p], { projectId: () => 'hq-local', open, notice }, () => now);
  expect(await port.find('Card', { projectId: 'hq-local', limit: 10 })).toEqual([envelope]);
  await port.resolve(envelope); await port.resolve(envelope); expect(p.resolve).toHaveBeenCalledTimes(1);
  now += RESOLUTION_MAX_AGE + 1; expect((await port.resolve(envelope)).status).toBe('unknown'); expect(p.resolve).toHaveBeenCalledTimes(2);
  expect(open).not.toHaveBeenCalled();
});
it('unknown kinds and mismatched projects remain read-only and never call a provider', () => {
  const p = provider(), open = vi.fn(), notice = vi.fn(), port = createReferencePort([p], { projectId: () => 'hq-local', open, notice });
  const back = { label: 'Source', to: envelope.returnDestination };
  port.open({ ...envelope, projectId: 'other' }, back); port.open({ ...envelope, kind: 'missing-kind' }, back);
  expect(open).not.toHaveBeenCalled(); expect(p.resolve).not.toHaveBeenCalled(); expect(notice).toHaveBeenCalledTimes(2);
});
it('a pending reference cannot navigate after the user cancels it', async () => {
  let release!: (value: { status: 'available'; observedAt: string; destination: string }) => void;
  const p = provider(vi.fn(() => new Promise(r => { release = r; }))), open = vi.fn();
  const port = createReferencePort([p], { projectId: () => 'hq-local', open, notice: vi.fn() }, () => 1000);
  port.open(envelope, { label: 'Source', to: envelope.returnDestination }); port.cancelOpen();
  release({ status: 'available', observedAt: new Date(1000).toISOString(), destination: 'item/one' });
  await new Promise(r => setTimeout(r, 0)); expect(open).not.toHaveBeenCalled();
});
function mount() {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  return render(createElement(App));
}
it('App reference open/Back restores the source domain and navigation state while preserving module remount semantics', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Select source draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open card' }));
  await screen.findByText('Target item/one; return Design draft');
  fireEvent.click(screen.getByRole('button', { name: 'Back to Design draft' }));
  expect(screen.getByText('Source draft/one')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Design$/ }).getAttribute('aria-current')).toBe('page');
});
it('App project mismatch displays a read-only notice without navigation', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Open other project' }));
  await waitFor(() => expect(screen.getByLabelText('Read-only reference').textContent).toContain('elsewhere'));
  expect(screen.queryByText('Target item/one; return Design draft')).toBeNull();
});
