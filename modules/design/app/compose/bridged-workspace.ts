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
import { annotationId, versionId as annotationVersionId } from '../../annotations/src/contract.ts';
import type { VersionId } from '../../annotations/src/contract.ts';
import { FakeClipboard } from '../../annotations/src/fakes.ts';
import { canvasId } from '../../canvas/src/contract.ts';
import { createProviderRegistry } from '../../canvas/src/providers.ts';
import { createCanvasProviderAdapter } from './canvas-adapter.ts';
import { createProjectVersionsProvider } from './project-versions.ts';
import { canvasProjectIdFor, shellProjectIdFor, tasteEnv, importsFor } from './fake-workspace.ts';
import { createBridgedDiscovery } from './bridged-discovery.ts';
import { createWorkspaceThumbnailPort } from './thumbnail-port.ts';
import type { EvidenceTag } from './labels.ts';

function perProject<T>(build: (project: ProjectContext) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (project: ProjectContext): Promise<T> => {
    let result = cache.get(project.id);
    if (!result) { result = build(project); cache.set(project.id, result); }
    return result;
  };
}

export function createBridgedWorkspace(documents: WorkspaceDocuments & Partial<Pick<WorkspaceRecords, 'getBlob'>>) {
  const storageTag: EvidenceTag = Object.freeze({ status: 'workspace', text: DEVICE_STORAGE_LABEL });
  const clock = { now: () => new Date().toISOString() };
  const ids = { next: (kind: 'project' | 'view' | 'version') => `${kind}-${globalThis.crypto.randomUUID()}` };
  let discovery: ReturnType<typeof createBridgedDiscovery> | undefined;
  const discoveryEnv = () => discovery ??= createBridgedDiscovery();
  const projectStorage = createProjectsStorage(documents);
  const repository = new ProjectContentRepository(projectStorage, clock);
  const thumbnails = createWorkspaceThumbnailPort(documents);
  const contentFor = perProject(async (project) => {
    const loaded = await repository.load(projectId(project.id));
    if (loaded.status !== 'ok') throw new Error(`Project content unavailable: ${loaded.status}`);
    return { repository, content: loaded.content, storage: projectStorage, clock, thumbnails, tag: storageTag };
  });
  const projectsFor = perProject(async (_project) => {
    const { readPort } = await discoveryEnv();
    const registry = createProvisionalLocalRegistry({ storage: projectStorage, clock, ids });
    const { controller, ready } = createProjectsSection({ registry: { ...registry, provenance: { kind: 'provisional-local', label: 'Projects saved on this device' } }, storage: projectStorage, thumbnails, catalog: readPort, clock, ids });
    await ready;
    return controller;
  });
  const componentsFor = perProject(async () => new ComponentLibrary(createComponentsStorage(documents), webCryptoDigest));
  const flowRepository = createFlowRepository(createFlowsStorage(documents));
  // Preview captures are stored under their capture digest; document-only bridges have no capture images.
  const getBlob = documents.getBlob?.bind(documents);
  const readCapture = getBlob ? (digest: string) => getBlob(digest) : null;
  const flowsFor = perProject(async (project) => ({ repository: flowRepository, flows: await flowRepository.listForProject(flowProjectId(project.id)), readCapture }));
  const compareFor = perProject(async (project) => {
    const storage = createCompareStorage(documents);
    const id = comparisonId(`${project.id}-compare`);
    const loaded = await loadComparison(storage, id);
    if (loaded.status !== 'ok' && loaded.status !== 'missing') throw new Error(`Comparison unavailable: ${loaded.status}`);
    return createCompareController(loaded.status === 'ok' ? loaded.state : createComparison(id, compareProjectId(project.id), []), {
      storage,
      catalog: { async listViews() { return []; }, async getVersion() { return null; }, async listVersions() { return []; } },
    });
  });
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
  const annotationSessionFor = perProject(async (project) => {
    const { content } = await contentFor(project);
    const version = content.versions[0];
    if (!version) return null;
    const id = annotationVersionId(version.id);
    const target = { version: id, thumbnailUrl: null, frame: {
      versionId: id, route: version.capture.route, state: 'default', viewport: version.capture.viewport,
      scroll: { x: 0, y: 0 }, captureDigest: version.capture.captureDigest ?? '',
    } };
    const controller = await annotationsEnv().controllerFor(id);
    controller.setFrame(target.frame);
    return { target, controller };
  });
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
    for (const adapter of [components, flows]) {
      const report = await adapter.refresh(cid);
      sourceErrors.push(...report.errors.map((error) => `${adapter.label}: ${error}`));
    }
    const registry = createProviderRegistry();
    for (const provider of [versions, components, flows]) registry.register(provider);
    return { projectId: cid, canvasId: canvasId(`${cid}-canvas`), storage: createCanvasStorage(documents), registry,
      ids: { next: (kind: string) => `${kind}-${globalThis.crypto.randomUUID()}` }, adapters: [components, flows], sourceErrors };
  });
  return { bridged: true as const, storageTag, contentFor, projectsFor, componentsFor, flowsFor, compareFor, annotationsEnv,
    annotationSessionFor, canvasFor, discoveryEnv, tasteEnv, importsFor };
}
