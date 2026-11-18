import { join } from 'node:path';
import type { BlobDigest, NamespaceId } from './contract.ts';
import { sha256Hex } from './jcs.ts';

/**
 * On-disk layout `hq.design.store/v1`:
 *
 *   <root>/CURRENT                          pointer to the live generation (atomic replace)
 *   <root>/LOCK                             single-writer lock
 *   <root>/generations/gNNNNNN/HEADER.json  layout format + application schema version
 *   <root>/generations/gNNNNNN/ns/<ns>/docs/<name>.json
 *   <root>/generations/gNNNNNN/ns/<ns>/blobs/<hex[0..2]>/<hex>
 *   <root>/generations/gNNNNNN/ns/<ns>/events/<name>.jsonl
 *   <root>/generations/gNNNNNN/ns/<ns>/projections/<projection>@<name>.json
 *   <root>/generations/gNNNNNN/txn/<id>.commit   durable multi-document manifests
 *   <root>/snapshots/<id>/                  pre-migration snapshots (never deleted automatically)
 *   <root>/quarantine/<id>/                 preserved bytes from interrupted or repaired state
 */
export const LAYOUT_FORMAT = 'hq.design.store/v1';
export const CURRENT_FORMAT = 'hq.design.store.current/v1';
export const DOC_FORMAT = 'hq.design.store.doc/v1';
export const TXN_FORMAT = 'hq.design.store.txn/v1';
export const PROJECTION_FORMAT = 'hq.design.store.projection/v1';
export const SNAPSHOT_FORMAT = 'hq.design.store.snapshot/v1';
export const LOCK_FORMAT = 'hq.design.store.lock/v1';

export const TEMP_PREFIX = '.tmp-';
export const STAGE_PREFIX = '.stage-';
const HASHED_PREFIX = '=';
const MAX_ENCODED = 180;

const PLAIN = /^[a-z0-9_-]$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Maps a key to a portable file name. Only `[a-z0-9_-]` pass through; everything else (including
 * upper case, so case-insensitive volumes cannot collide) becomes `~HH` per UTF-8 byte. Encoded
 * names never start with `.` (temp files) or `=` (hashed fallback for long keys).
 */
export function encodeName(key: string): string {
  let out = '';
  for (const char of key) {
    if (PLAIN.test(char)) {
      out += char;
    } else {
      for (const byte of encoder.encode(char)) out += `~${byte.toString(16).padStart(2, '0')}`;
    }
  }
  return out.length <= MAX_ENCODED ? out : `${HASHED_PREFIX}${sha256Hex(key)}`;
}

/** Returns the key for an encoded name, or `null` for hashed names whose key lives in the file. */
export function decodeName(name: string): string | null {
  if (name.startsWith(HASHED_PREFIX)) return null;
  const bytes: number[] = [];
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index] ?? '';
    if (char === '~') {
      bytes.push(Number.parseInt(name.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return decoder.decode(new Uint8Array(bytes));
}

export function generationName(index: number): string {
  return `g${String(index).padStart(6, '0')}`;
}

export function parseGenerationName(name: string): number | null {
  const match = /^g(\d{6})$/u.exec(name);
  return match ? Number(match[1]) : null;
}

export interface RootPaths {
  readonly root: string;
  readonly current: string;
  readonly lock: string;
  readonly generations: string;
  readonly snapshots: string;
  readonly quarantine: string;
}

export function rootPaths(root: string): RootPaths {
  return {
    root,
    current: join(root, 'CURRENT'),
    lock: join(root, 'LOCK'),
    generations: join(root, 'generations'),
    snapshots: join(root, 'snapshots'),
    quarantine: join(root, 'quarantine'),
  };
}

export class GenerationPaths {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  header(): string {
    return join(this.dir, 'HEADER.json');
  }

  txnDir(): string {
    return join(this.dir, 'txn');
  }

  namespaceDir(namespace: NamespaceId): string {
    return join(this.dir, 'ns', namespace);
  }

  docsDir(namespace: NamespaceId): string {
    return join(this.namespaceDir(namespace), 'docs');
  }

  docFile(namespace: NamespaceId, key: string): string {
    return join(this.docsDir(namespace), `${encodeName(key)}.json`);
  }

  blobsDir(namespace: NamespaceId): string {
    return join(this.namespaceDir(namespace), 'blobs');
  }

  blobFanout(namespace: NamespaceId, digest: BlobDigest): string {
    return join(this.blobsDir(namespace), digest.slice(7, 9));
  }

  blobFile(namespace: NamespaceId, digest: BlobDigest): string {
    return join(this.blobFanout(namespace, digest), digest.slice(7));
  }

  eventsDir(namespace: NamespaceId): string {
    return join(this.namespaceDir(namespace), 'events');
  }

  eventFile(namespace: NamespaceId, stream: string): string {
    return join(this.eventsDir(namespace), `${encodeName(stream)}.jsonl`);
  }

  projectionsDir(namespace: NamespaceId): string {
    return join(this.namespaceDir(namespace), 'projections');
  }

  projectionFile(namespace: NamespaceId, projection: string, stream: string): string {
    return join(this.projectionsDir(namespace), `${projection}@${encodeName(stream)}.json`);
  }
}
