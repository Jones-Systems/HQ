// @vitest-environment happy-dom
import { Suspense, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '@hq/contracts/catalog';
import type { PreviewSession, PreviewTransport } from '@hq/contracts/preview';
import { ProjectsView } from '../../../modules/design/app/compose/views/ProjectsView.tsx';
import { InteractivePanel } from '../../../modules/design/app/compose/views/InteractivePanel.tsx';
import { DesignWorkspaceContext } from '../../../modules/design/app/compose/workspace-context.tsx';
import { createDesignWorkspace } from '../../../modules/design/app/compose/workspace.ts';
import { createBridgeWorkspaceDocuments } from '../../../modules/design/app/compose/bridge-documents.ts';
import { createTransportDouble } from '../../../modules/design/app/compose/test/bridge-double.ts';
import { previewIdentity, type PreviewBookmarkStore } from '../../../modules/design/app/compose/preview-navigation.ts';
import type { InteractiveCatalogItem } from '../../../modules/design/app/compose/runtime-ports.ts';
import { surfaceProps } from '../../../modules/design/ui/src/theme.ts';
import { CACHED_TAG } from '../../../modules/design/app/compose/labels.ts';

const cards = vi.hoisted(() => [
  { sourceProjectId: 'a'.repeat(64), hostId: 'fixture-host', displayName: 'Fixture website' },
  { sourceProjectId: 'b'.repeat(64), hostId: 'fixture-host', displayName: 'Fixture stills' },
  { sourceProjectId: 'a'.repeat(64), hostId: 'other-host', displayName: 'Same title, different host' },
]);
// The gallery is another lane; retain its callback contract while exercising the real compose view.
vi.mock('../../../modules/design/projects/src/index.ts', () => ({
  ProjectsSection: ({ gallery }: { gallery: { onOpenSource(item: typeof cards[number], button: HTMLButtonElement): void } }) => <div>{cards.map((card) =>
    <button key={card.hostId + card.sourceProjectId} onClick={(event) => gallery.onOpenSource(card, event.currentTarget)}>{card.displayName}</button>)}</div>,
}));
afterEach(async () => { await act(async () => { cleanup(); }); vi.restoreAllMocks(); });

function fixture(bookmark: PreviewBookmarkStore = { read: () => null, write() {} }) {
  const entry: CatalogEntry = { ...cards[0]!, hostId: 'fixture-host' as CatalogEntry['hostId'], sourceProjectId: cards[0]!.sourceProjectId as CatalogEntry['sourceProjectId'],
    rootId: 'fixture-root' as CatalogEntry['rootId'], relativePath: 'fixture', repoIdentity: { localOnly: true }, previews: [],
    metadata: { experienceKind: 'website', launchStatus: 'available', launchUrl: 'https://example.com', collectionId: 'fixture-collection', collectionName: 'Fixture collection' } };
  const item: InteractiveCatalogItem = { entry, hostLabel: 'Fixture host', freshness: 'fresh' };
  const still: InteractiveCatalogItem = { ...item, entry: { ...entry, sourceProjectId: cards[1]!.sourceProjectId as CatalogEntry['sourceProjectId'], displayName: cards[1]!.displayName, metadata: { experienceKind: 'stills' } } };
  const d = createTransportDouble();
  const calls: string[] = [];
  let session: PreviewSession = { sessionId: 'fixture-session', versionId: '', generation: 0, route: '/', state: '', viewport: { w: 1024, h: 720, dpr: 1 }, contentSize: { w: 1024, h: 720 }, status: 'open', pickQualified: false };
  const preview = { async call(route: string, params: { versionId?: string }) {
    calls.push(route);
    if (route === 'open') session = { ...session, versionId: params.versionId! };
    return { ok: true, value: route === 'events' ? { after: 0, events: [] } : route === 'close' ? null : session };
  } } as PreviewTransport;
  const selected = vi.fn();
  const workspace = createDesignWorkspace(createBridgeWorkspaceDocuments(d.transport), { preview, previewBookmark: bookmark,
    sources: { async list() { return [item, still]; } }, onSelectProject: selected });
  const controller = Promise.resolve({});
  const entries = cards.map((card) => ({ ...card, hostLabel: 'Fixture host', relativePath: 'fixture', repoIdentity: { localOnly: true }, freshness: { status: 'fresh' } }));
  const status = { tag: CACHED_TAG };
  const environment = Promise.resolve({ readPort: { subscribe: () => () => {}, status: () => status, current: () => entries } });
  Object.assign(workspace, { projectsFor: () => controller, discoveryEnv: () => environment });
  const deactivate = vi.spyOn(workspace.interactive, 'deactivate');
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  function View({ cardsVisible = false }: { cardsVisible?: boolean }) {
    const [context, setContext] = useState({ id: 'original-project', name: 'Original project' });
    selected.mockImplementation((project: { id: string; label: string }) => setContext({ id: project.id, name: project.label }));
    return <DesignWorkspaceContext.Provider value={workspace}><Suspense fallback={<p>Loading fixture</p>}>
      {cardsVisible ? <ProjectsView context={context} navigate={() => {}} appearance="light" sectionId="projects" state={{ read: () => undefined, write: () => true }} proposeProjectSwitch={() => {}} surface={surfaceProps} onCommand={() => () => {}} /> : <InteractivePanel context={context} navigate={() => {}} />}
    </Suspense></DesignWorkspaceContext.Provider>;
  }
  return { workspace, item, calls, selected, View, deactivate, scroll };
}

it('renders grouped openable entries and disabled stills; exact card Open preserves mount and reveals the surface', async () => {
  const f = fixture(); await act(async () => { render(<f.View cardsVisible />); });
  const select = await screen.findByRole('combobox', { name: 'Interactive source project' });
  await waitFor(() => expect(within(select).getByRole('group', { name: 'Fixture collection' })).toBeTruthy());
  const unavailable = within(select).getByRole('group', { name: 'Not interactive' });
  expect(within(unavailable).getByRole<HTMLOptionElement>('option').disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Same title, different host' }));
  expect(screen.queryByRole('button', { name: 'Open website' })).toBeNull();
  expect(screen.getByText(/not in the current interactive catalog/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fixture stills' }));
  expect(screen.queryByRole('button', { name: 'Open website' })).toBeNull();
  expect(screen.getByText('Still images: use the reference import workflow.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fixture website' }));
  expect(f.calls).toEqual([]); expect(f.selected).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open website' })); });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preview' })));
  expect(f.calls.filter((route) => route === 'open')).toHaveLength(1);
  expect(f.deactivate).not.toHaveBeenCalled();
  expect(f.scroll.mock.instances).toContain(screen.getByLabelText('Host live preview surface'));
});

