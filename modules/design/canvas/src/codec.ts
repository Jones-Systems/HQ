import {
  ARRANGEMENT_SCHEMA, isIdentifier, type Artboard, type ArtboardId, type CanvasArrangement, type CanvasId,
  type CanvasItemId, type CanvasStoragePort, type GridSettings, type Placement, type ProjectId, type ProviderId, type Rect,
} from './contract.ts';

/**
 * Canonical JSON for the canvas's own records: object keys sorted by UTF-16
 * code units, no whitespace, ES number serialization (the RFC 8785 rules for
 * the value types canvas stores). Rejects non-finite numbers and non-JSON values.
 * Root may later replace this with the single promoted JCS implementation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite number is not canonical JSON');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([, entry]) => entry === undefined)) throw new TypeError('Undefined is not canonical JSON');
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported value in canonical JSON: ${typeof value}`);
}

export type DecodeResult =
  | { readonly ok: true; readonly arrangement: CanvasArrangement }
  | { readonly ok: false; readonly reason: 'future-schema' | 'invalid'; readonly message: string };

type Json = Record<string, unknown>;

class Invalid extends Error {}

function fail(message: string): never { throw new Invalid(message); }

function object(value: unknown, where: string, allowed: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where} must be an object`);
  const record = value as Json;
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${where} has unknown field ${JSON.stringify(key)}`);
  for (const key of allowed) if (!(key in record)) fail(`${where} is missing ${key}`);
  return record;
}

function id(value: unknown, where: string): string {
  if (!isIdentifier(value)) fail(`${where} must be a bounded identifier`);
  return value;
}

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${where} must be text`);
  return value;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(`${where} must be boolean`);
  return value;
}

function rect(value: unknown, where: string): Rect {
  const record = object(value, where, ['x', 'y', 'width', 'height']);
  const [x, y, width, height] = (['x', 'y', 'width', 'height'] as const).map((key) => {
    const entry = record[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) fail(`${where}.${key} must be a finite number`);
    return entry;
  }) as [number, number, number, number];
  if (width < 1 || height < 1) fail(`${where} must be at least 1×1`);
  return { x, y, width, height };
}

const SCHEMA_PATTERN = /^hq\.design\.canvas-arrangement\/v(\d+)$/u;

/** Strict, non-repairing decode. Unknown fields or future schemas never load as editable. */
export function decodeArrangement(source: string): DecodeResult {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return { ok: false, reason: 'invalid', message: 'Not JSON' }; }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const schema = (parsed as Json).schema;
    const match = typeof schema === 'string' ? SCHEMA_PATTERN.exec(schema) : null;
    if (match && Number(match[1]) > 1) return { ok: false, reason: 'future-schema', message: `Unsupported future schema ${schema}` };
  }
  try {
    const root = object(parsed, 'arrangement', ['schema', 'canvasId', 'projectId', 'grid', 'artboards', 'items']);
    if (root.schema !== ARRANGEMENT_SCHEMA) fail('arrangement.schema is not supported');
    const gridRecord = object(root.grid, 'grid', ['size', 'snap']);
    if (typeof gridRecord.size !== 'number' || !Number.isInteger(gridRecord.size) || gridRecord.size < 1 || gridRecord.size > 512) fail('grid.size must be an integer 1..512');
    const grid: GridSettings = { size: gridRecord.size, snap: bool(gridRecord.snap, 'grid.snap') };
    if (!Array.isArray(root.artboards) || !Array.isArray(root.items)) fail('artboards and items must be arrays');
    if (root.artboards.length + root.items.length > 20000) fail('arrangement is too large');
    const seen = new Set<string>();
    const unique = (value: string, where: string) => { if (seen.has(value)) fail(`${where} duplicates ${value}`); seen.add(value); return value; };
    const artboards: Artboard[] = root.artboards.map((entry, index) => {
      const where = `artboards[${index}]`;
      const record = object(entry, where, ['id', 'name', 'frame', 'locked']);
      return {
        id: unique(id(record.id, `${where}.id`), where) as ArtboardId, name: text(record.name, `${where}.name`, 200),
        frame: rect(record.frame, `${where}.frame`), locked: bool(record.locked, `${where}.locked`),
      };
    });
    const boards = new Set(artboards.map((board) => board.id as string));
    const items: Placement[] = root.items.map((entry, index) => {
      const where = `items[${index}]`;
      const record = object(entry, where, ['id', 'ref', 'frame', 'artboardId', 'locked', 'hidden']);
      const ref = object(record.ref, `${where}.ref`, ['providerId', 'entityId', 'revision']);
      const artboard = record.artboardId === null ? null : id(record.artboardId, `${where}.artboardId`);
      if (artboard !== null && !boards.has(artboard)) fail(`${where}.artboardId references a missing artboard`);
      return {
        id: unique(id(record.id, `${where}.id`), where) as CanvasItemId,
        ref: {
          providerId: id(ref.providerId, `${where}.ref.providerId`) as ProviderId,
          entityId: text(ref.entityId, `${where}.ref.entityId`, 300),
          revision: text(ref.revision, `${where}.ref.revision`, 300),
        },
        frame: rect(record.frame, `${where}.frame`), artboardId: artboard as ArtboardId | null,
        locked: bool(record.locked, `${where}.locked`), hidden: bool(record.hidden, `${where}.hidden`),
      };
    });
    return {
      ok: true,
      arrangement: {
        schema: ARRANGEMENT_SCHEMA, canvasId: id(root.canvasId, 'canvasId') as CanvasId,
        projectId: id(root.projectId, 'projectId') as ProjectId, grid, artboards, items,
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: 'invalid', message: error.message };
    throw error;
  }
}

