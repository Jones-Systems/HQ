/** Durable section composition. Construction and navigation never seed workspace documents. */
import type { ProjectContext } from '@hq/contracts';
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
import { canvasProjectIdFor, shellProjectIdFor, importsFor } from './fake-workspace.ts';
import { createBridgedDiscovery } from './bridged-discovery.ts';
import { createWorkspaceThumbnailPort } from './thumbnail-port.ts';
import { createProjectCompareCatalog } from './compare-catalog.ts';
import type { EvidenceTag } from './labels.ts';
import { createProjectContentEvents, type ProjectContentEvents } from './content-events.ts';
import { perProjectRevision } from './revision-cache.ts';
import { designFailure, designOperation, DesignOperationError, type DesignFailureContext } from './errors.ts';
import { ANNOTATIONS_OPEN, openAnnotationSession } from './annotation-session.ts';
import type { LoadedContent } from '../../projects/src/repository.ts';

function perProject<T>(build: (project: ProjectContext) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (project: ProjectContext): Promise<T> => {
    let result = cache.get(project.id);
    if (!result) { result = build(project); cache.set(project.id, result); }
    return result;
  };
}

/** Operation names are part of the backend contract (BACKEND-CONTRACT.md); views show them in the toast meta line. */
const PROJECTS_LOAD: DesignFailureContext = { section: 'projects', operation: 'projects.load', action: 'load the project' };
const FLOWS_LOAD: DesignFailureContext = { section: 'flows', operation: 'flows.load', action: 'load the flows' };
const COMPARE_LOAD: DesignFailureContext = { section: 'compare', operation: 'compare.load', action: 'open the comparison' };
const TASTE_LOAD: DesignFailureContext = { section: 'taste', operation: 'taste.load', action: 'open taste' };

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
  const discoveryEnv = () => discovery ??= createBridgedDiscovery();
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
  const projectsFor = perProject(async (_project) => {
    const { readPort } = await discoveryEnv();
    const registry = createProvisionalLocalRegistry({ storage: projectStorage, clock, ids });
    const { controller, ready } = createProjectsSection({ registry: { ...registry, provenance: { kind: 'provisional-local', label: 'Projects saved on this device' } }, storage: projectStorage, thumbnails, catalog: readPort, clock, ids,
      // Edits made in Projects reach every other reader of the project (Annotations, Compare, Taste, Requests).
      onContentChange: (changed) => contentEvents.notify(changed) });
    await ready;
    contentEvents.subscribeAll((changed) => {
      let id: ReturnType<typeof projectId>;
      try { id = projectId(changed); } catch { return; }
      void controller.refreshContent(id).catch(() => undefined);
    });
    return controller;
  });
  const componentsFor = perProject(async () => new ComponentLibrary(createComponentsStorage(documents), webCryptoDigest));
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
    contentEvents.subscribe(project.id, () => { void controller.refreshVersions().catch(() => undefined); });
    return controller;
  }, COMPARE_LOAD), { onChange: 'keep' });
  const store = createAnnotationsStorage(documents);
  const annotationControllers = new Map<string, Promise<AnnotationController>>();
  const annotationsEnv = () => ({
    store,
    controllerFor(version: VersionId) {
      let controller = annotationControllers.get(version);
      if (!controller) {
        controller = loadAnnotations(store, version).then((loaded) => new AnnotationController(loaded, {
          store, clipboard: new FakeClipboard(), ids: { adapter: 'real', next: () => annotationId(`ann-${globalThis.crypto.randomUUID()}`) },
        }));
        annotationControllers.set(version, controller);
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
  const canvasFor = perProject(async (project) => {
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
    try { await versions.refresh(cid); } catch { sourceErrors.push('Project views unavailable'); }
    // The provider tells the registry when it refreshes, so Canvas lists versions saved later without being rebuilt.
    contentEvents.subscribe(project.id, () => { void versions.refresh(cid).catch(() => undefined); });
    for (const adapter of [components, flows]) {
      const report = await adapter.refresh(cid);
      sourceErrors.push(...report.errors.map((error) => `${adapter.label}: ${error}`));
    }
    const registry = createProviderRegistry();
    for (const provider of [versions, components, flows]) registry.register(provider);
    return { projectId: cid, canvasId: canvasId(`${cid}-canvas`), storage: createCanvasStorage(documents), registry,
      ids: { next: (kind: string) => `${kind}-${globalThis.crypto.randomUUID()}` }, adapters: [components, flows], sourceErrors };
  });
  // The client holds the journal's retry state, so it is kept; only a failed build is retried after a change.
  const tasteFor = perProjectRevision(contentEvents, (project) => designOperation(async () => {
    let id: ReturnType<typeof tasteProjectId>;
    try { id = tasteProjectId(project.id); }
    catch { throw new DesignOperationError(designFailure('invalid', TASTE_LOAD, { reason: 'project-id' })); }
    return createProjectTasteContribution({ documents, projectId: id, sha256: webCryptoSha256, clock });
  }, TASTE_LOAD), { onChange: 'keep' });
  return { bridged: true as const, storageTag, contentEvents, contentFor, projectsFor, componentsFor, flowsFor, compareFor, annotationsEnv,
    annotationSessionFor, canvasFor, discoveryEnv, tasteFor, importsFor };
}
