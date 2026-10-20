/**
 * The labelled, in-memory workspace the production entry composes over until the store adapters arrive.
 *
 * Nothing in this file is durable, networked or real. Every slice is built from the lanes' own labelled
 * fakes and synthetic fixtures, once per project id and kept for the page's lifetime, so a domain switch
 * remounts the real section views over the same in-memory state. When the STORE seam lands, integration
 * replaces the fake ports named here with adapters; the lane-facing shapes do not change.
 */
import type { ProjectContext } from '@hq/contracts';
import { arrangementKey, encodeArrangement } from '../../canvas/src/codec.ts';
import { addArtboard, addPlacement, emptyArrangement } from '../../canvas/src/arrangement.ts';
import {
  artboardId, canvasId, canvasItemId, isIdentifier, projectId as canvasProjectId, type CanvasId, type CanvasItemDescriptor,
  type IdPort as CanvasIdPort, type ProjectId as CanvasProjectId,
} from '../../canvas/src/contract.ts';
import { createFakeStorage as createFakeCanvasStorage } from '../../canvas/src/fakes.ts';
import { createProviderRegistry, type ProviderRegistry } from '../../canvas/src/providers.ts';
import { createComponentsCanvasProvider } from '../../components/src/review/canvas-provider.ts';
import { brandId as componentsBrandId } from '../../components/src/model/ids.ts';
import { webCryptoDigest } from '../../components/src/model/jcs.ts';
import { createMemoryStorage as createComponentsStorage } from '../../components/src/workspace/fakes.ts';
import { ComponentLibrary } from '../../components/src/workspace/library.ts';
import {
  SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM,
} from '../../components/src/fixtures.ts';
import type { ProjectId as ComponentsProjectId } from '../../components/src/contract.ts';
import { createCompareController, type CompareController } from '../../compare/src/controller.ts';
import {
  createFakeCaptureImages, createFakeCatalog as createFakeCompareCatalog, createFakePreview, createFakeStorage as createFakeCompareStorage,
  sampleCatalogData,
} from '../../compare/src/fakes.ts';
import { comparisonId, panelId, projectId as compareProjectId } from '../../compare/src/ids.ts';
import { createComparison, liveSource, staticSource } from '../../compare/src/model.ts';
import { presetById } from '../../compare/src/presets.ts';
import { AnnotationController, loadAnnotations } from '../../annotations/src/controller.ts';
import { annotationId, versionId as annotationVersionId, type SourceFrame, type VersionId as AnnotationVersionId } from '../../annotations/src/contract.ts';
import { FakeClipboard, MemoryAnnotationStore } from '../../annotations/src/fakes.ts';
import { FAKE_HOSTS, FakeClock as DiscoveryFakeClock, fixturePreview, fixtureSnapshot, MemoryCachePort } from '../../discovery/src/fakes.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../../discovery/src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../discovery/src/cache.ts';
import { DiscoveryService } from '../../discovery/src/discovery.ts';
import { isoFromMs, type HostId, type SourceEnrollment } from '../../discovery/src/contract.ts';
import { createFlowCanvasProvider } from '../../flows/src/canvas.ts';
import { createFakeFlowStorage } from '../../flows/src/fakes.ts';
import { parseFlow } from '../../flows/src/model.ts';
import { createFlowRepository } from '../../flows/src/repository.ts';
import { projectId as flowsProjectId, type FlowDocument } from '../../flows/src/contract.ts';
import { DEFAULT_TEST_NAMESPACES, FakeStoragePort } from '../../imports/src/fake-storage.ts';
import type { ImportsCapabilities } from '../../imports/src/controller.ts';
import type { ImportSource } from '../../imports/src/contract.ts';
import type { ImportDeps } from '../../imports/src/importer.ts';
import { addVersion, addView, type CaptureBinding, type ProjectContent } from '../../projects/src/content.ts';
import type { PreviewRef } from '../../projects/src/contract.ts';
import { createProjectsSection } from '../../projects/src/index.ts';
import { ProjectContentRepository } from '../../projects/src/repository.ts';
import { PROVISIONAL_REGISTRY_KEY, PROVISIONAL_REGISTRY_SCHEMA, createProvisionalLocalRegistry } from '../../projects/src/registry.ts';
import { versionId as projectsVersionId, viewId as projectsViewId } from '../../projects/src/ids.ts';
import { verifiedDataUrl } from '../../projects/src/loader.ts';
import {
  createFakeClock as createProjectsClock, createFakeThumbnailPort, createSpyStorage, previewRefFor, sequentialIds, syntheticPng,
} from '../../projects/fakes/index.ts';
import { createPreviewTaste } from '../../taste/preview/fake-client.ts';
import { createCachedCatalogReadPort, type CachedCatalogReadPort } from './catalog-read-port.ts';
import { createCanvasProviderAdapter, type CanvasProviderAdapter } from './canvas-adapter.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from './labels.ts';
import { bindFlowToProject, createProjectScreenPreviews, createProjectVersionsProvider, type FlowBindingReport, type ProjectScreenPreviews, type ProjectVersionsProvider } from './project-versions.ts';