export function encodeArrangement(arrangement: CanvasArrangement): string {
  return canonicalJson(arrangement);
}

export const arrangementKey = (canvas: CanvasId): string => `design.canvas.arrangement.v1/${canvas}`;

export type LoadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'loaded'; readonly arrangement: CanvasArrangement; readonly baseText: string }
  /** Stored text could not be loaded as editable. It is kept untouched and is never overwritten. */
  | { readonly status: 'read-only'; readonly reason: 'future-schema' | 'invalid' | 'mismatch'; readonly message: string; readonly text: string };

export async function loadArrangement(storage: CanvasStoragePort, canvas: CanvasId): Promise<LoadResult> {
  const stored = await storage.readDocument('workspace', arrangementKey(canvas));
  if (stored === null) return { status: 'missing' };
  const decoded = decodeArrangement(stored);
  if (!decoded.ok) return { status: 'read-only', reason: decoded.reason, message: decoded.message, text: stored };
  if (decoded.arrangement.canvasId !== canvas) return { status: 'read-only', reason: 'mismatch', message: 'Stored arrangement belongs to another canvas', text: stored };
  return { status: 'loaded', arrangement: decoded.arrangement, baseText: stored };
}

export type SaveResult =
  | { readonly status: 'saved'; readonly baseText: string }
  | { readonly status: 'unchanged'; readonly baseText: string }
  /** The stored record changed since `baseText` was read; nothing was written. */
  | { readonly status: 'conflict'; readonly currentText: string | null };

/**
 * Write the arrangement record only. `baseText` is the text this editor last
 * loaded or saved (`null` when it started from nothing); a different stored
 * record is reported as a conflict rather than overwritten. This check is
 * advisory: atomic compare-and-swap belongs to the durable store adapter.
 */
export async function saveArrangement(storage: CanvasStoragePort, arrangement: CanvasArrangement, baseText: string | null): Promise<SaveResult> {
  const key = arrangementKey(arrangement.canvasId);
  const next = encodeArrangement(arrangement);
  const current = await storage.readDocument('workspace', key);
  if (current !== baseText) return { status: 'conflict', currentText: current };
  if (current === next) return { status: 'unchanged', baseText: next };
  await storage.writeDocument('workspace', key, next);
  return { status: 'saved', baseText: next };
}
