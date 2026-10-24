/**
 * Projects controller: composes the injected ports with the pure session,
 * content and gallery models, and exposes an external-store snapshot for React.
 *
 * Rendering reads only in-memory state. Registry, catalog, summaries and
 * thumbnails fill in asynchronously; a late result for a project that is no
 * longer active fills that project's local copy but never replaces the
 * visible project. Navigation performs no storage writes.
 */
import {
  StorageConflictError, systemClock, type CatalogEntryView, type CatalogReadPort, type ClockPort, type ProjectRecord,
  type ProjectRegistryPort, type ProjectStoragePort, type RegistryProvenance, type ThumbnailPort,
} from './contract.ts';
import {
  addVersion, addView, linkSource, renameView, summarize, unlinkSource,
  type NewVersion, type ProjectContent, type ProjectSummary, type ViewKind,
} from './content.ts';
import { buildGalleryItems, queryGallery, type GalleryFilters, type GalleryGroup } from './gallery.ts';
import { randomIdFactory, versionId, viewId, type IdFactory, type ProjectId, type SourceProjectId, type VersionId, type ViewId } from './ids.ts';
import { createThumbnailLoader, LazyLoader, type Priority, type ThumbnailLoader } from './loader.ts';
import { ProjectContentRepository } from './repository.ts';
import {
  INITIAL_SESSION, parseDestination, reduceSession, toDestination,
  type DetailFilters, type SessionAction, type SessionState,
} from './session.ts';

export interface ProjectsLimits {
  readonly thumbnailConcurrency: number;
  readonly summaryConcurrency: number;
  readonly maxThumbnailBytes: number;
  readonly retainThumbnails: number;
  readonly retainSummaries: number;
}

export const DEFAULT_LIMITS: ProjectsLimits = Object.freeze({
  thumbnailConcurrency: 6, summaryConcurrency: 4, maxThumbnailBytes: 2 * 1024 * 1024, retainThumbnails: 200, retainSummaries: 1000,
});

export interface ProjectsPorts {
  readonly registry: ProjectRegistryPort;
  readonly storage: ProjectStoragePort;
  readonly thumbnails: ThumbnailPort;
  readonly catalog?: CatalogReadPort;
  readonly clock?: ClockPort;
  readonly ids?: IdFactory;
  readonly limits?: Partial<ProjectsLimits>;
  readonly initialSession?: SessionState;
  /** Reports the opaque shell destination after local navigation. Never dispatches work. */
  readonly onDestination?: (destination: string) => void;
}

export type ActiveProject =
  | { readonly status: 'loading'; readonly projectId: ProjectId; readonly record?: ProjectRecord }
  | { readonly status: 'ready'; readonly projectId: ProjectId; readonly record?: ProjectRecord; readonly content: ProjectContent }
  | { readonly status: 'read-only'; readonly projectId: ProjectId; readonly record?: ProjectRecord; readonly reason: string }
  | { readonly status: 'error'; readonly projectId: ProjectId; readonly record?: ProjectRecord; readonly reason: string };

export interface ProjectsSnapshot {
  readonly session: SessionState;
  readonly registry: {
    readonly status: 'loading' | 'ready' | 'error';
    readonly provenance: RegistryProvenance;
    readonly projects: readonly ProjectRecord[];
    readonly error?: string;
  };
  readonly catalog: readonly CatalogEntryView[];
  readonly summaries: ReadonlyMap<ProjectId, ProjectSummary>;
  readonly gallery: readonly GalleryGroup[];
  readonly active: ActiveProject | null;
  readonly edit: { readonly status: 'idle' | 'saving' | 'error'; readonly message?: string };
}

export type EditResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

