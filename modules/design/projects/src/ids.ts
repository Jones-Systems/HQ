/**
 * Branded identifiers for the projects section.
 *
 * Stable identifiers are opaque. They never derive from display titles, paths
 * or remotes; constructors only validate shape and bounds.
 */
export type Brand<K extends string> = string & { readonly __kind: K };

export type ProjectId = Brand<'ProjectId'>;
export type ViewId = Brand<'ViewId'>;
export type VersionId = Brand<'VersionId'>;
export type HostId = Brand<'HostId'>;
export type SourceProjectId = Brand<'SourceProjectId'>;

export const MAX_ID_LENGTH = 160;

export class InvalidIdError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`Invalid ${kind}: expected a nonempty trimmed identifier of at most ${MAX_ID_LENGTH} printable characters`);
    this.name = 'InvalidIdError';
    this.kind = kind;
  }
}

// Mirrors the shared @hq/contracts text rule so a shell ProjectContext id is
// always accepted as a ProjectId without reformatting.
function isIdText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function make<K extends string>(kind: K): { parse(value: unknown): Brand<K> | null; of(value: string): Brand<K> } {
  return {
    parse: (value) => (isIdText(value) ? (value as Brand<K>) : null),
    of: (value) => {
      if (!isIdText(value)) throw new InvalidIdError(kind);
      return value as Brand<K>;
    },
  };
}

const project = make('ProjectId');
const view = make('ViewId');
const version = make('VersionId');
const host = make('HostId');
const sourceProject = make('SourceProjectId');

export const projectId = project.of;
export const parseProjectId = project.parse;
export const viewId = view.of;
export const parseViewId = view.parse;
export const versionId = version.of;
export const parseVersionId = version.parse;
export const hostId = host.of;
export const parseHostId = host.parse;
export const sourceProjectId = sourceProject.of;
export const parseSourceProjectId = sourceProject.parse;

/** Injected ID source; production uses random UUIDs, tests use a labelled sequence. */
export interface IdFactory {
  next(kind: 'project' | 'view' | 'version'): string;
}

export const randomIdFactory: IdFactory = {
  next: (kind) => `${kind}_${globalThis.crypto.randomUUID()}`,
};
