// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModulePort, ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceProvider } from '@hq/contracts/references';
import { createReferencePort, RESOLUTION_MAX_AGE } from './references';
import { App } from './App';
import { selectDesktopProject } from './interactive-runtime';
const envelope: ReferenceEnvelope = { version: 1, domain: 'work', projectId: 'hq-local', kind: 'item', entityId: 'one', title: 'Card', returnDestination: { domain: 'design', destination: 'home' } };
vi.mock('./reference-providers', () => ({ REFERENCE_PROVIDERS: [{ domain: 'work', kinds: ['item'], find: async () => [], resolve: async () => ({ status: 'available', observedAt: new Date().toISOString(), destination: 'item/one' }) }] }));
vi.mock('./modules', () => {
  function Source(props: ModulePort) {
    return createElement('section', {}, createElement('p', {}, `Source ${props.destination}`), createElement('button', { onClick: () => props.navigate('draft/one') }, 'Select source draft'),
      createElement('button', { onClick: () => props.references?.open(envelope, { label: 'Design draft', to: { domain: 'design', destination: props.destination } }) }, 'Open card'),
      createElement('button', { onClick: () => props.references?.open({ ...envelope, projectId: 'elsewhere' }, { label: 'Design draft', to: { domain: 'design', destination: props.destination } }) }, 'Open other project'));
  }
  function Target(props: ModulePort) { return createElement('p', {}, `Target ${props.destination}; return ${props.returnContext?.label ?? 'none'}; project ${props.context.id}`); }
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
it('a failed or inconclusive resolution is not cached, so the next resolve asks the provider again', async () => {
  let failing = true;
  const p = provider(vi.fn(async () => { if (failing) throw new Error('transient'); return { status: 'available' as const, observedAt: new Date(1000).toISOString(), destination: 'item/one' }; }));
  const port = createReferencePort([p], { projectId: () => 'hq-local', open: vi.fn(), notice: vi.fn() }, () => 1000);
  expect((await port.resolve(envelope)).status).toBe('unavailable');
  failing = false;
  expect((await port.resolve(envelope)).status).toBe('available'); expect(p.resolve).toHaveBeenCalledTimes(2);
  await port.resolve(envelope); expect(p.resolve).toHaveBeenCalledTimes(2);
  const inconclusive = { domain: 'work' as const, kinds: ['item'], find: vi.fn(async () => []), resolve: vi.fn(async () => ({ status: 'unknown' as const, observedAt: new Date(1000).toISOString() })) } satisfies ReferenceProvider;
  const second = createReferencePort([inconclusive], { projectId: () => 'hq-local', open: vi.fn(), notice: vi.fn() }, () => 1000);
  await second.resolve(envelope); await second.resolve(envelope); expect(inconclusive.resolve).toHaveBeenCalledTimes(2);
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
  await screen.findByText(/^Target item\/one; return Design draft;/);
  fireEvent.click(screen.getByRole('button', { name: 'Back to Design draft' }));
  expect(screen.getByText('Source draft/one')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Design$/ }).getAttribute('aria-current')).toBe('page');
});
it('App project mismatch displays a read-only notice without navigation', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Open other project' }));
  await waitFor(() => expect(screen.getByLabelText('Read-only reference').textContent).toContain('elsewhere'));
  expect(screen.queryByText(/^Target item\/one; return Design draft;/)).toBeNull();
});
/** OD-3: Social and Work stay workspace-scoped (`hq-local`); a Design project switch must not make them read-only. */
function scoped<D extends 'work' | 'design'>(domain: D, kind: string, projectOf: (scope: string) => string | null) {
  return {
    domain, kinds: [kind],
    find: vi.fn(async (_query: string, scope: { projectId: string }) => {
      const projectId = projectOf(scope.projectId);
      return projectId ? [{ ...envelope, domain, kind, projectId, entityId: `${domain}-one` }] : [];
    }),
    resolve: vi.fn(async (target: ReferenceEnvelope) => ({ status: 'available' as const, observedAt: new Date(1000).toISOString(), targetProjectId: target.projectId, destination: `${kind}/one` })),
  } satisfies ReferenceProvider;
}
it('workspace-scoped Work references stay current after a Design project switch; other projects stay read-only', async () => {
  let project = 'hq-local';
  // Like the real providers: Work answers only for the workspace scope, Design for the project it is asked about.
  const work = scoped('work', 'item', scope => scope === 'hq-local' ? 'hq-local' : null);
  const design = scoped('design', 'section', scope => scope);
  const open = vi.fn(), notice = vi.fn();
  const port = createReferencePort([design, work], { projectId: () => project, open, notice }, () => 1000);
  project = 'design-b';
  const found = await port.find('Card', { projectId: 'design-b', limit: 10 });
  expect(found.map(item => [item.domain, item.projectId])).toEqual([['design', 'design-b'], ['work', 'hq-local']]);
  const back = { label: 'Source', to: envelope.returnDestination };
  port.open(envelope, back);
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  expect(open.mock.calls[0]![1]).toBe('item/one'); expect(notice).not.toHaveBeenCalled();
  port.open({ ...envelope, domain: 'design', kind: 'section', projectId: 'design-a' }, back);
  port.open({ ...envelope, projectId: 'other' }, back);
  expect(notice).toHaveBeenCalledTimes(2); expect(open).toHaveBeenCalledOnce();
});
it('App keeps Work references openable after a Design project switch and gives Work the workspace scope', async () => {
  mount();
  act(() => selectDesktopProject({ id: 'design-b', label: 'Design B', navigation: 'preserve-design' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open card' }));
  expect(await screen.findByText('Target item/one; return Design draft; project hq-local')).toBeTruthy();
  expect(screen.queryByLabelText('Read-only reference')).toBeNull();
});
