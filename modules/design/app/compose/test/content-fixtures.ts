/** Shared synthetic fixtures for the durable-content tests: a bridged workspace over the transport double, with stored capture blobs. */
import { createHash } from 'node:crypto';
import type { ProjectContext } from '@hq/contracts';
import { addVersion, addView, type CaptureBinding } from '../../../projects/src/content.ts';
import type { PreviewRef } from '../../../projects/src/contract.ts';
import { versionId, viewId } from '../../../projects/src/ids.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { createProjectContentEvents } from '../content-events.ts';
import { createTransportDouble } from './bridge-double.ts';

export const alpha: ProjectContext = { id: 'project-alpha', name: 'Alpha (synthetic)' };
export const beta: ProjectContext = { id: 'project-beta', name: 'Beta (synthetic)' };

export const digestOf = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const png = (seed: number, w = 32, h = 20): Uint8Array => syntheticPng(seed, w, h);
export const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

export function durableFixture() {
  const double = createTransportDouble();
  const blobs = new Map<string, Uint8Array>();
  // `fail(...)` makes chosen transport calls fail; every other call behaves normally (blob reads serve `blobs`).
  let injected: ((route: string, params: unknown) => unknown) | null = null;
  double.failWith((route, params) => injected?.(route, params) ?? (route === 'blob.get'
    ? { ok: true, value: blobs.get((params as { digest: string }).digest) ?? null } : undefined));
  const documents = createBridgeWorkspaceDocuments(double.transport);
  const contentEvents = createProjectContentEvents();
  const workspace = createBridgedWorkspace(documents, { contentEvents });
  /** Stores the bytes the way the desktop preview host does: under their own digest. */
  const store = (bytes: Uint8Array): string => { const digest = digestOf(bytes); blobs.set(digest, bytes); return digest; };
  return { double, blobs, documents, contentEvents, workspace, store, fail: (next: typeof injected) => { injected = next; } };
}

export type DurableFixture = ReturnType<typeof durableFixture>;

export interface SavedVersion {
  readonly id: string;
  readonly sourceRevision?: string;
  readonly view?: string;
  readonly route?: string;
  readonly digest?: string;
  readonly thumbnail?: PreviewRef;
  readonly basedOn?: string;
}

/**
 * Saves one version the way a writer outside the views does (a live capture, an import): through the
 * repository, then `notify`. Pass `announce: false` to model a writer that forgot, or another window.
 */
export async function saveVersion(fixture: { readonly workspace: Pick<DurableFixture['workspace'], 'contentFor'>; readonly contentEvents: DurableFixture['contentEvents'] },
  project: ProjectContext, version: SavedVersion, announce = true): Promise<void> {
  const { repository } = await fixture.workspace.contentFor(project);
  const view = viewId(version.view ?? 'view-main');
  const capture: CaptureBinding = { route: version.route ?? '/main', viewport: { w: 320, h: 640, dpr: 1 },
    ...(version.digest ? { captureDigest: version.digest } : {}), ...(version.sourceRevision ? { sourceRevision: version.sourceRevision } : {}) };
  await repository.update(project.id as Parameters<typeof repository.update>[0], (content, now) => {
    const withView = content.views.some((existing) => existing.id === view) ? content : addView(content, { id: view, title: 'Main view', kind: 'page' }, now);
    return addVersion(withView, { id: versionId(version.id), viewId: view, label: `Version ${version.id}`, origin: 'synthetic-fixture', capture,
      ...(version.thumbnail ? { thumbnail: version.thumbnail } : {}), ...(version.basedOn ? { basedOn: versionId(version.basedOn) } : {}) }, now);
  });
  if (announce) fixture.contentEvents.notify(project.id);
}

/** Writes a raw project-content document under the physical key, bypassing the repository (for damaged or future-format content). */
export async function seedRawContent(fixture: DurableFixture, project: ProjectContext, value: unknown): Promise<void> {
  const { contentKey } = await import('../../../projects/src/repository.ts');
  const { projectId } = await import('../../../projects/src/ids.ts');
  const { authoringDigest } = await import('../canonical.ts');
  const key = `design/projects/${contentKey(projectId(project.id))}`;
  const json = JSON.parse(JSON.stringify(value));
  fixture.double.documents.set(key, { namespace: 'workspace', key, revision: 1, value: json, valueDigest: await authoringDigest(json), updatedAt: '2026-01-01T00:00:00Z' });
}

/** What a test can do to the stand-in catalog host: bring it down and up, and see how often it was asked for roots. */
export interface DesktopCatalogControl { down: boolean; rootsCalls: number }

/**
 * Stands in for the desktop catalog connection that `discoveryEnv()` needs, on top of the document transport.
 * Pass a control object to make the host unreachable (`down`) and to count `catalog.roots` calls.
 * Returns a restore function; call it in `afterEach`.
 */
export function installDesktopCatalog(fixture: DurableFixture, control: DesktopCatalogControl = { down: false, rootsCalls: 0 }): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let cached: import('@hq/contracts/services').StoredDocument | null = null;
  type Route = import('@hq/contracts/services').DesignServiceRoute;
  const transport = {
    async call(route: Route, params: never) {
      if (route === 'catalog.roots') {
        control.rootsCalls += 1;
        return control.down ? { ok: false, kind: 'unavailable' } : { ok: true, value: [] };
      }
      if (route === 'cache.get') return { ok: true, value: cached };
      if (route === 'cache.put') {
        const input = params as { key: string; value: import('@hq/contracts/services').JsonValue };
        cached = { namespace: 'cache', key: input.key, value: input.value, revision: (cached?.revision ?? 0) + 1,
          valueDigest: `sha256:${'0'.repeat(64)}`, updatedAt: '2026-01-01T00:00:00Z' } as import('@hq/contracts/services').StoredDocument;
        return { ok: true, value: cached };
      }
      return fixture.double.transport.call(route, params);
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { hqServices: { design: transport } } });
  return () => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}
