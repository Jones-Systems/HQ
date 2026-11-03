import {
  contentDigest, isBoundedText, isRelativePath, sourceProjectIdFromHex,
  type ContentDigest, type HostId, type RepoIdentity, type RootId, type SourceProjectId,
} from './contract.ts';
import { jcsSha256Hex, sha256Hex } from './jcs.ts';

/** SourceProjectId = SHA-256 of JCS `{hostId,rootId,relativePath}`. Titles and remotes never participate. */
export async function deriveSourceProjectId(host: HostId, root: RootId, relativePath: string): Promise<SourceProjectId> {
  if (!isRelativePath(relativePath)) throw new TypeError('Invalid relativePath');
  return sourceProjectIdFromHex(await jcsSha256Hex({ hostId: host, rootId: root, relativePath }));
}

export async function digestBytes(bytes: Uint8Array): Promise<ContentDigest> {
  return contentDigest(`sha256:${await sha256Hex(bytes)}`);
}

/**
 * Normalizes a Git remote for display/evidence only: drops credentials, query and fragment, lowercases
 * the host, strips `.git` and trailing slashes, and folds scp-like syntax into `host/path`.
 * Returns null for anything that is not a recognizable remote. Equal results never merge entries.
 */
export function normalizeRemote(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\s]/u.test(trimmed)) return null;
  let host: string;
  let path: string;
  // Already-normalized `host[:port]/path` is accepted unchanged so normalization is idempotent.
  const bare = /^([a-z\d.-]+(?::\d+)?)\/(.+)$/iu.exec(trimmed);
  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/)(.+)$/u.exec(trimmed);
  if (bare) {
    host = bare[1]!;
    path = bare[2]!;
  } else if (scp && !/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    let url: URL;
    try { url = new URL(trimmed); } catch { return null; }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !url.hostname) return null;
    host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    path = url.pathname;
  }
  path = path.replace(/^\/+/u, '').replace(/\/+$/u, '').replace(/\.git$/iu, '');
  if (!path || path.split('/').some((segment) => segment === '' || segment === '..')) return null;
  const normalized = `${host.toLowerCase()}/${path}`;
  return isBoundedText(normalized, 512) ? normalized : null;
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/u;

export function parseRepoIdentity(value: unknown): RepoIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['normalizedRemote', 'rootCommit', 'localOnly'].includes(key))) return null;
  if (typeof record.localOnly !== 'boolean') return null;
  if (record.normalizedRemote !== undefined && (typeof record.normalizedRemote !== 'string'
    || normalizeRemote(record.normalizedRemote) !== record.normalizedRemote)) return null;
  if (record.rootCommit !== undefined && (typeof record.rootCommit !== 'string' || !COMMIT.test(record.rootCommit))) return null;
  if (record.localOnly && record.normalizedRemote !== undefined) return null;
  return {
    ...(record.normalizedRemote !== undefined ? { normalizedRemote: record.normalizedRemote as string } : {}),
    ...(record.rootCommit !== undefined ? { rootCommit: record.rootCommit as string } : {}),
    localOnly: record.localOnly,
  };
}
