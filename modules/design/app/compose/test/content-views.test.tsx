// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto';
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectContext } from '@hq/contracts';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { createFlowRepository } from '../../../flows/src/repository.ts';
import { parseFlow } from '../../../flows/src/model.ts';
import { createFlowsStorage } from '../../storage/index.ts';
import { createDesignWorkspace, type DesignWorkspace } from '../workspace.ts';
import { DesignWorkspaceContext } from '../workspace-context.tsx';
import { createProjectContentEvents } from '../content-events.ts';
import { useProjectContentRevision } from '../content-revision.ts';
import { mountRequests } from '../closure-views.tsx';
import { TasteView } from '../views/TasteView.tsx';
import { AnnotationsView } from '../views/AnnotationsView.tsx';
import { FlowsView } from '../views/FlowsView.tsx';
import { alpha, beta, dataUrl, digestOf, durableFixture, png, saveVersion, type DurableFixture } from './content-fixtures.ts';

const props: Omit<DesignSectionProps, 'context'> = {
  appearance: 'light', sectionId: 'taste', state: { read: () => undefined, write: () => true },
  navigate: () => undefined, proposeProjectSwitch: () => undefined, onCommand: () => () => undefined,
  surface: (kind) => ({ 'data-hqd-surface': kind, style: { colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal',
    opacity: 1, isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent' } }),
};

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** The durable fixture's store, composed as the app does, with an optional hold on project-content reads. */
function app(f: DurableFixture) {
  const gate: { held: Promise<void> | null } = { held: null };
  const workspace = createDesignWorkspace({ ...f.documents, async getDocument(key) {
    if (gate.held && key.startsWith('design/projects/')) await gate.held;
    return f.documents.getDocument(key);
  } });
  if (!workspace.bridged) throw new Error('expected the durable workspace');
  const hold = () => { let release!: () => void; gate.held = new Promise<void>((resolve) => { release = () => { gate.held = null; resolve(); }; }); return release; };
  /** Writes to the store directly (never through the held reads), then announces on the workspace under test, so its own cache is what has to notice. */
  const save = (project: ProjectContext, version: Parameters<typeof saveVersion>[2]) => saveVersion({ workspace: f.workspace, contentEvents: workspace.contentEvents }, project, version);
  return { workspace, hold, save };
}

function mount(workspace: DesignWorkspace, ui: React.ReactElement) {
  return render(<DesignWorkspaceContext.Provider value={workspace}><Suspense fallback={<p>Loading section…</p>}>{ui}</Suspense></DesignWorkspaceContext.Provider>);
}
async function ready(make: () => ReturnType<typeof mount>) {
  let mounted!: ReturnType<typeof mount>;
  await act(async () => { mounted = make(); });
  return mounted;
}

describe('useProjectContentRevision', () => {
  function Probe({ events, project, renders }: { events: ReturnType<typeof createProjectContentEvents>; project: string; renders: { count: number } }) {
    const revision = useProjectContentRevision({ contentEvents: events }, project);
    renders.count += 1;
    return <p>revision {revision}</p>;
  }

  it('renders again when its project changes, and not when another project does', async () => {
    const events = createProjectContentEvents();
    const renders = { count: 0 };
    render(<Probe events={events} project="project-a" renders={renders} />);
    expect(screen.getByText('revision 0')).toBeTruthy();
    const initial = renders.count;
    await act(async () => events.notify('project-b'));
    expect(renders.count).toBe(initial);
    await act(async () => events.notify('project-a'));
    await screen.findByText('revision 1');
    await act(async () => events.notify('project-a'));
    await screen.findByText('revision 2');
  });

  it('stops listening when the view goes away', async () => {
    const events = createProjectContentEvents();
    const renders = { count: 0 };
    const mounted = render(<Probe events={events} project="project-a" renders={renders} />);
    mounted.unmount();
    const after = renders.count;
    await act(async () => events.notify('project-a'));
    expect(renders.count).toBe(after);
  });

  it('is usable with the fake workspace, whose content never changes', async () => {
    const fake = createDesignWorkspace(null);
    function Fake() { const revision = useProjectContentRevision(fake, 'project-a'); return <p>fake revision {revision}</p>; }
    render(<Fake />);
    expect(screen.getByText('fake revision 0')).toBeTruthy();
  });
});

describe('Taste follows saved versions (PR #168 P2)', () => {
  it('lists a version saved after the first visit without reloading, and never shows the loading state while it refreshes', async () => {
    const f = durableFixture();
    const { workspace, hold, save } = app(f);
    await save(alpha, { id: 'first' });
    await ready(() => mount(workspace, <TasteView {...props} context={alpha} />));
    const picker = await screen.findByLabelText('Version to rate');
    expect(screen.queryByRole('option', { name: /second/u })).toBeNull();
    const release = hold();
    await act(async () => { await save(alpha, { id: 'second' }); });
    // The refresh is waiting on the store: the screen still shows its content, not a loading state.
    expect(screen.queryByText('Loading section…')).toBeNull();
    expect(screen.getByLabelText('Version to rate')).toBe(picker);
    await act(async () => release());
    await screen.findByRole('option', { name: /Version second/u });
    expect(screen.getByLabelText('Version to rate')).toBe(picker);
    expect(screen.queryByText('Loading section…')).toBeNull();
  });

  it('keeps the chosen version while another one arrives', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    await save(alpha, { id: 'first' });
    await ready(() => mount(workspace, <TasteView {...props} context={alpha} />));
    const picker = await screen.findByLabelText('Version to rate') as HTMLSelectElement;
    await act(async () => { picker.value = 'first'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    await screen.findByText('Project profile');
    await act(async () => { await save(alpha, { id: 'second' }); });
    await screen.findByRole('option', { name: /Version second/u });
    expect((screen.getByLabelText('Version to rate') as HTMLSelectElement).value).toBe('first');
    expect(screen.getByText('Project profile')).toBeTruthy();
  });

  it('does not refresh for another project’s change', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    await save(alpha, { id: 'first' });
    await ready(() => mount(workspace, <TasteView {...props} context={alpha} />));
    await screen.findByLabelText('Version to rate');
    const reads = f.double.calls.length;
    await act(async () => { await save(beta, { id: 'beta-only' }); });
    const betaWrites = f.double.calls.filter((call) => call.route === 'doc.put').length;
    expect(betaWrites).toBeGreaterThan(0);
    expect(f.double.calls.slice(reads).some((call) => call.route === 'doc.get' && (call.params as { key: string }).key.includes(alpha.id))).toBe(false);
    expect(screen.queryByRole('option', { name: /beta-only/u })).toBeNull();
  });
});

describe('Annotations show the stored capture of the selected version', () => {
  const image = (label: string) => screen.queryByLabelText(label)?.querySelector('img') ?? null;

  it('draws the stored capture bytes, then the newest capture once one is saved', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    const earlier = png(1);
    await save(alpha, { id: 'v1', digest: f.store(earlier) });
    await ready(() => mount(workspace, <AnnotationsView {...props} sectionId="annotations" context={alpha} />));
    await screen.findByLabelText('Saved capture');
    expect(image('Saved capture')!.src).toBe(dataUrl(earlier));
    expect(screen.getByText('saved capture image')).toBeTruthy();
    expect(screen.queryByText('Capture bytes unavailable')).toBeNull();
    const later = png(2);
    await act(async () => { await save(alpha, { id: 'live-capture', digest: f.store(later) }); });
    await waitFor(() => expect(image('Saved capture')!.src).toBe(dataUrl(later)));
    expect(screen.getByText('pinned to live-capture')).toBeTruthy();
  });

  it('says the capture is unavailable when its bytes are not stored, instead of drawing nothing silently', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    await save(alpha, { id: 'v1', digest: digestOf(png(1)) });
    await ready(() => mount(workspace, <AnnotationsView {...props} sectionId="annotations" context={alpha} />));
    await screen.findByLabelText('Capture unavailable');
    expect(image('Capture unavailable')).toBeNull();
    expect(screen.getByText('Capture bytes unavailable')).toBeTruthy();
  });

  it('offers nothing to mark up when no version names a capture', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    await save(alpha, { id: 'v1' });
    await ready(() => mount(workspace, <AnnotationsView {...props} sectionId="annotations" context={alpha} />));
    await screen.findByText('No saved project version is available to annotate.');
  });

  it('keeps the labelled synthetic thumbnail in the fake workspace', async () => {
    await ready(() => mount(createDesignWorkspace(null), <AnnotationsView {...props} sectionId="annotations" context={alpha} />));
    await screen.findByLabelText('Synthetic capture thumbnail (not a real version)');
    expect(image('Synthetic capture thumbnail (not a real version)')!.src).toMatch(/^data:image\/png;base64,/u);
  });
});

