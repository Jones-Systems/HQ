// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto';
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectContext } from '@hq/contracts';
import type { JsonValue } from '@hq/contracts/services';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { addVersion, addView, createProjectContent } from '../../../projects/src/content.ts';
import { projectId, versionId, viewId } from '../../../projects/src/ids.ts';
import { contentKey } from '../../../projects/src/repository.ts';
import { TASTE_DOCUMENT_KEY } from '../../../taste/src/project-service.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createDesignWorkspace, type DesignWorkspace } from '../workspace.ts';
import { DesignWorkspaceContext } from '../workspace-context.tsx';
import { TasteView } from '../views/TasteView.tsx';
import { createTransportDouble } from './bridge-double.ts';
import { authoringDigest } from '../canonical.ts';

const A = { id: 'opaque-project-a', name: 'Selected project' };
const B = { id: 'opaque-project-b', name: 'Other selected project' };
const FIRST = 'durable-version-1';
const SECOND = 'durable-version-2';
const NOW = '2026-01-01T00:00:00Z';
const props: Omit<DesignSectionProps, 'context'> = {
  appearance: 'light', sectionId: 'taste', state: { read: () => undefined, write: () => true },
  navigate: () => undefined, proposeProjectSwitch: () => undefined, onCommand: () => () => undefined,
  surface: (kind) => ({ 'data-hqd-surface': kind, style: { colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal',
    opacity: 1, isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent' } }),
};

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function harness() {
  const double = createTransportDouble();
  const documents = createBridgeWorkspaceDocuments(double.transport);
  const workspace = createDesignWorkspace(documents);
  async function seed(context: ProjectContext, ids = [FIRST, SECOND]) {
    const pid = projectId(context.id);
    const view = viewId(`${context.id}-view`);
    let content = addView(createProjectContent(pid, NOW), { id: view, title: 'Saved landing', kind: 'page' }, NOW);
    for (const [index, id] of ids.entries()) content = addVersion(content, {
      id: versionId(id), viewId: view, label: `Saved landing v${index + 1}`, origin: 'owner-created',
      capture: { route: '/landing', viewport: { w: 1200, h: 800, dpr: 1 } },
    }, NOW);
    const key = `design/projects/${contentKey(pid)}`;
    const value = JSON.parse(JSON.stringify(content)) as JsonValue;
    double.documents.set(key, { namespace: 'workspace', key, revision: 1, value,
      valueDigest: await authoringDigest(value), updatedAt: NOW });
  }
  return { double, documents, workspace, seed };
}

function view(workspace: DesignWorkspace, context: ProjectContext = A) {
  return <DesignWorkspaceContext.Provider value={workspace}>
    <Suspense fallback={<p>Loading section…</p>}><TasteView {...props} context={context} /></Suspense>
  </DesignWorkspaceContext.Provider>;
}

async function choose(id = FIRST) {
  fireEvent.change(await screen.findByLabelText('Version to rate'), { target: { value: id } });
  await screen.findByText('Project profile');
}

describe('Taste production composition', () => {
  it('saves against the opaque selected project and the explicitly chosen durable version', async () => {
    const { double, workspace, seed } = harness();
    await seed(A);
    render(view(workspace));
    await screen.findByText('Choose a saved version to rate.');
    expect(screen.queryByText('Project profile')).toBeNull();
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(0);
    await choose(SECOND);
    expect(screen.getByRole('heading', { name: 'Saved landing v2' })).toBeTruthy();
    expect(screen.getByLabelText('Project · Selected project')).toBeTruthy();
    expect(screen.queryByText('Example')).toBeNull();
    expect(screen.queryByText('Synthetic')).toBeNull();
    expect(screen.queryByText('Synthetic taste project')).toBeNull();
    expect(screen.queryByText('Synthetic landing page · v2')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Overall: 4, Like' }));
    await screen.findByText('1 entry · verified');
    const stored = double.documents.get(TASTE_DOCUMENT_KEY)!;
    const record = JSON.parse((stored.value as { jsonl: string }).jsonl.trim());
    expect(record.payload.scope).toEqual({ kind: 'project', projectId: A.id });
    expect(record.payload.subject).toEqual({ id: SECOND, kind: 'version', label: 'Saved landing v2', versionId: SECOND });
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(1);
    expect(double.calls.filter(({ route, params }) => route === 'doc.get' && 'key' in params
      && params.key.startsWith('design/taste/')).every(({ params }) => 'key' in params && params.key === TASTE_DOCUMENT_KEY)).toBe(true);
  });

  it('shows an empty project or an explicit selection prompt without fabricating a subject', async () => {
    const { double, workspace, seed } = harness();
    await seed(A, []);
    await seed(B);
    const mounted = render(view(workspace));
    await screen.findByText('No saved versions for this project yet.');
    expect(screen.queryByRole('radio')).toBeNull();
    mounted.rerender(view(workspace, B));
    await choose();
    fireEvent.change(screen.getByLabelText('Version to rate'), { target: { value: '' } });
    expect(screen.getByText('Choose a saved version to rate.')).toBeTruthy();
    expect(screen.queryByText('Project profile')).toBeNull();
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(0);
  });

  it.each(['content', 'journal'] as const)('keeps a failed %s read unavailable instead of empty or preview data', async (failed) => {
    const { double, workspace, seed } = harness();
    await seed(A);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    double.failWith((route, params) => route === 'doc.get' && 'key' in params
      && params.key === (failed === 'journal' ? TASTE_DOCUMENT_KEY : `design/projects/${contentKey(projectId(A.id))}`)
      ? { ok: false, kind: 'unavailable' } : undefined);
    render(view(workspace));
    if (failed === 'journal') {
      fireEvent.change(await screen.findByLabelText('Version to rate'), { target: { value: FIRST } });
      await screen.findByText('Taste is unavailable right now.');
    } else await screen.findByText('Section unavailable. Stored data was not replaced.');
    expect(screen.queryByText('No saved versions for this project yet.')).toBeNull();
    expect(screen.queryByText('No ratings yet.')).toBeNull();
    expect(screen.queryByText('Synthetic landing page · v2')).toBeNull();
    expect(screen.queryByText('Project profile')).toBeNull();
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(0);
  });

  it('fences subject drafts and resets selection on project switches even with reused version IDs', async () => {
    const { double, workspace, seed } = harness();
    await seed(A);
    await seed(B);
    const mounted = render(view(workspace));
    await choose();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'First version draft' } });
    await choose(SECOND);
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Project A draft' } });
    mounted.rerender(view(workspace, B));
    await screen.findByText('Choose a saved version to rate.');
    expect((screen.getByLabelText('Version to rate') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByLabelText('Note')).toBeNull();
    await choose(SECOND);
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByLabelText('Project · Other selected project')).toBeTruthy();
    mounted.rerender(view(workspace, A));
    await screen.findByText('Choose a saved version to rate.');
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(0);
  });

  it('resets selection on a replacement client and ignores the old client’s late journal read', async () => {
    const { double, documents, seed } = harness();
    await seed(A);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let waiting = false;
    const oldWorkspace = createDesignWorkspace({ ...documents, async getDocument(key) {
      const result = await documents.getDocument(key);
      if (key === TASTE_DOCUMENT_KEY) { waiting = true; await held; }
      return result;
    } });
    const mounted = render(view(oldWorkspace));
    fireEvent.change(await screen.findByLabelText('Version to rate'), { target: { value: SECOND } });
    await waitFor(() => expect(waiting).toBe(true));
    mounted.rerender(view(createDesignWorkspace(documents)));
    await screen.findByText('Choose a saved version to rate.');
    expect(screen.queryByText('Project profile')).toBeNull();
    await act(async () => release());
    expect(screen.getByText('Choose a saved version to rate.')).toBeTruthy();
    expect(screen.queryByText('Project profile')).toBeNull();
    await choose();
    expect(screen.getByRole('heading', { name: 'Saved landing v1' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Old client draft' } });
    mounted.rerender(view(createDesignWorkspace(documents)));
    await screen.findByText('Choose a saved version to rate.');
    await choose();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(0);
  });

  it('shows unknown write outcome and only replays the same command after an explicit retry', async () => {
    const { double, workspace, seed } = harness();
    await seed(A);
    double.failWith((route) => route === 'doc.put' ? { ok: false, kind: 'unknown' } : undefined);
    const mounted = render(view(workspace));
    await choose();
    fireEvent.click(screen.getByRole('radio', { name: 'Overall: 4, Like' }));
    await screen.findByText('The save may or may not have reached the journal. Retrying sends the same entry and cannot duplicate it.');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false));
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(1);
    mounted.rerender(view(workspace));
    expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(1);
    expect(screen.queryByText(/Nothing was saved/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(double.calls.filter(({ route }) => route === 'doc.put')).toHaveLength(2));
    const attempts = double.calls.filter(({ route }) => route === 'doc.put').map(({ params }) => {
      if (!('value' in params)) throw new Error('Expected a document put');
      return JSON.parse((params.value as { jsonl: string }).jsonl.trim());
    });
    expect(attempts[1].clientEventId).toBe(attempts[0].clientEventId);
    expect(attempts[1].payload).toEqual(attempts[0].payload);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('retains the labelled in-memory preview when documents are null', async () => {
    render(view(createDesignWorkspace(null)));
    await screen.findByRole('heading', { name: 'Synthetic landing page · v2' });
    await screen.findByText('Project profile');
    expect(screen.getByText('Example')).toBeTruthy();
    expect(screen.getByText('Synthetic')).toBeTruthy();
    expect(screen.getByText('in-memory fake journal (not durable)')).toBeTruthy();
    expect(screen.getByLabelText('Project · Synthetic taste project')).toBeTruthy();
    expect(screen.queryByLabelText('Version to rate')).toBeNull();
  });
});
