/** Durable section composition. Construction and navigation never seed workspace documents. */
import type { WorkspaceDocuments, WorkspaceRecords } from '../storage/index.ts';
import { createProjectsStorage, createComponentsStorage, createFlowsStorage, createCompareStorage, createAnnotationsStorage, createCanvasStorage, DEVICE_STORAGE_LABEL } from '../storage/index.ts';
import { ProjectContentRepository } from '../../projects/src/repository.ts';
import { createProjectsSection } from '../../projects/src/index.ts';
import { createProvisionalLocalRegistry } from '../../projects/src/registry.ts';
import { projectId } from '../../projects/src/ids.ts';
import { ComponentLibrary } from '../../components/src/workspace/library.ts';
import { webCryptoDigest } from '../../components/src/model/jcs.ts';
import { brandId } from '../../components/src/model/ids.ts';
import { createComponentsCanvasProvider } from '../../components/src/review/canvas-provider.ts';
import { createFlowRepository } from '../../flows/src/repository.ts';
import { createFlowCanvasProvider } from '../../flows/src/canvas.ts';
import { projectId as flowProjectId } from '../../flows/src/contract.ts';
import { createCompareController, loadComparison } from '../../compare/src/controller.ts';
import { comparisonId, projectId as compareProjectId } from '../../compare/src/ids.ts';
import { createComparison } from '../../compare/src/model.ts';
import { AnnotationController, loadAnnotations } from '../../annotations/src/controller.ts';
import { annotationId } from '../../annotations/src/contract.ts';
import type { VersionId } from '../../annotations/src/contract.ts';
import { FakeClipboard } from '../../annotations/src/fakes.ts';
import { createProjectTasteContribution } from '../../taste/src/project-service.ts';
import { projectId as tasteProjectId } from '../../taste/src/contract.ts';
import { webCryptoSha256 } from '../../taste/src/web-digest.ts';
import { canvasId } from '../../canvas/src/contract.ts';
import { createProviderRegistry } from '../../canvas/src/providers.ts';
import { createCanvasProviderAdapter } from './canvas-adapter.ts';
import { createProjectVersionsProvider } from './project-versions.ts';
import { canvasProjectIdFor, shellProjectIdFor, type ImportsEnv } from './fake-workspace.ts';
import { createBridgedDiscovery } from './bridged-discovery.ts';
import { createWorkspaceThumbnailPort } from './thumbnail-port.ts';
import { createProjectCompareCatalog } from './compare-catalog.ts';
import type { EvidenceTag } from './labels.ts';
import { createProjectContentEvents, type ProjectContentEvents } from './content-events.ts';
import { bridgeTransportFor } from './bridge-documents.ts';
import { createDurableImportsEnv, createUnavailableImportsEnv } from './imports-env.ts';
import type { ImportSource } from '../../imports/src/contract.ts';
import { perProjectRevision } from './revision-cache.ts';
import { designFailure, designOperation, DesignOperationError, type DesignFailureContext } from './errors.ts';
import { ANNOTATIONS_OPEN, openAnnotationSession } from './annotation-session.ts';
import type { LoadedContent } from '../../projects/src/repository.ts';

/** Operation names are part of the backend contract (BACKEND-CONTRACT.md); views show them in the toast meta line. */
const PROJECTS_LOAD: DesignFailureContext = { section: 'projects', operation: 'projects.load', action: 'load the project', write: false };
const FLOWS_LOAD: DesignFailureContext = { section: 'flows', operation: 'flows.load', action: 'load the flows', write: false };
const COMPARE_LOAD: DesignFailureContext = { section: 'compare', operation: 'compare.load', action: 'open the comparison', write: false };
const TASTE_OPEN: DesignFailureContext = { section: 'taste', operation: 'taste.open', action: 'open Taste', write: false };

/**
 * The failure rule of every per-project accessor that owns a stateful object (controller, client, library, canvas
 * environment): a healthy value is kept for the session, a failed build is kept only until the next change to the
 * project or `retry(project.id)`, so a suspended view settles on the failure instead of looping, and recovers.
 */
const KEEP = { onChange: 'keep' } as const;

/** Content that cannot be shown as it is stored: a newer format opens read-only, damaged content is left untouched. */
function unusableContent(loaded: Exclude<LoadedContent, { status: 'ok' }>, context: DesignFailureContext): DesignOperationError {
  return new DesignOperationError(loaded.status === 'unsupported-schema'
    ? designFailure('read-only', context, { reason: 'unsupported-stored-schema' })
    : designFailure('corrupt', context, { reason: 'invalid-content' }));
}

export interface BridgedWorkspaceOptions {
  /** Shared change feed; writers outside this workspace (captures, Imports) notify it. */
  readonly contentEvents?: ProjectContentEvents;
}

