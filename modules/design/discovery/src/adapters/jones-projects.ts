import { hostId, rootId, isoTime, isBoundedText, type CatalogSnapshot, type HostId, type RootId, type IsoTime, type MetadataValue } from '../contract.ts';
import { deriveSourceProjectId, normalizeRemote } from '../identity.ts';

export interface RegistryContext {
  readonly hostId: HostId;
  readonly rootId: RootId;
  readonly generation: number;
  readonly observedAt: IsoTime;
  readonly hostFingerprint: string;
}

export function registryContext(context: RegistryContext): RegistryContext {
  hostId(context.hostId); rootId(context.rootId); isoTime(context.observedAt);
  if (!Number.isSafeInteger(context.generation) || context.generation < 0) throw new TypeError('Invalid generation');
  registryText(context.hostFingerprint, 300);
  return { ...context };
}

export function registryObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected plain object');
  return value as Record<string, unknown>;
}

export function registryText(value: unknown, max = 512): string {
  if (!isBoundedText(value, max)) throw new TypeError('Invalid or oversized text');
  return value;
}

export function registryId(value: unknown): string {
  const id = registryText(value, 160);
  if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new TypeError('Invalid registry ID');
  return id;
}

export function registryList(value: unknown, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError('Invalid or oversized list');
  return value;
}

export function registryUrl(value: unknown, base?: string): string {
  const text = registryText(value);
  if (/\s|\\/u.test(text)) throw new TypeError('Invalid URL');
  const url = new URL(text, base);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new TypeError('Unsupported URL');
  return registryText(url.href);
}

export interface JonesProjectsRead {
  readonly projects: readonly {
    readonly id: string;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly repositoryIdentity: null | {
      readonly canonicalKey: string;
      readonly locator: { readonly remoteName: string; readonly remoteUrl: string; readonly source: string };
    };
    readonly scripts: readonly {
      readonly id: string;
      readonly name: string;
      readonly command: string;
      readonly icon: string;
      readonly runOnWorktreeCreate: boolean;
      readonly previewUrl?: string | null;
      readonly autoOpenPreview?: boolean | null;
    }[];
  }[];
  readonly nextCursor: number | null;
}

export interface JonesPageCoverage {
  readonly complete?: boolean;
}

export async function mapJonesProjects(input: JonesProjectsRead, supplied: RegistryContext,
  coverage: JonesPageCoverage = {}): Promise<CatalogSnapshot> {
  const context = registryContext(supplied);
  const data = registryObject(input);
  if (coverage.complete !== undefined && typeof coverage.complete !== 'boolean') throw new TypeError('Invalid completeness');
  if (data.nextCursor !== null && (!Number.isSafeInteger(data.nextCursor) || Number(data.nextCursor) < 0)) throw new TypeError('Invalid page cursor');
  const seen = new Set<string>();
  const entries = [];
  for (const item of registryList(data.projects)) {
    const project = registryObject(item);
    const id = registryId(project.id);
    if (seen.has(id)) throw new TypeError('Duplicate project ID');
    seen.add(id);
    registryText(project.workspaceRoot);
    let repoIdentity: { localOnly: boolean; normalizedRemote?: string } = { localOnly: true };
    if (project.repositoryIdentity !== null) {
      const identity = registryObject(project.repositoryIdentity);
      registryText(identity.canonicalKey);
      const locator = registryObject(identity.locator);
      if (locator.source !== 'git-remote') throw new TypeError('Unsupported repository identity source');
      registryText(locator.remoteName, 160);
      const remote = registryText(locator.remoteUrl);
      if (remote.includes('://')) {
        const url = new URL(remote);
        if (url.username || url.password) throw new TypeError('Credential repository URL');
      }
      const normalizedRemote = normalizeRemote(remote);
      if (!normalizedRemote) throw new TypeError('Invalid repository remote');
      repoIdentity = { localOnly: false, normalizedRemote };
    }
    const previews = new Set<string>();
    const scriptIds = new Set<string>();
    for (const item of registryList(project.scripts, 100)) {
      const script = registryObject(item);
      const scriptId = registryId(script.id);
      if (scriptIds.has(scriptId)) throw new TypeError('Duplicate script ID');
      scriptIds.add(scriptId);
      if (script.previewUrl !== undefined && script.previewUrl !== null) previews.add(registryUrl(script.previewUrl));
      if (script.autoOpenPreview !== undefined && script.autoOpenPreview !== null && typeof script.autoOpenPreview !== 'boolean') throw new TypeError('Invalid autoOpenPreview');
    }
    const metadata: Record<string, MetadataValue> = { sourceKind: 'jones-project', launchStatus: 'unavailable', holdReason: 'No declared preview URL' };
    if (previews.size === 1) {
      metadata.launchUrl = [...previews][0]!;
      metadata.experienceKind = 'website';
      metadata.launchStatus = 'available';
      delete metadata.holdReason;
    } else if (previews.size > 1) {
      metadata.experienceKind = 'website';
      metadata.holdReason = 'Multiple preview URLs require explicit binding';
    }
    entries.push({ hostId: context.hostId, rootId: context.rootId,
      sourceProjectId: await deriveSourceProjectId(context.hostId, context.rootId, id), relativePath: id,
      displayName: registryText(project.title, 160), repoIdentity, metadata, previews: [],
    });
  }
  return { hostId: context.hostId, hostFingerprint: context.hostFingerprint, generation: context.generation,
    observedAt: context.observedAt, complete: coverage.complete === true && data.nextCursor === null, entries };
}
