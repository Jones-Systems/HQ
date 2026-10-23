import { expect, it } from 'vitest';
import { acceptCapture, type CaptureReading } from './coherence';
import type { AgentEvent } from '@hq/contracts/preview';
const viewport = { w: 390, h: 844, dpr: 2 as const };
const pre: CaptureReading = { generation: 3, url: 'https://example.com/page#state', mutationCounter: 0, frame: { viewport, scroll: { x: 0, y: 0 } }, results: [], contentSize: { w: 390, h: 900 } };
const image = { bytes: new Uint8Array([1, 2, 3]), width: 780, height: 1688 };
it('accepts only stable pixels at the exact logical viewport DPR', () => { expect(acceptCapture(pre, image, image, pre, { generation: 3, viewport })).toMatchObject({ ok: true, bytes: image.bytes }); });
it.each([
  ['navigation', { ...pre, generation: 4 }], ['navigation', { ...pre, url: 'https://example.com/other' }],
  ['scroll', { ...pre, frame: { ...pre.frame, scroll: { x: 0, y: 10 } } }], ['mutation', { ...pre, mutationCounter: 1 }],
  ['dpr', { ...pre, frame: { ...pre.frame, viewport: { ...viewport, w: 400 } } }],
] as const)('rejects %s without exposing capture bytes', (reason, post) => { expect(acceptCapture(pre, image, image, post, { generation: 3, viewport })).toEqual({ ok: false, reason }); });
it('rejects visual animation and wrong device-scale screenshots', () => {
  expect(acceptCapture(pre, image, { ...image, bytes: new Uint8Array([4]) }, pre, { generation: 3, viewport })).toEqual({ ok: false, reason: 'pixels-unstable' });
  expect(acceptCapture(pre, { ...image, width: 390 }, image, pre, { generation: 3, viewport })).toEqual({ ok: false, reason: 'dpr' });
});
it('re-resolves identity and exact text instead of accepting same-length replacement', () => {
  const target = { found: true, identity: 'target-1', text: 'old', rects: [{ x: 0, y: 0, width: 20, height: 10 }] };
  const before = { ...pre, results: [target] }, after = { ...pre, mutationCounter: 1, results: [{ ...target, text: 'new' }] };
  const event = { type: 'element-picked', target: { kind: 'element', path: 'body > p', rect: target.rects[0] }, frame: pre.frame, generation: 3, snapshot: { identity: target.identity, text: target.text, rects: target.rects } } as AgentEvent;
  expect(acceptCapture(before, image, image, after, { generation: 3, viewport, event })).toEqual({ ok: false, reason: 'target-changed' });
  expect(acceptCapture(before, image, image, before, { generation: 3, viewport, event: { ...event, snapshot: { ...event.snapshot, identity: 'another' } } })).toEqual({ ok: false, reason: 'target-changed' });
});
