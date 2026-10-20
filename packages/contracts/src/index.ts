export const DOMAIN_IDS = ['design', 'social', 'work', 'wiki'] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];
export const APPEARANCES = ['light', 'dark', 'system'] as const;
export type Appearance = (typeof APPEARANCES)[number];
export type ResolvedAppearance = Exclude<Appearance, 'system'>;

/** Public project identity; never a filesystem path or credential container. */
export interface ProjectContext {
  readonly id: string;
  readonly name: string;
}

export interface DomainDestination {
  readonly domain: DomainId;
  /** Opaque module-local destination. Navigation must never dispatch work. */
  readonly destination: string;
}

/** Readable provenance survives a missing target. Resolution is module-owned. */
export interface ReferenceEnvelope {
  readonly version: 1;
  readonly domain: DomainId;
  readonly projectId: string;
  readonly kind: string;
  readonly entityId: string;
  readonly title: string;
  readonly returnDestination: DomainDestination;
  readonly sourceRevision?: string;
  readonly workspaceId?: string;
}

/** No generic IPC, files, commands or job dispatch are exposed to modules. */
export interface DesktopPort {
  readonly platform: 'desktop' | 'browser';
  readonly versions: { readonly electron: string | null };
}

/** React-free boundary; the desktop registry supplies ComponentType<ModulePort>. */
export interface ModulePort {
  readonly context: ProjectContext;
  readonly destination: string;
  readonly appearance: ResolvedAppearance;
  readonly desktop: DesktopPort;
  readonly navigate: (destination: string) => void;
}

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && DOMAIN_IDS.some((id) => id === value);
}

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && APPEARANCES.some((item) => item === value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function text(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function isDestination(value: unknown): value is string {
  return text(value, 512) && !/^[a-z][a-z\d+.-]*:|^[/\\]{2}/iu.test(value);
}

export function parseProjectContext(value: unknown): ProjectContext | null {
  if (!record(value) || !keys(value, ['id', 'name']) || !text(value.id) || !text(value.name, 300)) return null;
  return { id: value.id, name: value.name };
}

export function parseReference(value: unknown): ReferenceEnvelope | null {
  if (!record(value) || !keys(value, ['version', 'domain', 'projectId', 'kind', 'entityId', 'title', 'returnDestination', 'sourceRevision', 'workspaceId'])
    || value.version !== 1 || !isDomainId(value.domain) || !text(value.projectId)
    || !text(value.kind) || !text(value.entityId) || !text(value.title, 300)
    || !record(value.returnDestination) || !keys(value.returnDestination, ['domain', 'destination'])
    || !isDomainId(value.returnDestination.domain) || !isDestination(value.returnDestination.destination)
    || ('sourceRevision' in value && !text(value.sourceRevision, 300))
    || ('workspaceId' in value && !text(value.workspaceId))) return null;
  return {
    version: 1, domain: value.domain, projectId: value.projectId, kind: value.kind,
    entityId: value.entityId, title: value.title,
    returnDestination: { domain: value.returnDestination.domain, destination: value.returnDestination.destination },
    ...(typeof value.sourceRevision === 'string' ? { sourceRevision: value.sourceRevision } : {}),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
  };
}
