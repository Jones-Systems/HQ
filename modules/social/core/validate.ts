import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import {
  CHANNELS, FEATURE_HQ_REFERENCES, MAX_DRAFT_LINKS, TOOL_IDS,
  type Channel, type DraftFields, type PortError, type ToolId,
} from './port';
import { checkSlot } from './timebox';

/**
 * Client validation mirroring the Social workspace service's save, brand and run rules,
 * check order and messages. The service still validates again; this never replaces it.
 */

export type Invalid = Extract<PortError, { kind: 'invalid' }>;
export type Checked<T> = { ok: true; value: T } | { ok: false; error: Invalid };

/** Matches the service's request body limit, measured on the serialized JSON. */
export const MAX_BODY_BYTES = 2_000_000;
export const LIMITS = { title: 200, body: 50_000, brandName: 80, id: 32 } as const;

export const MESSAGES = {
  unknownChannel: 'Unknown channel',
  plannedDate: 'Use a YYYY-MM-DD planning date',
  plannedDateText: 'Planning date must be text',
  archived: 'Invalid archive state',
  unknownBrand: 'Unknown brand',
  version: 'Version required',
  conflict: 'This draft changed in another window. Close and reopen it before saving.',
  runInput: 'Choose a known tool and supply a JSON object',
  exampleFlag: 'Example label must be boolean',
  queueFull: 'Run queue is full. Wait for a run to finish.',
  runId: 'Invalid run ID',
  unknownTool: 'Unknown tool',
  bodySize: 'Input must be 1–2,000,000 bytes',
  jsonObject: 'JSON object required',
  interrupted: 'Service restarted before completion; run again explicitly.',
  /** HQ-local, for the proposed links field; not service text. */
  linksUnsupported: 'This Social service cannot save links yet (needs hq-references-v1). Remove them or copy them out before saving.',
  linksInvalid: `Links must be a list of 0–${MAX_DRAFT_LINKS} valid HQ references`,
} as const;

export function textMessage(label: string, maximum: number, empty = false): string {
  return `${label} must be text, ${empty ? '0' : '1'}–${maximum} characters`;
}

// Python str.isspace() for str.strip(); JavaScript trim() differs (\x1c–\x1f, \x85, ﻿).
const PY_SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu');
export function pyStrip(value: string): string {
  return value.replace(PY_STRIP, '');
}

/** Python len(): code points, not UTF-16 units. */
export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isJsonObject(value)) return Object.keys(value).length > 0;
  return true;
}

/** dict.get(key, fallback) over decoded JSON, where an undefined value is an absent key. */
function get(data: Record<string, unknown>, key: string, fallback: unknown = undefined): unknown {
  return data[key] === undefined ? fallback : data[key];
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function invalid(message: string): { ok: false; error: Invalid } {
  return { ok: false, error: { kind: 'invalid', message } };
}

function text(value: unknown, label: string, maximum: number, empty = false): Checked<string> {
  if (typeof value !== 'string' || codePoints(value) > maximum || (!empty && pyStrip(value) === '')) {
    return invalid(textMessage(label, maximum, empty));
  }
  return { ok: true, value: label === 'Body' ? value : pyStrip(value) };
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}

/** True when `date.fromisoformat(value).isoformat() == value` would hold. */
export function isPlanningDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= days;
}

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value);
}

export interface CheckedDraft {
  readonly fields: Omit<DraftFields, 'links'>;
  /** Present for an update. */
  readonly target?: { readonly id: string; readonly version: number };
  /** Present only when the draft carries links and the service can store them. */
  readonly links?: ReferenceEnvelope[];
}

export interface DraftCheckContext {
  readonly features: readonly string[];
  /** When known, an unknown brand is rejected locally with the service's message. */
  readonly brandIds?: readonly string[];
}

