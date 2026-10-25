import { wellFormed } from './canonical-json.js';
import { UNICODE_FULL_FOLD } from './unicode-full-fold.js';
import { requireGeneration } from './types.js';
import type { GenerationIdentity } from './types.js';

export function opaque(value: unknown): asserts value is string {
  requireGeneration(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.exec(value)?.[0] === value, 'invalid_identity');
}
export function digest(value: unknown): asserts value is string {
  requireGeneration(typeof value === 'string' && /^[0-9a-f]{64}$/.exec(value)?.[0] === value, 'invalid_digest');
}
export function counter(value: unknown): asserts value is string {
  requireGeneration(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.exec(value)?.[0] === value && BigInt(value) <= 9223372036854775807n, 'invalid_counter');
}
export function relativePath(value: unknown): asserts value is string {
  requireGeneration(typeof value === 'string' && value.length > 0 && wellFormed(value)
    && Buffer.byteLength(value, 'utf8') <= 1024 && !value.includes('\\') && !/\p{C}/u.test(value), 'invalid_path');
  const segments = value.split('/');
  requireGeneration(segments.every(part => part !== '' && part !== '.' && part !== '..'), 'invalid_path');
  requireGeneration(segments.length <= 32, 'depth_exceeded');
  requireGeneration(value.normalize('NFC') === value, 'noncanonical_path');
}

// Unicode 15.1.0 default full folding: map each input scalar once, without
// normalizing the output. See unicode-full-fold.provenance.md for qualification limits.
export function collisionKey(value: string): string {
  return Array.from(value, char => UNICODE_FULL_FOLD[char.codePointAt(0)!] ?? char).join('');
}
export function pathSet(values: readonly unknown[]): void {
  const seen = new Set<string>();
  for (const path of values) {
    relativePath(path);
    const folded = collisionKey(path);
    requireGeneration(!seen.has(folded), 'path_collision');
    seen.add(folded);
  }
}
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
}
export function rootRoute(rootId: string): string { opaque(rootId); return `/hq-sync/v1/roots/${encodeSegment(rootId)}`; }
export function generationRoute(identity: GenerationIdentity): string {
  counter(identity.epoch); counter(identity.sequence); digest(identity.manifestSha256);
  return `${rootRoute(identity.rootId)}/generations/${identity.epoch}/${identity.sequence}/${identity.manifestSha256}`;
}
export function manifestRoute(identity: GenerationIdentity): string { return generationRoute(identity) + '/manifest.json'; }
export function fileRoute(identity: GenerationIdentity, path: string): string {
  relativePath(path);
  return generationRoute(identity) + '/files/' + path.split('/').map(encodeSegment).join('/');
}
