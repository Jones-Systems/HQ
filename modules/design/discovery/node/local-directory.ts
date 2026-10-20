import { constants } from 'node:fs';
import { lstat, opendir, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  isRelativePath, isoTime, rootId as validateRootId,
  type CatalogEntry, type CatalogSnapshot, type IsoTime, type PreviewRef, type RootId,
} from '../src/contract.ts';
import { deriveSourceProjectId, digestBytes } from '../src/identity.ts';
import { LOCAL_HOST_ID } from '../src/adapters/local-directory.ts';

export const LOCAL_ENTRY_LIMIT = 500;
export const LOCAL_PREVIEW_LIMIT = 5 * 1024 * 1024;

/** Read-only seam for synthetic filesystem instrumentation. Never exposed to the renderer. */
export interface LocalDirectoryFs {
  readonly lstat: typeof lstat;
  readonly opendir: typeof opendir;
  readonly open: typeof open;
  readonly realpath: typeof realpath;
}
const nativeFs: LocalDirectoryFs = { lstat, opendir, open, realpath };

export interface LocalSnapshotOptions {
  readonly rootId: RootId;
  /** Allocated and persisted by main, monotonically increasing for the local host. */
  readonly generation: number;
  readonly observedAt: IsoTime;
}

/** Main retains the reader; only snapshot data crosses the renderer boundary. */
export interface BuiltLocalCatalog {
  readonly snapshot: CatalogSnapshot;
  preview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array>;
}

export function isLocalSegment(name: string): boolean {
  return name.length <= 255 && !name.startsWith('.') && !name.includes('/')
    && !name.includes('..') && !/[\u0000-\u001f\u007f-\u009f]/u.test(name)
    && isRelativePath(name);
}

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

const previews = [
  ['preview.png', 'image/png'], ['preview.jpg', 'image/jpeg'],
  ['preview.jpeg', 'image/jpeg'], ['preview.webp', 'image/webp'],
] as const;

function magic(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'image/png') {
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  }
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

/** The caller supplies a root selected by the native dialog. No root discovery or persistence here. */
export async function buildLocalDirectorySnapshot(
  rootPath: string,
  options: LocalSnapshotOptions,
  signal: AbortSignal,
  fs: LocalDirectoryFs = nativeFs,
): Promise<BuiltLocalCatalog> {
  signal.throwIfAborted();
  validateRootId(options.rootId);
  isoTime(options.observedAt);
  if (!isAbsolute(rootPath) || !Number.isSafeInteger(options.generation) || options.generation < 0) {
    throw new TypeError('Invalid local catalog options');
  }
  let root: string;
  try {
    root = await fs.realpath(rootPath);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  } catch { throw new Error('Local catalog root is unavailable'); }
  signal.throwIfAborted();

  async function directory(path: string): Promise<string> {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Local directory refused');
    const resolved = await fs.realpath(path);
    if (!inside(root, resolved)) throw new Error('Local directory escapes root');
    return resolved;
  }

  async function readPreview(segment: string, filename: string, mediaType: string, request: AbortSignal): Promise<Uint8Array> {
    request.throwIfAborted();
    try {
      if (await fs.realpath(rootPath) !== root) throw new Error();
      const entry = await directory(join(root, segment));
      const folder = await directory(join(entry, '.hq'));
      const path = join(folder, filename);
      const stat = await fs.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LOCAL_PREVIEW_LIMIT) throw new Error();
      const resolved = await fs.realpath(path);
      if (!inside(root, resolved) || !inside(folder, resolved)) throw new Error();
      request.throwIfAborted();
      const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > LOCAL_PREVIEW_LIMIT) throw new Error();
        if (await directory(join(root, segment)) !== entry || await directory(join(entry, '.hq')) !== folder
          || await fs.realpath(path) !== resolved) throw new Error();
        const bytes = new Uint8Array(LOCAL_PREVIEW_LIMIT + 1);
        let size = 0;
        while (size < bytes.length) {
          request.throwIfAborted();
          const read = await handle.read(bytes, size, bytes.length - size, size);
          if (read.bytesRead === 0) break;
          size += read.bytesRead;
        }
        request.throwIfAborted();
        const result = bytes.slice(0, size);
        if (size > LOCAL_PREVIEW_LIMIT || !magic(result, mediaType)) throw new Error();
        return result;
      } finally { await handle.close(); }
    } catch {
      request.throwIfAborted();
      throw new Error('Local preview is unavailable or invalid');
    }
  }

  const locations = new Map<string, { segment: string; filename: string; ref: PreviewRef }>();
  const entries: CatalogEntry[] = [];
  let complete = true;
  try {
    const dir = await fs.opendir(root);
    for await (const child of dir) {
      signal.throwIfAborted();
      if (!isLocalSegment(child.name)) continue;
      const path = join(root, child.name);
      const stat = await fs.lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      await directory(path);
      if (entries.length === LOCAL_ENTRY_LIMIT) { complete = false; break; }
      const refs: PreviewRef[] = [];
      for (const [filename, mediaType] of previews) {
        let bytes: Uint8Array;
        try { bytes = await readPreview(child.name, filename, mediaType, signal); }
        catch { signal.throwIfAborted(); continue; }
        const ref: PreviewRef = { digest: await digestBytes(bytes), mediaType, bytes: bytes.byteLength };
        refs.push(ref);
        locations.set(ref.digest, { segment: child.name, filename, ref });
      }
      entries.push({
        sourceProjectId: await deriveSourceProjectId(LOCAL_HOST_ID, options.rootId, child.name),
        hostId: LOCAL_HOST_ID, rootId: options.rootId, relativePath: child.name, displayName: child.name,
        repoIdentity: { localOnly: true }, metadata: {}, previews: refs,
      });
    }
  } catch {
    signal.throwIfAborted();
    throw new Error('Local catalog enumeration refused');
  }
  signal.throwIfAborted();
  entries.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  return {
    snapshot: { hostId: LOCAL_HOST_ID, generation: options.generation, observedAt: options.observedAt, complete, entries },
    async preview(ref, request) {
      request.throwIfAborted();
      const location = locations.get(ref.digest);
      if (!location || ref.bytes !== location.ref.bytes || ref.mediaType !== location.ref.mediaType) {
        throw new Error('Unknown local preview reference');
      }
      const bytes = await readPreview(location.segment, location.filename, location.ref.mediaType, request);
      const digest = await digestBytes(bytes);
      request.throwIfAborted();
      if (digest !== ref.digest || bytes.byteLength !== ref.bytes) throw new Error('Local preview digest mismatch');
      return bytes;
    },
  };
}