/** Validates a save in the service's order: title, body, channel, date, archive, slot, brand, ID, version. */
export function checkDraft(input: unknown, context: DraftCheckContext): Checked<CheckedDraft> {
  if (!isJsonObject(input)) return invalid(MESSAGES.jsonObject);
  const title = text(get(input, 'title'), 'Title', LIMITS.title);
  if (!title.ok) return title;
  const body = text(get(input, 'body', ''), 'Body', LIMITS.body, true);
  if (!body.ok) return body;
  const channel = get(input, 'channel', 'General');
  if (!isChannel(channel)) return invalid(MESSAGES.unknownChannel);
  const planned = get(input, 'planned_date', '');
  if (pyTruthy(planned)) {
    if (typeof planned !== 'string' || !isPlanningDate(planned)) return invalid(MESSAGES.plannedDate);
  } else if (planned !== '') {
    return invalid(MESSAGES.plannedDateText);
  }
  const archived = get(input, 'archived', false);
  if (!(typeof archived === 'boolean' || archived === 0 || archived === 1)) return invalid(MESSAGES.archived);
  const slot = checkSlot(get(input, 'planning_slot'), planned as string, context.features);
  if (!slot.ok) return slot;
  const brand = get(input, 'brand_id', 'default');
  if (typeof brand !== 'string' || (context.brandIds && !context.brandIds.includes(brand))) {
    return invalid(MESSAGES.unknownBrand);
  }
  let target: CheckedDraft['target'];
  if (pyTruthy(get(input, 'id'))) {
    const id = text(input.id, 'ID', LIMITS.id);
    if (!id.ok) return id;
    const version = get(input, 'version');
    if (typeof version !== 'number' || !Number.isSafeInteger(version)) return invalid(MESSAGES.version);
    target = { id: id.value, version };
  }
  const links = checkLinks(get(input, 'links'), context.features);
  if (!links.ok) return links;
  return {
    ok: true,
    value: {
      fields: {
        title: title.value, body: body.value, brand_id: brand, channel,
        planned_date: planned as string, archived: archived === true || archived === 1 ? 1 : 0,
        ...(slot.value !== undefined ? { planning_slot: slot.value } : {}),
      },
      ...(target ? { target } : {}),
      ...(links.value ? { links: links.value } : {}),
    },
  };
}

/**
 * Proposed `links` gate. Without `hq-references-v1` the service would silently drop links,
 * so a draft carrying any is rejected locally. An absent or empty list is not sent.
 */
export function checkLinks(value: unknown, features: readonly string[]): Checked<ReferenceEnvelope[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!features.includes(FEATURE_HQ_REFERENCES)) {
    return Array.isArray(value) && value.length === 0 ? { ok: true, value: undefined } : invalid(MESSAGES.linksUnsupported);
  }
  if (!Array.isArray(value) || value.length > MAX_DRAFT_LINKS) return invalid(MESSAGES.linksInvalid);
  const parsed = value.map(parseReference);
  if (parsed.some((item) => item === null)) return invalid(MESSAGES.linksInvalid);
  return { ok: true, value: parsed as ReferenceEnvelope[] };
}

export function checkBrandName(name: unknown): Checked<string> {
  return text(name, 'Brand name', LIMITS.brandName);
}

export interface CheckedRun {
  readonly tool: ToolId;
  readonly input: Record<string, unknown>;
  readonly isExample: boolean;
}

/** Mirrors the service: body size first, then tool and input, then the example flag. */
export function checkRunSubmission(tool: unknown, input: unknown, isExample: unknown): Checked<CheckedRun> {
  const bytes = new TextEncoder().encode(JSON.stringify({ tool, input, is_example: isExample }) ?? '').length;
  if (bytes < 1 || bytes > MAX_BODY_BYTES) return invalid(MESSAGES.bodySize);
  if (!isToolId(tool) || !isJsonObject(input)) return invalid(MESSAGES.runInput);
  if (typeof isExample !== 'boolean') return invalid(MESSAGES.exampleFlag);
  return { ok: true, value: { tool, input, isExample } };
}
