import { createHash } from 'node:crypto';
import type { AgentEvent, AgentFrame, PreviewViewport } from '@hq/contracts/preview';
export interface ExactTarget { readonly found: boolean; readonly identity?: string; readonly text?: string; readonly rects?: readonly unknown[] }
export interface CaptureReading { readonly generation: number; readonly url: string; readonly mutationCounter: number; readonly frame: AgentFrame; readonly results: readonly ExactTarget[]; readonly contentSize: { w: number; h: number } }
export interface CapturePixels { readonly bytes: Uint8Array; readonly width: number; readonly height: number }
export type Coherence = { ok: true; bytes: Uint8Array; digest: `sha256:${string}`; reading: CaptureReading } | { ok: false; reason: string };
export const pixelDigest = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function acceptCapture(pre: CaptureReading, first: CapturePixels, second: CapturePixels, post: CaptureReading, expected: { generation: number; viewport: PreviewViewport; event?: AgentEvent }): Coherence {
  if (pre.generation !== expected.generation || post.generation !== pre.generation || pre.url !== post.url) return { ok: false, reason: 'navigation' };
  if (!same(pre.frame.scroll, post.frame.scroll) || (expected.event && !same(expected.event.frame.scroll, pre.frame.scroll))) return { ok: false, reason: 'scroll' };
  if (!same(pre.results, post.results) || (expected.event && (pre.results.length !== 1 || !pre.results[0]?.found || !same({ identity: pre.results[0].identity, text: pre.results[0].text, rects: pre.results[0].rects }, expected.event.snapshot)))) return { ok: false, reason: 'target-changed' };
  if (pre.mutationCounter !== post.mutationCounter) return { ok: false, reason: 'mutation' };
  if (!same(pre.frame.viewport, post.frame.viewport) || !same(pre.frame.viewport, expected.viewport) || !same(pre.contentSize, post.contentSize)
    || (expected.event && !same(expected.event.frame.viewport, pre.frame.viewport)) || first.width / expected.viewport.w !== expected.viewport.dpr || first.height / expected.viewport.h !== expected.viewport.dpr) return { ok: false, reason: 'dpr' };
  if (first.bytes.byteLength > 12 * 1024 * 1024 || pixelDigest(first.bytes) !== pixelDigest(second.bytes)) return { ok: false, reason: 'pixels-unstable' };
  return { ok: true, bytes: first.bytes, digest: pixelDigest(first.bytes), reading: post };
}