it('Resume stays passive on mount and refresh, then opens only on its explicit button', async () => {
  const f = fixture({ read: () => ({ hostId: 'fixture-host', sourceProjectId: cards[0]!.sourceProjectId }), write() {} });
  await act(async () => { render(<f.View />); });
  const resume = await screen.findByRole('button', { name: 'Resume Fixture collection/Fixture website' });
  expect(f.calls).toEqual([]); expect(f.selected).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' })); });
  expect(f.calls).toEqual([]); expect(f.selected).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(resume); });
  await screen.findByRole('button', { name: 'Close preview' });
  expect(f.selected).toHaveBeenCalledTimes(1);
  expect(f.workspace.interactive.snapshot().bookmark).toEqual(previewIdentity(f.item));
});

it('missing saved preview displays a reason and retains its bookmark', async () => {
  const saved = { hostId: 'missing-host', sourceProjectId: cards[0]!.sourceProjectId };
  const f = fixture({ read: () => saved, write: vi.fn() }); await act(async () => { render(<f.View />); });
  await screen.findByText(/Saved preview unavailable.*bookmark is retained/);
  expect(screen.queryByRole('button', { name: /^Resume / })).toBeNull();
  expect(f.calls).toEqual([]); expect(f.selected).not.toHaveBeenCalled();
  expect(f.workspace.interactive.snapshot().bookmark).toEqual(saved);
});