describe('Flows follow saved flows', () => {
  it('lists a flow saved after the first visit', async () => {
    const f = durableFixture();
    const { workspace } = app(f);
    await ready(() => mount(workspace, <FlowsView {...props} sectionId="flows" context={alpha} />));
    await screen.findByText(/No saved flows for this project yet/u);
    const parsed = parseFlow({ schema: 'hq.design.flow/v1', id: 'saved-flow', projectId: alpha.id, title: 'Saved checkout flow', platform: 'web', start: 'cart',
      routes: [{ route: '/cart', states: ['default'] }], hotspots: [],
      screens: [{ id: 'cart', title: 'Cart', versionId: 'v1', route: '/cart', state: 'default', viewport: { w: 320, h: 640, dpr: 1 } }] });
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    await createFlowRepository(createFlowsStorage(f.documents)).save(parsed.flow);
    expect(screen.queryByText('Saved checkout flow')).toBeNull();
    await act(async () => workspace.contentEvents.notify(alpha.id));
    await waitFor(() => expect(screen.queryByText(/No saved flows for this project yet/u)).toBeNull());
    expect(screen.getAllByText(/Saved checkout flow/u).length).toBeGreaterThan(0);
  });
});

describe('Requests and Runs pick from the current versions', () => {
  it('adds a version with a source revision to the picker when it is saved', async () => {
    const f = durableFixture();
    const { workspace, save } = app(f);
    await save(alpha, { id: 'v1', sourceRevision: 'rev-1' });
    const Requests = mountRequests(() => <p>request body</p>);
    await ready(() => mount(workspace, <Requests {...props} sectionId="requests" context={alpha} />));
    const picker = await screen.findByLabelText('Source version');
    const first = within(picker).getByRole('radio', { name: 'Version v1 /main · 320×640' }) as HTMLInputElement;
    expect(first.value).toBe('v1');
    expect(first.getAttribute('aria-disabled')).toBeNull();
    expect(first.checked).toBe(true);
    await act(async () => { await save(alpha, { id: 'v2', sourceRevision: 'rev-2' }); });
    const saved = await within(picker).findByRole('radio', { name: 'Version v2 /main · 320×640' }) as HTMLInputElement;
    expect(saved.value).toBe('v2');
    expect(saved.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(saved);
    expect(saved.checked).toBe(true);
    expect(first.checked).toBe(false);
    expect(screen.getByLabelText('Source version')).toBe(picker);
  });
});
