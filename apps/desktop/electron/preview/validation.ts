import { keys, record } from '../services.js';
import type { AgentEvent } from '@hq/contracts/preview';
import { previewTarget } from './policy.js';
const text = (v: unknown, max = 2048) => typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000000;
export function rect(v: unknown): boolean { return record(v) && keys(v, ['x', 'y', 'width', 'height']) && Object.values(v).every(finite) && Number(v.width) >= 0 && Number(v.height) >= 0; }
function request(v: unknown): boolean {
  return record(v) && (v.kind === 'element' ? keys(v, ['kind', 'path'], ['textHash']) && text(v.path) && (!('textHash' in v) || text(v.textHash, 128))
    : v.kind === 'text' && keys(v, ['kind', 'quote', 'prefix', 'suffix']) && text(v.quote, 2000) && typeof v.prefix === 'string' && v.prefix.length <= 2000 && typeof v.suffix === 'string' && v.suffix.length <= 2000);
}
export function previewParams(route: unknown, p: unknown): boolean {
  if (!record(p)) return false;
  if (route === 'deactivate') return keys(p, []);
  if (route === 'overlay') return keys(p, ['hidden']) && typeof p.hidden === 'boolean';
  if (route === 'open') return keys(p, ['versionId', 'url', 'viewport', 'label']) && text(p.versionId, 300) && text(p.label, 160) && !!previewTarget(p.url) && record(p.viewport) && keys(p.viewport, ['w', 'h', 'dpr']) && integer(p.viewport.w, 1, 4096) && integer(p.viewport.h, 1, 4096) && [1, 2, 3].includes(Number(p.viewport.dpr));
  if (route === 'image') return keys(p, ['captureId']) && text(p.captureId, 100);
  if (!text(p.sessionId, 100)) return false;
  switch (route) {
    case 'close': case 'status': return keys(p, ['sessionId']);
    case 'place': return keys(p, ['sessionId', 'rect', 'visible']) && rect(p.rect) && typeof p.visible === 'boolean';
    case 'navigate': return keys(p, ['sessionId', 'route']) && text(p.route) && String(p.route).startsWith('/') && !String(p.route).startsWith('//') && !String(p.route).includes('\\');
    case 'mode': return keys(p, ['sessionId', 'generation', 'mode']) && integer(p.generation) && ['off', 'pick', 'cite'].includes(String(p.mode));
    case 'capture': return keys(p, ['sessionId', 'expectedGeneration']) && integer(p.expectedGeneration);
    case 'events': return keys(p, ['sessionId', 'after']) && integer(p.after);
    case 'resolve': return keys(p, ['sessionId', 'generation', 'requests']) && integer(p.generation) && Array.isArray(p.requests) && p.requests.length <= 50 && p.requests.every(request);
    default: return false;
  }
}
export function validAgentEvent(v: unknown): v is AgentEvent {
  if (!record(v) || !keys(v, ['type', 'target', 'frame', 'generation', 'snapshot']) || !integer(v.generation) || !record(v.frame) || !keys(v.frame, ['viewport', 'scroll']) || !record(v.frame.viewport) || !keys(v.frame.viewport, ['w', 'h', 'dpr']) || ![v.frame.viewport.w, v.frame.viewport.h, v.frame.viewport.dpr].every(finite) || !record(v.frame.scroll) || !keys(v.frame.scroll, ['x', 'y']) || !Object.values(v.frame.scroll).every(finite) || !record(v.snapshot) || !keys(v.snapshot, ['identity', 'text', 'rects']) || !text(v.snapshot.identity, 128) || typeof v.snapshot.text !== 'string' || v.snapshot.text.length > 100000 || !Array.isArray(v.snapshot.rects) || v.snapshot.rects.length > 200 || !v.snapshot.rects.every(rect) || !record(v.target)) return false;
  if (v.type === 'element-picked') return keys(v.target, ['kind', 'path', 'rect'], ['textHash']) && request({ kind: v.target.kind, path: v.target.path, ...(v.target.textHash === undefined ? {} : { textHash: v.target.textHash }) }) && rect(v.target.rect);
  return v.type === 'text-cited' && keys(v.target, ['kind', 'quote', 'prefix', 'suffix', 'rects']) && request({ kind: v.target.kind, quote: v.target.quote, prefix: v.target.prefix, suffix: v.target.suffix }) && Array.isArray(v.target.rects) && v.target.rects.length <= 200 && v.target.rects.every(rect);
}
export function validResolution(value: unknown, count: number): boolean {
  if (!record(value) || !keys(value, ['frame', 'results']) || !record(value.frame) || !keys(value.frame, ['viewport', 'scroll']) || !record(value.frame.viewport) || !keys(value.frame.viewport, ['w', 'h', 'dpr']) || !record(value.frame.scroll) || !keys(value.frame.scroll, ['x', 'y']) || ![...Object.values(value.frame.viewport), ...Object.values(value.frame.scroll)].every(finite) || !Array.isArray(value.results) || value.results.length !== count) return false;
  return value.results.every(result => record(result) && (result.found === false ? keys(result, ['found']) : result.found === true && keys(result, ['found', 'rects'], ['textHash']) && Array.isArray(result.rects) && result.rects.length <= 200 && result.rects.every(rect) && (!('textHash' in result) || text(result.textHash, 128))));
}
