/**
 * Project content persistence over the injected StoragePort.
 *
 * One workspace document per project. Writes use compare-and-swap and pass
 * the append-only guard; unsupported or invalid documents open read-only and
 * are never rewritten.
 */
import { PROJECTS_KEY_PREFIX, StorageConflictError, WORKSPACE_NAMESPACE, type ClockPort, type ProjectStoragePort } from './contract.ts';
import { assertAppendOnly, createProjectContent, parseProjectContent, type ProjectContent } from './content.ts';
import type { ProjectId } from './ids.ts';

export const contentKey = (project: ProjectId): string => `${PROJECTS_KEY_PREFIX}content/${encodeURIComponent(project)}`;

export type LoadedContent =
  | { readonly status: 'ok'; readonly content: ProjectContent; readonly revision: string | null; readonly writable: true }
  | { readonly status: 'unsupported-schema'; readonly schema: string; readonly writable: false }
  | { readonly status: 'invalid'; readonly reason: string; readonly writable: false };

export class ReadOnlyContentError extends Error {
  constructor(project: ProjectId, status: string) {
    super(`Project ${project} content is ${status}; it is open read-only and will not be rewritten`);
    this.name = 'ReadOnlyContentError';
  }
}

export class ProjectContentRepository {
  readonly #storage: ProjectStoragePort;
  readonly #clock: ClockPort;

  constructor(storage: ProjectStoragePort, clock: ClockPort) {
    this.#storage = storage;
    this.#clock = clock;
  }

  /** Missing content is an empty, not yet persisted project (no write on read). */
  async load(project: ProjectId): Promise<LoadedContent> {
    const stored = await this.#storage.readDocument(WORKSPACE_NAMESPACE, contentKey(project));
    if (!stored) return { status: 'ok', content: createProjectContent(project, this.#clock.now()), revision: null, writable: true };
    const parsed = parseProjectContent(stored.value);
    if (parsed.status === 'unsupported-schema') return { status: parsed.status, schema: parsed.schema, writable: false };
    if (parsed.status === 'invalid') return { status: parsed.status, reason: parsed.reason, writable: false };
    if (parsed.content.projectId !== project) return { status: 'invalid', reason: 'document belongs to another project', writable: false };
    return { status: 'ok', content: parsed.content, revision: stored.revision, writable: true };
  }

  /**
   * Applies one change against the freshest stored revision. A concurrent write
   * surfaces as StorageConflictError instead of being silently overwritten.
   */
  async update(project: ProjectId, change: (content: ProjectContent, now: string) => ProjectContent,
    expected?: { readonly revision: string | null }): Promise<{ readonly content: ProjectContent; readonly revision: string }> {
    const loaded = await this.load(project);
    if (loaded.status !== 'ok') throw new ReadOnlyContentError(project, loaded.status);
    if (expected && expected.revision !== loaded.revision) throw new StorageConflictError(contentKey(project));
    const previous = loaded.revision === null ? null : loaded.content;
    const next = change(loaded.content, this.#clock.now());
    if (next === loaded.content && loaded.revision !== null) return { content: next, revision: loaded.revision };
    assertAppendOnly(previous, next);
    const { revision } = await this.#storage.writeDocument(WORKSPACE_NAMESPACE, contentKey(project),
      JSON.parse(JSON.stringify(next)), { expectedRevision: loaded.revision });
    return { content: next, revision };
  }
}
