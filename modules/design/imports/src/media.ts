import type { SourceFile } from './contract.ts';

/**
 * Structural checks for permitted design files. These verify container
 * signatures and safe shapes only; they never decode, execute or fetch.
 */

export const LIMITS = {
  maxItems: 2_000,
  maxItemBytes: 256 * 1024 * 1024,
  maxBundleFiles: 2_000,
  maxBundleBytes: 256 * 1024 * 1024,
  maxPathLength: 512,
  maxUrlLength: 2_048,
  maxTextLength: 300,
  maxPixels: 32_768,
} as const;

export const RECORDING_MEDIA_TYPES: readonly string[] = ['video/mp4', 'video/webm'];

export const BUNDLE_MEDIA_TYPES: readonly string[] = [
  'text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
  'font/woff', 'font/woff2', 'video/mp4', 'video/webm', 'text/plain',
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type MediaCheck<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const fail = (problem: string): { readonly ok: false; readonly problem: string } => ({ ok: false, problem });

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

/** PNG signature followed by an IHDR chunk; returns pixel dimensions. */
export function checkPng(bytes: Uint8Array): MediaCheck<{ w: number; h: number }> {
  if (bytes.byteLength > LIMITS.maxItemBytes) return fail('png-too-large');
  if (bytes.byteLength < 33 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return fail('png-signature');
  const ihdr = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (uint32(bytes, 8) !== 13 || ihdr !== 'IHDR') return fail('png-missing-ihdr');
  const w = uint32(bytes, 16);
  const h = uint32(bytes, 20);
  if (w === 0 || h === 0 || w > LIMITS.maxPixels || h > LIMITS.maxPixels) return fail('png-dimensions');
  return { ok: true, value: { w, h } };
}

/** MP4 (`ftyp` box) or WebM (EBML header) by container signature. */
export function checkRecording(mediaType: string, bytes: Uint8Array): MediaCheck<{ mediaType: string }> {
  if (!RECORDING_MEDIA_TYPES.includes(mediaType)) return fail('recording-media-type');
  if (bytes.byteLength > LIMITS.maxItemBytes) return fail('recording-too-large');
  if (bytes.byteLength < 12) return fail('recording-signature');
  if (mediaType === 'video/mp4') {
    const box = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (box !== 'ftyp') return fail('recording-signature');
  } else if (!(bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)) {
    return fail('recording-signature');
  }
  return { ok: true, value: { mediaType } };
}

/**
 * Relative POSIX path with no traversal, absolute, drive, backslash, empty or
 * control-character segments. Percent signs and segments ending in a space or
 * dot are rejected because URL parsers and Windows filesystems normalise them
 * into traversal. Case-folded duplicates are rejected separately.
 */
export function isSafeBundlePath(path: string): boolean {
  if (path.length === 0 || path.length > LIMITS.maxPathLength) return false;
  if (/[\u0000-\u001f\u007f\\%]/u.test(path) || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) return false;
  return path.split('/').every((segment) => segment.length > 0 && !segment.endsWith('.') && !segment.endsWith(' '));
}

export function checkHtmlBundle(entry: string, files: readonly SourceFile[]): MediaCheck<null> {
  if (files.length === 0 || files.length > LIMITS.maxBundleFiles) return fail('bundle-file-count');
  let total = 0;
  const seen = new Set<string>();
  for (const file of files) {
    if (!isSafeBundlePath(file.path)) return fail('bundle-unsafe-path');
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) return fail('bundle-duplicate-path');
    seen.add(folded);
    if (!BUNDLE_MEDIA_TYPES.includes(file.mediaType)) return fail('bundle-media-type');
    total += file.bytes.byteLength;
  }
  if (total > LIMITS.maxBundleBytes) return fail('bundle-too-large');
  const entryFile = files.find((file) => file.path === entry);
  if (entryFile === undefined) return fail('bundle-missing-entry');
  if (entryFile.mediaType !== 'text/html') return fail('bundle-entry-not-html');
  return { ok: true, value: null };
}

/**
 * http(s) only, no embedded credentials. Returns the WHATWG-normalized href.
 * Recording a URL is not a fetch; capture belongs to the preview capability.
 */
export function checkUrl(raw: string): MediaCheck<{ url: string }> {
  if (raw.length === 0 || raw.length > LIMITS.maxUrlLength || raw.trim() !== raw) return fail('url-shape');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('url-shape');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fail('url-scheme');
  if (parsed.username !== '' || parsed.password !== '') return fail('url-credentials');
  if (parsed.hostname === '') return fail('url-shape');
  return { ok: true, value: { url: parsed.href } };
}

export function isBoundedText(value: unknown, max: number = LIMITS.maxTextLength): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
