// Owner-supplied input files: the source configuration and the optional query list. Both are data-only
// JSON kept outside the repository. A file is read the way the app reads an imported profile (no
// symlink, a regular file, a bounded read), with a 256 KiB cap. A failure is one fixed code (and at
// most a position number and a contract reason code): never the path, the file's content or a message
// that quotes either.

import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { INVALID_INPUT_REASONS, NAMESPACES, validateQuery, type WikiNamespace } from '../../contract/src/index.ts';
import { validateSourceProfile, type SourceProfile } from '../src/index.ts';
import { MAX_QUERIES } from './report.ts';

export const MAX_INPUT_BYTES = 256 * 1024;

export const INPUT_FAILURES = [
  'unreadable',
  'symlink',
  'not-regular-file',
  'too-large',
  'not-json',
  'bad-shape',
  'invalid-profile',
  'duplicate-namespace',
  'no-sources',
  'no-matching-source',
  'invalid-query',
] as const;
export type InputFailureCode = (typeof INPUT_FAILURES)[number];

/** A rejected input file. Carries only closed values; `message` is the fixed code. */
export class InputFailure extends Error {
  readonly code: InputFailureCode;
  /** Zero-based position of the offending source or query, when there is one. */
  readonly position: number | null;
  /** Contract reason code of an invalid profile (a fixed enumeration), when there is one. */
  readonly reason: string | null;

  constructor(code: InputFailureCode, position: number | null = null, reason: string | null = null) {
    super(code);
    this.code = code;
    this.position = position;
    this.reason = reason !== null && (INVALID_INPUT_REASONS as readonly string[]).includes(reason) ? reason : null;
  }
}

/** Read and parse one JSON file: not a symlink, a regular file, at most `cap` bytes, valid UTF-8 JSON. */
export async function readBoundedJson(path: string, cap: number = MAX_INPUT_BYTES): Promise<unknown> {
  let handle: FileHandle;
  try {
    const link = await lstat(path);
    if (link.isSymbolicLink()) throw new InputFailure('symlink');
    // Checked before opening: opening a FIFO or device could block.
    if (!link.isFile()) throw new InputFailure('not-regular-file');
    // O_NOFOLLOW and O_NONBLOCK close the window between the checks above and the open.
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    throw error instanceof InputFailure ? error : new InputFailure('unreadable');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new InputFailure('not-regular-file');
    if (info.size > cap) throw new InputFailure('too-large');
    const buffer = Buffer.alloc(cap + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > cap) throw new InputFailure('too-large');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))) as unknown;
    } catch {
      throw new InputFailure('not-json');
    }
  } catch (error) {
    throw error instanceof InputFailure ? error : new InputFailure('unreadable');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

/** `{ "version": 1, "sources": [<SourceProfile>, ...] }`: the shape of the app's `wiki/config.json`. */
export function parseConfig(value: unknown): SourceProfile[] {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['version', 'sources']) || value['version'] !== 1) throw new InputFailure('bad-shape');
  const sources = value['sources'];
  if (!Array.isArray(sources)) throw new InputFailure('bad-shape');
  if (sources.length === 0) throw new InputFailure('no-sources');
  if (sources.length > NAMESPACES.length) throw new InputFailure('duplicate-namespace');
  const profiles: SourceProfile[] = [];
  for (const [position, source] of sources.entries()) {
    const checked = validateSourceProfile(source);
    if (!checked.ok) throw new InputFailure('invalid-profile', position, checked.error.reason);
    if (profiles.some((profile) => profile.namespace === checked.value.namespace)) throw new InputFailure('duplicate-namespace', position);
    profiles.push(checked.value);
  }
  return profiles;
}

/** `{ "version": 1, "queries": ["...", ...] }`: at most MAX_QUERIES search queries, each valid per the contract. */
export function parseQueries(value: unknown): string[] {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['version', 'queries']) || value['version'] !== 1) throw new InputFailure('bad-shape');
  const queries = value['queries'];
  if (!Array.isArray(queries) || queries.length > MAX_QUERIES) throw new InputFailure('bad-shape');
  for (const [position, query] of queries.entries()) if (!validateQuery(query).ok) throw new InputFailure('invalid-query', position);
  return queries as string[];
}

export function selectProfiles(profiles: readonly SourceProfile[], only: WikiNamespace | null): SourceProfile[] {
  const chosen = NAMESPACES.flatMap((namespace) => profiles.filter((profile) => profile.namespace === namespace && (only === null || only === namespace)));
  if (chosen.length === 0) throw new InputFailure('no-matching-source');
  return chosen;
}