/** Memoise one async build per project id; the same promise is returned on every call. */
function perProject<T>(create: (project: ProjectContext) => Promise<T>): (project: ProjectContext) => Promise<T> {
  const built = new Map<string, Promise<T>>();
  return (project) => {
    let value = built.get(project.id);
    if (value === undefined) { value = create(project); built.set(project.id, value); }
    return value;
  };
}

const randomId = (prefix: string): string => `${prefix}-${globalThis.crypto.randomUUID()}`;

// ------------------------------------------------------------ id grammar across lanes

const HEX_ID = /^p~[0-9a-f]+$/u;

/**
 * Canvas identifiers are narrower than shell project ids (`[A-Za-z0-9][A-Za-z0-9._:~-]{0,159}`). A shell
 * id that already fits is used unchanged; any other printable id maps to `p~` + the hex of its UTF-8 bytes,
 * which is reversible and cannot collide with a plain id (`~` never starts one). Ids too long to encode
 * return null and the canvas section says so, rather than truncating and risking two projects sharing one.
 */
export function canvasProjectIdFor(shellProjectId: string): CanvasProjectId | null {
  if (isIdentifier(shellProjectId) && !HEX_ID.test(shellProjectId)) return canvasProjectId(shellProjectId);
  const hex = Array.from(new TextEncoder().encode(shellProjectId), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const encoded = `p~${hex}`;
  return isIdentifier(encoded) ? canvasProjectId(encoded) : null;
}

/** Inverse of `canvasProjectIdFor`: the shell project id a canvas project id stands for. */
export function shellProjectIdFor(canvasProject: CanvasProjectId): string {
  if (!HEX_ID.test(canvasProject)) return canvasProject;
  const hex = canvasProject.slice(2);
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  return new TextDecoder().decode(bytes);
}

// --------------------------------------------------------------------- projects (T2)

export interface ProjectContentEnv {
  readonly tag: typeof FAKE_TAG;
  readonly storage: ReturnType<typeof createSpyStorage>;
  readonly thumbnails: ReturnType<typeof createFakeThumbnailPort>;
  readonly clock: ReturnType<typeof createProjectsClock>;
  readonly repository: ProjectContentRepository;
  readonly content: ProjectContent;
}

/** Two desktop views with versions, and two mobile screens. All synthetic, each bound to a synthetic capture digest. */
export const contentFor = perProject(async (project): Promise<ProjectContentEnv> => {
  const storage = createSpyStorage();
  const thumbnails = createFakeThumbnailPort();
  const clock = createProjectsClock();
  const repository = new ProjectContentRepository(storage, clock);
  let seed = 10;
  const capture = async (route: string, viewport: { w: number; h: number; dpr: number }, revision: string) => {
    const thumbnail = await previewRefFor(syntheticPng(seed), 'image/png', 32, 20);
    thumbnails.add(thumbnail, syntheticPng(seed));
    const captureDigest = (await previewRefFor(syntheticPng(seed + 500))).digest;
    seed += 1;
    return { thumbnail, binding: { route, viewport, sourceRevision: revision, captureDigest } };
  };
  const desktop = { w: 1280, h: 800, dpr: 1 };
  const mobile = { w: 390, h: 844, dpr: 3 };
  const plan = [
    { view: 'home', title: 'Home', kind: 'page' as const, versions: [['v1', 'Version 1', '/home', desktop], ['v2', 'Version 2', '/home', desktop]] as const },
    { view: 'pricing', title: 'Pricing', kind: 'page' as const, versions: [['v1', 'Version 1', '/pricing', desktop]] as const },
    { view: 'cart', title: 'Cart (mobile)', kind: 'screen' as const, versions: [['v1', 'Version 1', '/cart', mobile]] as const },
    { view: 'checkout', title: 'Checkout (mobile)', kind: 'screen' as const, versions: [['v1', 'Version 1', '/checkout', mobile]] as const },
  ];
  const planned: { entry: (typeof plan)[number]; tag: string; label: string; thumbnail: PreviewRef; binding: CaptureBinding }[] = [];
  for (const entry of plan) {
    for (const [tag, label, route, viewport] of entry.versions) planned.push({ entry, tag, label, ...(await capture(route, viewport, `synthetic-rev-${tag}`)) });
  }
  const { content } = await repository.update(project.id as ProjectContent['projectId'], (initial, now) => {
    let next = initial;
    for (const entry of plan) next = addView(next, { id: projectsViewId(`${project.id}-${entry.view}`), title: entry.title, kind: entry.kind }, now);
    for (const item of planned) {
      next = addVersion(next, {
        id: projectsVersionId(`${project.id}-${item.entry.view}-${item.tag}`), viewId: projectsViewId(`${project.id}-${item.entry.view}`),
        label: item.label, capture: item.binding, thumbnail: item.thumbnail, origin: 'synthetic-fixture',
      }, now);
    }
    return next;
  });
  return { tag: FAKE_TAG, storage, thumbnails, clock, repository, content };
});

// ---------------------------------------------------------- discovery (T15) -> projects

const NOW = Date.UTC(2026, 9, 20, 12);
const HOSTS: readonly (readonly [HostId, string])[] = [[FAKE_HOSTS.laptop, 'Laptop (synthetic)'], [FAKE_HOSTS.studio, 'Studio (synthetic)']];

export interface DiscoveryEnv {
  readonly cache: MemoryCachePort;
  readonly clock: DiscoveryFakeClock;
  /** No adapter is registered and refresh-on-open is off: the service can only show the cached catalog. */
  readonly service: DiscoveryService;
  readonly adapterLabels: Readonly<Record<string, { readonly label: string; readonly fake: boolean }>>;
  /** The Projects read port over the same cache document. It never writes the cache. */
  readonly readPort: CachedCatalogReadPort;
}

let discovery: Promise<DiscoveryEnv> | null = null;
export function discoveryEnv(): Promise<DiscoveryEnv> {
  discovery ??= (async () => {
    const cache = new MemoryCachePort();
    let catalog = EMPTY_CATALOG;
    for (const [host] of HOSTS) {
      const projects = await Promise.all(Array.from({ length: 8 }, async (_, index) => ({
        path: `p${String(index).padStart(3, '0')}`,
        name: `Source project ${host.slice(5, 9)} ${String(index).padStart(3, '0')}`,
        previews: [(await fixturePreview(`${host}-${index}`)).ref],
      })));
      const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
      if (!parsed.ok) throw new Error('synthetic discovery snapshot failed to parse');
      catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 60 * 60_000) }).state;
    }
    cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
    const enrollments: SourceEnrollment[] = HOSTS.map(([hostId, label]) => ({ hostId, label, adapterKey: 'fake', enrolledAt: isoFromMs(NOW) }));
    const clock = new DiscoveryFakeClock(NOW);
    const service = new DiscoveryService({ adapters: {}, enrollments, cache, clock, refreshOnOpen: false });
    const readPort = createCachedCatalogReadPort({
      cache, hostLabels: Object.fromEntries(HOSTS), dataTag: SYNTHETIC_TAG, provenance: 'synthetic fixture cache (no source adapter registered)',
    });
    await readPort.load();
    return { cache, clock, service, adapterLabels: { fake: { label: 'Synthetic fake source', fake: true } }, readPort };
  })();
  return discovery;
}