export function createBridgedWorkspace(documents: WorkspaceDocuments & Partial<Pick<WorkspaceRecords, 'getBlob'>>, options: BridgedWorkspaceOptions = {}) {
  const contentEvents = options.contentEvents ?? createProjectContentEvents();
  const storageTag: EvidenceTag = Object.freeze({ status: 'workspace', text: DEVICE_STORAGE_LABEL });
  const clock = { now: () => new Date().toISOString() };
  const ids = { next: (kind: 'project' | 'view' | 'version') => `${kind}-${globalThis.crypto.randomUUID()}` };
  let discovery: ReturnType<typeof createBridgedDiscovery> | undefined;
  let discoveryFailed = false;
  const discoveryEnv = () => {
    if (discovery === undefined) {
      const attempt = createBridgedDiscovery();
      discovery = attempt;
      discoveryFailed = false;
      attempt.then(undefined, () => { if (discovery === attempt) discoveryFailed = true; });
    }
    return discovery;
  };
  // A failed discovery (the catalog host timing out at startup) is kept while views settle on it, and built again
  // by the next change or retry, which is what lets Projects load once the host answers. A healthy one stays.
  contentEvents.subscribeAll(() => { if (discoveryFailed) { discovery = undefined; discoveryFailed = false; } });
  const projectStorage = createProjectsStorage(documents);
  const repository = new ProjectContentRepository(projectStorage, clock);
  const thumbnails = createWorkspaceThumbnailPort(documents);
  // Snapshot of the project's content. A change to the project (a capture, an import, an edit) builds a new one.
  const contentFor = perProjectRevision(contentEvents, (project) => designOperation(async () => {
    const loaded = await repository.load(projectId(project.id));
    if (loaded.status !== 'ok') throw unusableContent(loaded, PROJECTS_LOAD);
    return { repository, content: loaded.content, storage: projectStorage, clock, thumbnails, tag: storageTag };
  }, PROJECTS_LOAD));
  // The controller keeps the visible session (selection, filters, scroll), so it refreshes in place instead of being rebuilt.
  const projectsFor = perProjectRevision(contentEvents, async (_project) => {
    const { readPort } = await discoveryEnv();
    const registry = createProvisionalLocalRegistry({ storage: projectStorage, clock, ids });
    const { controller, ready } = createProjectsSection({ registry: { ...registry, provenance: { kind: 'provisional-local', label: 'Projects saved on this device' } }, storage: projectStorage, thumbnails, catalog: readPort, clock, ids,
      // Edits made in Projects reach every other reader of the project (Annotations, Compare, Taste, Requests).
      onContentChange: (changed) => contentEvents.notify(changed) });
    try { await ready; } catch (error) { controller.dispose(); throw error; }
    // Listening starts once the build succeeded, so a failed build that is rebuilt never leaves a second subscription.
    contentEvents.subscribeAll((changed) => {
      let id: ReturnType<typeof projectId>;
      try { id = projectId(changed); } catch { return; }
      void controller.refreshContent(id).catch(() => undefined);
    });
    return controller;
  }, KEEP);
  const componentsFor = perProjectRevision(contentEvents, async () => new ComponentLibrary(createComponentsStorage(documents), webCryptoDigest), KEEP);
  const flowRepository = createFlowRepository(createFlowsStorage(documents));
  // Preview captures are stored under their capture digest; document-only bridges have no capture images.
  const getBlob = documents.getBlob?.bind(documents);
  const readCapture = getBlob ? (digest: string) => getBlob(digest) : null;
  const flowsFor = perProjectRevision(contentEvents, (project) => designOperation(async () => (
    { repository: flowRepository, flows: await flowRepository.listForProject(flowProjectId(project.id)), readCapture }), FLOWS_LOAD));
  // The controller owns unsaved layout state, so it stays and re-reads its version lists when the project changes.
  const compareFor = perProjectRevision(contentEvents, (project) => designOperation(async () => {
    const storage = createCompareStorage(documents);
    const id = comparisonId(`${project.id}-compare`);
    const loaded = await loadComparison(storage, id);
    if (loaded.status === 'unsupported-version') throw new DesignOperationError(designFailure('read-only', COMPARE_LOAD, { reason: 'unsupported-stored-schema' }));
    if (loaded.status === 'invalid') throw new DesignOperationError(designFailure('corrupt', COMPARE_LOAD, { reason: 'invalid-comparison' }));
    if (loaded.status === 'ok' && loaded.state.projectId !== project.id) {
      throw new DesignOperationError(designFailure('corrupt', COMPARE_LOAD, { reason: 'wrong-project',
        message: "Couldn't open the comparison: it belongs to another project", description: 'The saved layout names a different project. HQ did not use or change it.' }));
    }
    const controller = createCompareController(loaded.status === 'ok' ? loaded.state : createComparison(id, compareProjectId(project.id), []), {
      storage,
      catalog: createProjectCompareCatalog(repository, projectId(project.id)),
    });
    // Listening starts once the controller exists, so a failed build that is rebuilt never leaves a second subscription.
    contentEvents.subscribe(project.id, () => { void controller.refreshVersions().catch(() => undefined); });
    return controller;
  }, COMPARE_LOAD), KEEP);
  const store = createAnnotationsStorage(documents);
  const annotationControllers = new Map<string, Promise<AnnotationController>>();
  const annotationsEnv = () => ({
    store,
    controllerFor(version: VersionId) {
      let controller = annotationControllers.get(version);
      if (!controller) {
        const loading = loadAnnotations(store, version).then((loaded) => new AnnotationController(loaded, {
          store, clipboard: new FakeClipboard(), ids: { adapter: 'real', next: () => annotationId(`ann-${globalThis.crypto.randomUUID()}`) },
        }));
        controller = loading;
        annotationControllers.set(version, loading);
        // A controller that failed to load is not kept: the next open of that version reads again. The session cache
        // above holds the failure for the revision, so a suspended view does not loop on it.
        loading.catch(() => { if (annotationControllers.get(version) === loading) annotationControllers.delete(version); });
      }
      return controller;
    },
  });
  // `{ selection }` is a version id: an explicit choice. Without it the screen opens on the newest stored capture.
  const annotationSessionFor = perProjectRevision(contentEvents, (project, version) => designOperation(async () => {
    const { content } = await contentFor(project);
    return openAnnotationSession({ content, read: readCapture, controllerFor: (id) => annotationsEnv().controllerFor(id),
      ...(version === undefined ? {} : { version }) });
  }, ANNOTATIONS_OPEN));
  const canvasFor = perProjectRevision(contentEvents, async (project) => {
    const cid = canvasProjectIdFor(project.id);
    if (cid === null) return null;
    const library = await componentsFor(project);
    const versions = createProjectVersionsProvider({ repository, storageTag, toContentProject: shellProjectIdFor });
    const components = createCanvasProviderAdapter({ source: createComponentsCanvasProvider({ library, digest: webCryptoDigest, designSystemId: null }),
      label: 'Components', tag: storageTag, toSourceProject: (id) => brandId('ProjectId', shellProjectIdFor(id)) });
    const flows = createCanvasProviderAdapter({ source: createFlowCanvasProvider(flowRepository), label: 'Flows', tag: storageTag,
      toSourceProject: (id) => flowProjectId(shellProjectIdFor(id)) });
    // Source failures are reported individually; they do not prevent opening the canvas arrangement.
    const sourceErrors: string[] = [];
    const startedAt = contentEvents.revision(project.id);
    try { await versions.refresh(cid); } catch { sourceErrors.push('Project views unavailable'); }
    for (const adapter of [components, flows]) {
      const report = await adapter.refresh(cid);
      sourceErrors.push(...report.errors.map((error) => `${adapter.label}: ${error}`));
    }
    const registry = createProviderRegistry();
    for (const provider of [versions, components, flows]) registry.register(provider);
    const environment = { projectId: cid, canvasId: canvasId(`${cid}-canvas`), storage: createCanvasStorage(documents), registry,
      ids: { next: (kind: string) => `${kind}-${globalThis.crypto.randomUUID()}` }, adapters: [components, flows], sourceErrors };
    // The provider tells the registry when it refreshes, so Canvas lists versions saved later without being rebuilt.
    // Listening starts last, once nothing in the build can fail, so a failed build that is rebuilt never leaves a
    // second subscription. A change that landed while the build was running is caught up once.
    const refreshVersions = () => { void versions.refresh(cid).catch(() => undefined); };
    const changedDuringBuild = contentEvents.revision(project.id) !== startedAt;
    contentEvents.subscribe(project.id, refreshVersions);
    if (changedDuringBuild) refreshVersions();
    return environment;
  }, KEEP);
  // The client holds the journal's retry state, so it is kept; only a failed build is retried after a change.
  const tasteFor = perProjectRevision(contentEvents, (project) => designOperation(async () => {
    let id: ReturnType<typeof tasteProjectId>;
    try { id = tasteProjectId(project.id); }
    catch { throw new DesignOperationError(designFailure('invalid', TASTE_OPEN, { reason: 'project-id' })); }
    return createProjectTasteContribution({ documents, projectId: id, sha256: webCryptoSha256, clock });
  }, TASTE_OPEN), KEEP);
  // Durable Imports: the real picker and store over the same bridge, linked into project content. The source argument
  // only serves the in-memory workspace. Documents not built on the bridge have no picker or store to offer.
  const importEnvs = new Map<string, ImportsEnv>();
  const importsFor = (project: ProjectContext, _syntheticSource?: () => ImportSource): ImportsEnv => {
    let env = importEnvs.get(project.id);
    if (!env) {
      const transport = bridgeTransportFor(documents);
      env = transport === null ? createUnavailableImportsEnv(clock)
        : createDurableImportsEnv({ transport, documents, repository, clock, contentEvents });
      importEnvs.set(project.id, env);
    }
    return env;
  };
  // The call behind Try again, Retry and Reload for reads. It marks the project's content as possibly changed: failed
  // builds (and a failed discovery) are built again on the next read, and healthy stateful values are kept.
  const retry = (projectId: string): void => contentEvents.notify(projectId);
  return { bridged: true as const, storageTag, contentEvents, retry, contentFor, projectsFor, componentsFor, flowsFor, compareFor, annotationsEnv,
    annotationSessionFor, canvasFor, discoveryEnv, tasteFor, importsFor };
}