interface CachedContent { readonly content: ProjectContent; readonly revision: string | null; readonly seq: number }

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class ProjectsController {
  readonly thumbnails: ThumbnailLoader;
  readonly #ports: ProjectsPorts;
  readonly #ids: IdFactory;
  readonly #repository: ProjectContentRepository;
  readonly #summaryLoader: LazyLoader<ProjectSummary>;
  readonly #listeners = new Set<() => void>();
  readonly #content = new Map<ProjectId, CachedContent>();
  readonly #unavailable = new Map<ProjectId, { readonly status: 'read-only' | 'error'; readonly reason: string }>();
  readonly #inflight = new Map<ProjectId, Promise<void>>();
  #seq = 0;
  #snapshot: ProjectsSnapshot;
  #galleryInputs: readonly unknown[] = [];
  #unsubscribeCatalog: (() => void) | null = null;
  #disposed = false;

  constructor(ports: ProjectsPorts) {
    this.#ports = ports;
    this.#ids = ports.ids ?? randomIdFactory;
    const limits = { ...DEFAULT_LIMITS, ...ports.limits };
    this.#repository = new ProjectContentRepository(ports.storage, ports.clock ?? systemClock);
    this.thumbnails = createThumbnailLoader(ports.thumbnails, {
      concurrency: limits.thumbnailConcurrency, retain: limits.retainThumbnails, maxBytesPerItem: limits.maxThumbnailBytes,
    });
    this.#summaryLoader = new LazyLoader({ concurrency: limits.summaryConcurrency, retain: limits.retainSummaries });
    this.#snapshot = {
      session: ports.initialSession ?? INITIAL_SESSION,
      registry: { status: 'loading', provenance: ports.registry.provenance, projects: [] },
      catalog: ports.catalog?.current() ?? [],
      summaries: new Map(),
      gallery: [],
      active: null,
      edit: { status: 'idle' },
    };
    this.#snapshot = this.#derive(this.#snapshot);
  }

  // ----------------------------------------------------- external store

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): ProjectsSnapshot => this.#snapshot;

  #set(change: Partial<ProjectsSnapshot>): void {
    if (this.#disposed) return;
    const previous = this.#snapshot;
    this.#snapshot = this.#derive({ ...previous, ...change });
    const before = previous.session;
    const after = this.#snapshot.session;
    for (const listener of [...this.#listeners]) listener();
    if (before.screen !== after.screen || before.activeProjectId !== after.activeProjectId) this.#ports.onDestination?.(toDestination(after));
  }

  #derive(snapshot: ProjectsSnapshot): ProjectsSnapshot {
    const { session, registry, summaries, catalog } = snapshot;
    const inputs = [registry.projects, summaries, catalog, session.gallery.filters, session.gallery.collapsedGroups];
    let gallery = snapshot.gallery;
    if (inputs.some((input, index) => input !== this.#galleryInputs[index])) {
      const links = new Map<SourceProjectId, ProjectId[]>();
      for (const summary of summaries.values()) {
        for (const source of summary.linkedSources) links.set(source, [...(links.get(source) ?? []), summary.projectId]);
      }
      gallery = queryGallery(buildGalleryItems({ projects: registry.projects, summaries, catalog, links }),
        session.gallery.filters, new Set(session.gallery.collapsedGroups));
      this.#galleryInputs = inputs;
    }
    return { ...snapshot, gallery, active: this.#active(session, registry.projects) };
  }

  #active(session: SessionState, projects: readonly ProjectRecord[]): ActiveProject | null {
    const project = session.screen === 'project' ? session.activeProjectId : null;
    if (!project) return null;
    const found = projects.find((candidate) => candidate.id === project);
    const record = found ? { record: found } : {};
    const cached = this.#content.get(project);
    if (cached) return { status: 'ready', projectId: project, ...record, content: cached.content };
    const unavailable = this.#unavailable.get(project);
    if (unavailable) return { status: unavailable.status, projectId: project, ...record, reason: unavailable.reason };
    return { status: 'loading', projectId: project, ...record };
  }

  // -------------------------------------------------------- lifecycle

  /** Starts background registry load and catalog subscription; rendering does not wait for either. */
  start(): Promise<void> {
    this.#unsubscribeCatalog ??= this.#ports.catalog?.subscribe(() => this.#set({ catalog: this.#ports.catalog?.current() ?? [] })) ?? null;
    const active = this.#snapshot.session.activeProjectId;
    if (this.#snapshot.session.screen === 'project' && active) void this.#load(active);
    return this.refreshRegistry();
  }

  dispose(): void {
    this.#unsubscribeCatalog?.();
    this.#unsubscribeCatalog = null;
    this.#listeners.clear();
    this.#disposed = true;
  }

  async refreshRegistry(): Promise<void> {
    try {
      const projects = await this.#ports.registry.list();
      this.#set({ registry: { status: 'ready', provenance: this.#ports.registry.provenance, projects } });
    } catch (error) {
      const registry = this.#snapshot.registry;
      // A failed refresh keeps the last listed projects visible.
      this.#set({ registry: { ...registry, status: 'error', error: message(error) } });
    }
  }

  // ------------------------------------------------------- navigation

  dispatch(action: SessionAction): void {
    const session = reduceSession(this.#snapshot.session, action);
    if (session !== this.#snapshot.session) this.#set({ session });
  }

  openProject(project: ProjectId): void {
    this.dispatch({ type: 'open-project', projectId: project });
    if (!this.#content.has(project)) void this.#load(project);
  }

  backToGallery(): void { this.dispatch({ type: 'back-to-gallery' }); }

  /** Applies a shell destination; unknown destinations are ignored rather than reinterpreted. */
  applyDestination(destination: string): void {
    const parsed = parseDestination(destination);
    if (!parsed) return;
    if (parsed.screen === 'gallery') this.backToGallery(); else this.openProject(parsed.projectId);
  }

  select(view: ViewId | null, version: VersionId | null): void { this.dispatch({ type: 'select', viewId: view, versionId: version }); }
  setDetailFilters(filters: Partial<DetailFilters>): void { this.dispatch({ type: 'set-detail-filters', filters }); }
  toggleView(view: ViewId): void { this.dispatch({ type: 'toggle-view', viewId: view }); }
  setDetailScroll(x: number, y: number): void { this.dispatch({ type: 'set-detail-scroll', x, y }); }
  setGalleryFilters(filters: Partial<GalleryFilters>): void { this.dispatch({ type: 'set-gallery-filters', filters }); }
  toggleGroup(key: string): void { this.dispatch({ type: 'toggle-group', key }); }
  setGalleryScroll(y: number): void { this.dispatch({ type: 'set-gallery-scroll', y }); }

  // ---------------------------------------------------- content loading

  #remember(content: ProjectContent, revision: string | null, seq: number): void {
    const existing = this.#content.get(content.projectId);
    if (existing && existing.seq > seq) return;
    this.#content.set(content.projectId, { content, revision, seq });
    this.#unavailable.delete(content.projectId);
    const summaries = new Map(this.#snapshot.summaries);
    summaries.set(content.projectId, summarize(content));
    this.#set({ summaries });
  }

  #load(project: ProjectId): Promise<void> {
    const pending = this.#inflight.get(project);
    if (pending) return pending;
    const seq = ++this.#seq;
    const run = this.#repository.load(project).then((loaded) => {
      if (loaded.status === 'ok') this.#remember(loaded.content, loaded.revision, seq);
      else {
        this.#unavailable.set(project, { status: 'read-only', reason: loaded.status === 'unsupported-schema'
          ? `Saved by a newer format (${loaded.schema}); opened read-only` : `Content is invalid (${loaded.reason}); left untouched` });
        this.#set({});
      }
    }, (error: unknown) => {
      this.#unavailable.set(project, { status: 'error', reason: message(error) });
      this.#set({});
    }).finally(() => this.#inflight.delete(project));
    this.#inflight.set(project, run);
    return run;
  }

  /** Lazily loads one gallery tile's summary; bounded and cancellable like thumbnails. */
  requestSummary(project: ProjectId, priority: Priority): () => void {
    if (this.#snapshot.summaries.has(project)) return () => {};
    return this.#summaryLoader.subscribe({
      key: `summary:${project}`, priority,
      load: async () => {
        const seq = ++this.#seq;
        const loaded = await this.#repository.load(project);
        if (loaded.status !== 'ok') throw new Error(loaded.status);
        this.#remember(loaded.content, loaded.revision, seq);
        return summarize(loaded.content);
      },
    }, () => {});
  }

  // ------------------------------------------------------------ edits

  async #edit(project: ProjectId, change: (content: ProjectContent, now: string) => ProjectContent): Promise<EditResult> {
    const cached = this.#content.get(project);
    this.#set({ edit: { status: 'saving' } });
    try {
      const result = await this.#repository.update(project, change, cached ? { revision: cached.revision } : undefined);
      // Sequenced after the write commits, so any read that overlapped it is older and cannot replace it.
      this.#remember(result.content, result.revision, ++this.#seq);
      this.#set({ edit: { status: 'idle' } });
      return { ok: true };
    } catch (error) {
      this.#set({ edit: { status: 'error', message: message(error) } });
      if (error instanceof StorageConflictError) {
        // The cached revision is stale; reload so the next edit applies to the stored revision.
        this.#content.delete(project);
        await this.#load(project);
      }
      return { ok: false, error: message(error) };
    }
  }

  #activeProject(): ProjectId | null {
    const { session } = this.#snapshot;
    return session.screen === 'project' ? session.activeProjectId : null;
  }

  async createProject(name: string): Promise<EditResult> {
    try {
      const record = await this.#ports.registry.create({ name });
      await this.refreshRegistry();
      this.openProject(record.id);
      return { ok: true };
    } catch (error) {
      this.#set({ edit: { status: 'error', message: message(error) } });
      return { ok: false, error: message(error) };
    }
  }

  addView(title: string, kind: ViewKind): Promise<EditResult> {
    const project = this.#activeProject();
    if (!project) return Promise.resolve({ ok: false, error: 'No project is open' });
    const id = viewId(this.#ids.next('view'));
    return this.#edit(project, (content, now) => addView(content, { id, title: title.trim(), kind }, now));
  }

  renameView(view: ViewId, title: string): Promise<EditResult> {
    const project = this.#activeProject();
    if (!project) return Promise.resolve({ ok: false, error: 'No project is open' });
    return this.#edit(project, (content, now) => renameView(content, view, title.trim(), now));
  }

  /** Appends a version to a view of the open project and selects it. */
  async addVersion(input: Omit<NewVersion, 'id'>): Promise<EditResult> {
    const project = this.#activeProject();
    if (!project) return { ok: false, error: 'No project is open' };
    const id = versionId(this.#ids.next('version'));
    const result = await this.#edit(project, (content, now) => addVersion(content, { ...input, id }, now));
    if (result.ok && this.#activeProject() === project) this.select(input.viewId, id);
    return result;
  }

  /** Explicit link of a read-only source entry to the open project. */
  linkSource(entry: CatalogEntryView): Promise<EditResult> {
    const project = this.#activeProject();
    if (!project) return Promise.resolve({ ok: false, error: 'No project is open' });
    return this.#edit(project, (content, now) => linkSource(content, entry.sourceProjectId, entry.revision ?? null, now));
  }

  unlinkSource(source: SourceProjectId): Promise<EditResult> {
    const project = this.#activeProject();
    if (!project) return Promise.resolve({ ok: false, error: 'No project is open' });
    return this.#edit(project, (content, now) => unlinkSource(content, source, now));
  }
}

export function createProjectsController(ports: ProjectsPorts): ProjectsController {
  return new ProjectsController(ports);
}