export const projectsFor = perProject(async (project) => {
  const env = await contentFor(project);
  const { readPort } = await discoveryEnv();
  env.storage.seed('workspace', PROVISIONAL_REGISTRY_KEY, {
    schema: PROVISIONAL_REGISTRY_SCHEMA, projects: [{ id: project.id, name: project.name, createdAt: env.clock.now() }],
  });
  const ids = sequentialIds(`compose-${project.id}`);
  const registry = createProvisionalLocalRegistry({ storage: env.storage, clock: env.clock, ids });
  const { controller, ready } = createProjectsSection({ registry, storage: env.storage, thumbnails: env.thumbnails, catalog: readPort, clock: env.clock, ids });
  await ready;
  return controller;
});

// ------------------------------------------------------------------ components (T10)

export const componentsFor = perProject(async (project) => {
  const library = new ComponentLibrary(createComponentsStorage(), webCryptoDigest);
  const button = await library.saveSource(SYNTHETIC_BUTTON);
  await library.saveVariants(button, { componentId: button.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  const study = await library.saveMotionStudy(SYNTHETIC_MOTION);
  await library.setProjectMembership({
    projectId: componentsBrandId('ProjectId', project.id), components: [{ componentId: card.componentId, revision: 1 }], studies: [{ studyId: study.id, revision: 1 }],
  });
  return library;
});

// --------------------------------------------------------------------- flows (T11)

export interface FlowsEnv {
  readonly repository: ReturnType<typeof createFlowRepository>;
  readonly flow: FlowDocument;
  readonly binding: FlowBindingReport;
  readonly previews: ProjectScreenPreviews;
  readonly warm: { readonly loaded: number; readonly failed: readonly string[] };
}

export const flowsFor = perProject(async (project): Promise<FlowsEnv> => {
  const env = await contentFor(project);
  const version = (view: string) => env.content.versions.find((item) => item.viewId === `${project.id}-${view}`)!;
  const screen = (id: string, title: string, view: string) => {
    const bound = version(view);
    return { id, title, versionId: bound.id, route: bound.capture.route, state: 'default', viewport: bound.capture.viewport, captureDigest: bound.capture.captureDigest };
  };
  const rect = { x: 115, y: 760, width: 160, height: 48 };
  const parsed = parseFlow({
    schema: 'hq.design.flow/v1', id: `${project.id}-checkout-flow`, projectId: project.id, title: 'Checkout (synthetic)', platform: 'web', start: 'cart',
    routes: [{ route: '/cart', states: ['default'] }, { route: '/checkout', states: ['default'] }],
    screens: [screen('cart', 'Cart', 'cart'), screen('checkout', 'Checkout', 'checkout')],
    hotspots: [
      { id: 'h-checkout', screenId: 'cart', label: 'Checkout', rect, transition: { target: { kind: 'screen', screenId: 'checkout' }, animation: 'push', durationMs: 250 } },
      { id: 'h-back', screenId: 'checkout', label: 'Back', rect: { x: 8, y: 40, width: 64, height: 44 }, transition: { target: { kind: 'back' }, animation: 'pop', durationMs: 250 } },
    ],
  });
  if (!parsed.ok) throw new Error(`synthetic flow failed to parse: ${parsed.errors.join('; ')}`);
  const repository = createFlowRepository(createFakeFlowStorage());
  await repository.save(parsed.flow);
  const previews = createProjectScreenPreviews({ thumbnails: env.thumbnails, tag: FAKE_TAG });
  const warm = await previews.warm(parsed.flow, env.content);
  return { repository, flow: parsed.flow, binding: bindFlowToProject(parsed.flow, env.content), previews, warm };
});

// -------------------------------------------------------------------- canvas (T3)

export interface CanvasEnv {
  readonly projectId: CanvasProjectId;
  readonly canvasId: CanvasId;
  readonly storage: ReturnType<typeof createFakeCanvasStorage>;
  readonly registry: ProviderRegistry;
  readonly ids: CanvasIdPort;
  readonly adapters: readonly CanvasProviderAdapter[];
}

export const canvasFor = perProject(async (project): Promise<CanvasEnv | null> => {
  const cid = canvasProjectIdFor(project.id);
  if (cid === null) return null;
  const env = await contentFor(project);
  const library = await componentsFor(project);
  const flows = await flowsFor(project);
  const versions: ProjectVersionsProvider = createProjectVersionsProvider({ repository: env.repository, storageTag: FAKE_TAG, toContentProject: shellProjectIdFor });
  const components = createCanvasProviderAdapter({
    source: createComponentsCanvasProvider({ library, digest: webCryptoDigest, designSystemId: null }),
    label: 'Components', tag: SYNTHETIC_TAG, toSourceProject: (id): ComponentsProjectId => componentsBrandId('ProjectId', shellProjectIdFor(id)),
  });
  const flowsAdapter = createCanvasProviderAdapter({
    source: createFlowCanvasProvider(flows.repository), label: 'Flows', tag: FAKE_TAG, toSourceProject: (id) => flowsProjectId(shellProjectIdFor(id)),
  });
  await versions.refresh(cid);
  await components.refresh(cid);
  await flowsAdapter.refresh(cid);
  const registry = createProviderRegistry();
  for (const provider of [versions, flowsAdapter, components]) registry.register(provider);

  const canvas = canvasId(`${cid}-canvas`);
  let arrangement = emptyArrangement(canvas, cid);
  arrangement = addArtboard(arrangement, { id: artboardId('board-main'), name: 'Overview', frame: { x: 40, y: 40, width: 1400, height: 760 } });
  const picked: CanvasItemDescriptor[] = [
    ...versions.list(cid).slice(0, 3),
    ...flowsAdapter.list(cid).filter((item) => item.kind === 'flow-map'),
    ...components.list(cid).slice(0, 1),
  ];
  picked.forEach((item, index) => {
    arrangement = addPlacement(arrangement, {
      id: canvasItemId(`item-${index + 1}`), ref: item.ref,
      frame: { x: 80 + (index % 3) * 440, y: 80 + Math.floor(index / 3) * 340, width: Math.min(item.intrinsicSize.width, 400), height: Math.min(item.intrinsicSize.height, 300) },
    });
  });
  return {
    projectId: cid, canvasId: canvas, registry, adapters: [flowsAdapter, components],
    storage: createFakeCanvasStorage({ [arrangementKey(canvas)]: encodeArrangement(arrangement) }),
    ids: { next: (kind) => randomId(kind) },
  };
});

// ----------------------------------------------------- compare (T4) and annotations (T5)

const compareControllers = new Map<string, CompareController>();

/** One controller per project, kept so panel widths and links survive remounts. Compare's own labelled fake catalog and previews. */
export function compareFor(project: ProjectContext): CompareController {
  const existing = compareControllers.get(project.id);
  if (existing) return existing;
  const data = sampleCatalogData();
  const version = (id: string) => {
    const found = data.versions.find((item) => item.versionId === id);
    if (!found) throw new Error(`synthetic compare catalog lacks ${id}`);
    return found;
  };
  const phone = presetById('phone')!.viewport;
  const controller = createCompareController(createComparison(comparisonId(`${project.id}-compare`), compareProjectId(project.id), [
    { id: panelId('a'), role: 'baseline', source: staticSource(version('home-v1').captures[0]!), viewport: phone, width: 380 },
    { id: panelId('b'), role: 'candidate', source: staticSource(version('home-v2').captures[0]!), viewport: phone, width: 420 },
    { id: panelId('c'), source: liveSource(version('pricing-v1')), viewport: phone, width: 320 },
  ]), {
    catalog: createFakeCompareCatalog(data), preview: createFakePreview({ pages: (id) => (id === 'pricing-v1' ? 2 : 3) }),
    captures: createFakeCaptureImages(), storage: createFakeCompareStorage(),
  });
  compareControllers.set(project.id, controller);
  return controller;
}

/** Annotation controllers keyed by exact version id, over one in-memory store. Marks never cross versions. */
export interface AnnotationsEnv {
  readonly store: MemoryAnnotationStore;
  controllerFor(version: AnnotationVersionId): Promise<AnnotationController>;
}

let annotations: AnnotationsEnv | null = null;
export function annotationsEnv(): AnnotationsEnv {
  if (annotations) return annotations;
  const store = new MemoryAnnotationStore();
  const controllers = new Map<string, Promise<AnnotationController>>();
  annotations = {
    store,
    controllerFor(version) {
      let controller = controllers.get(version);
      if (!controller) {
        controller = loadAnnotations(store, version).then((loaded) => new AnnotationController(loaded, {
          ids: { adapter: 'fake', next: () => annotationId(randomId('ann')) }, clipboard: new FakeClipboard(), store,
        }));
        controllers.set(version, controller);
      }
      return controller;
    },
  };
  return annotations;
}

export interface AnnotationTarget {
  readonly version: AnnotationVersionId;
  readonly frame: SourceFrame;
  /** Verified thumbnail of the version, or null when it has none. A thumbnail, not the capture. */
  readonly thumbnailUrl: string | null;
}

/** The project's first home version, with the route, viewport and capture digest it is pinned to. */
export const annotationTargetFor = perProject(async (project): Promise<AnnotationTarget> => {
  const env = await contentFor(project);
  const version = env.content.versions.find((item) => item.viewId === `${project.id}-home`)!;
  const ref = version.thumbnail;
  const thumbnailUrl = ref ? await verifiedDataUrl(ref, await env.thumbnails.readThumbnail(ref, new AbortController().signal), 2 * 1024 * 1024) : null;
  const id = annotationVersionId(version.id);
  const frame: SourceFrame = {
    versionId: id, route: version.capture.route, state: 'default', viewport: version.capture.viewport, scroll: { x: 0, y: 0 },
    captureDigest: version.capture.captureDigest ?? '',
  };
  return { version: id, frame, thumbnailUrl };
});

/** The target plus its controller with the frame already set, memoised so React can suspend on one promise. */
export const annotationSessionFor = perProject(async (project) => {
  const target = await annotationTargetFor(project);
  const controller = await annotationsEnv().controllerFor(target.version);
  controller.setFrame(target.frame);
  return { target, controller };
});

// ----------------------------------------------------------------- taste (T7), imports (T13)

let taste: ReturnType<typeof createPreviewTaste> | null = null;
export const tasteEnv = () => (taste ??= createPreviewTaste());

export interface ImportsEnv {
  readonly deps: ImportDeps;
  readonly capabilities: ImportsCapabilities;
}

const importEnvs = new Map<string, ImportsEnv>();
export function importsFor(project: ProjectContext, syntheticSource: () => ImportSource): ImportsEnv {
  const existing = importEnvs.get(project.id);
  if (existing) return existing;
  const env: ImportsEnv = {
    deps: { storage: new FakeStoragePort(DEFAULT_TEST_NAMESPACES), clock: { now: () => new Date().toISOString() } },
    capabilities: { pickSource: async () => syntheticSource() },
  };
  importEnvs.set(project.id, env);
  return env;
}
