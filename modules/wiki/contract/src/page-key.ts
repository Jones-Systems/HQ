// PageKey: the only way the renderer names a page. Logical, never a filesystem or Git location.

import { checkKeys, hasControlChar, hasLoneSurrogate, isRecord } from './guard.ts';
import { MAX_PATH_LENGTH, MAX_SEGMENT_LENGTH } from './limits.ts';
import { checkNamespace, type WikiNamespace } from './namespace.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

export interface PageKey {
  readonly namespace: WikiNamespace;
  /** Slash-separated path of normal segments, relative to the namespace's source root. Compared byte-exact. */
  readonly path: string;
}

/**
 * Rules the contract places on adapters. The contract cannot enforce them (it never touches a
 * filesystem or Git); they are stated here so every adapter implements the same policy.
 */
export const PAGE_KEY_ADAPTER_RULES: readonly string[] = [
  'A PageKey is a logical name inside one namespace; it is never joined onto a filesystem path or passed to Git as-is.',
  'Adapters resolve a key only against the committed tree of that namespace\'s pinned source (tree entry lookup by exact segments).',
  'A tree entry with symlink mode (120000), a submodule/commit entry, or any non-blob target is not a page: treat it as absent and never follow it.',
  'Path comparison is byte-exact: no Unicode normalisation, no case folding, no percent-decoding beyond destination parsing.',
  'A blob larger than MAX_PAGE_BLOB_BYTES is refused, not truncated.',
];

const DRIVE_FORM = /^[A-Za-z]:/;
const SCHEME_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function checkPagePath(value: unknown, path: string = '$'): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'path must be a string', path);
  if (value.length === 0) return invalid('empty', 'path is empty', path);
  if (value.length > MAX_PATH_LENGTH) return invalid('too-long', `path exceeds ${MAX_PATH_LENGTH} characters`, path);
  if (value.includes('\u0000')) return invalid('nul', 'path contains NUL', path);
  if (hasControlChar(value)) return invalid('control-character', 'path contains a control character', path);
  if (hasLoneSurrogate(value)) return invalid('lone-surrogate', 'path contains a lone surrogate', path);
  if (value.includes('\\')) return invalid('backslash', 'path contains a backslash', path);
  if (value.startsWith('/')) return invalid('absolute-path', 'path is absolute', path);
  const segments = value.split('/');
  const first = segments[0] ?? '';
  if (DRIVE_FORM.test(first)) return invalid('drive-form', 'path starts with a drive form', path);
  if (SCHEME_LIKE.test(first)) return invalid('scheme', 'path starts with a scheme-like prefix', path);
  for (const segment of segments) {
    if (segment.length === 0) return invalid('empty-segment', 'path contains an empty segment', path);
    if (segment === '.' || segment === '..') return invalid('traversal', 'path contains a dot segment', path);
    if (segment.length > MAX_SEGMENT_LENGTH) return invalid('too-long', `segment exceeds ${MAX_SEGMENT_LENGTH} characters`, path);
  }
  return null;
}

/** Accepts relative, slash-separated paths of normal segments (see {@link PAGE_KEY_ADAPTER_RULES}). */
export function validatePagePath(value: unknown): WikiResult<string> {
  return resultOf(checkPagePath(value), value as string);
}

export function checkPageKey(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'page key must be an object', path);
  const keyError = checkKeys(value, ['namespace', 'path'], ['namespace', 'path'], path);
  if (keyError !== null) return keyError;
  return checkNamespace(value['namespace'], `${path}.namespace`) ?? checkPagePath(value['path'], `${path}.path`);
}

export function validatePageKey(value: unknown): WikiResult<PageKey> {
  return resultOf(checkPageKey(value), value as PageKey);
}

/** Build a validated key from loose parts; returns a fresh frozen object. */
export function makePageKey(namespace: unknown, path: unknown): WikiResult<PageKey> {
  const error = checkNamespace(namespace, '$.namespace') ?? checkPagePath(path, '$.path');
  return resultOf(error, Object.freeze({ namespace, path }) as PageKey);
}

/** Stable identity string. Namespaces contain no `/`, so `<namespace>/<path>` is unambiguous. */
export function pageKeyId(key: PageKey): string {
  return `${key.namespace}/${key.path}`;
}

export function pageKeyEquals(a: PageKey, b: PageKey): boolean {
  return a.namespace === b.namespace && a.path === b.path;
}
