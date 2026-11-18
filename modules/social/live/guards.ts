import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import {
  RUN_STATUSES, TOOL_CATEGORIES, isChannel, isJsonObject, isToolId, checkSlot, FEATURE_HQ_EDITORIAL_TIMEBOX,
  type Brand, type Draft, type RunRecord, type RunStatus, type Tool, type ToolCategory,
} from '../core';

/**
 * Fail-closed guards for the Social service's native response bodies (Fieldnotes `server.py`): every
 * field the port promises is checked, unknown fields (such as the workspace token) are dropped, and any
 * mismatch returns null so the adapter reports `unknown` instead of rendering an unproved shape.
 */

const str = (value: unknown): value is string => typeof value === 'string';
const int = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const flag = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const nullableStr = (value: unknown): value is string | null => value === null || str(value);

export function guardBrand(value: unknown): Brand | null {
  if (!isJsonObject(value) || !str(value.id) || !str(value.name)) return null;
  const brand: Brand = { id: value.id, name: value.name };
  if ('project_id' in value) {
    if (!nullableStr(value.project_id)) return null;
    brand.project_id = value.project_id;
  }
  return brand;
}

function guardLinks(value: unknown): ReferenceEnvelope[] | null {
  if (!Array.isArray(value)) return null;
  const links = value.map(parseReference);
  return links.every((link): link is ReferenceEnvelope => link !== null) ? links : null;
}

export function guardDraft(value: unknown, features?: readonly string[]): Draft | null {
  if (!isJsonObject(value)) return null;
  const { id, title, body, brand_id, channel, planned_date, archived, version, updated_at } = value;
  if (!str(id) || !str(title) || !str(body) || !str(brand_id) || !isChannel(channel) || !str(planned_date)
    || !flag(archived) || !int(version) || !str(updated_at)) return null;
  const draft: Draft = { id, title, body, brand_id, channel, planned_date, archived, version, updated_at };
  if ('planning_slot' in value) {
    if (value.planning_slot === undefined) return null;
    const slot = checkSlot(value.planning_slot, planned_date, [FEATURE_HQ_EDITORIAL_TIMEBOX]);
    if (!slot.ok) return null;
    if (!features || features.includes(FEATURE_HQ_EDITORIAL_TIMEBOX)) draft.planning_slot = slot.value ?? null;
  }
  if ('links' in value) {
    const links = guardLinks(value.links);
    if (!links) return null;
    draft.links = links;
  }
  return draft;
}

export function guardRun(value: unknown): RunRecord | null {
  if (!isJsonObject(value)) return null;
  const { id, tool, status, is_example, created_at, finished_at, error } = value;
  if (!str(id) || !isToolId(tool) || !(RUN_STATUSES as readonly unknown[]).includes(status) || !flag(is_example)
    || !str(created_at) || !nullableStr(finished_at) || !nullableStr(error)) return null;
  const run: RunRecord = { id, tool, status: status as RunStatus, is_example, created_at, finished_at, error };
  if ('output' in value) run.output = value.output;
  return run;
}

export function guardTool(value: unknown): Tool | null {
  if (!isJsonObject(value)) return null;
  const { id, name, category, description, mark } = value;
  if (!isToolId(id) || !str(name) || !(TOOL_CATEGORIES as readonly unknown[]).includes(category) || !str(description) || !str(mark)) return null;
  return { id, name, category: category as ToolCategory, description, mark };
}

function guardList<T>(value: unknown, guard: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(guard);
  return items.every((item): item is T => item !== null) ? items : null;
}

/** The workspace body without `observedAt`, which the client stamps. `features` defaults to `[]`. */
export interface GuardedWorkspace {
  readonly brands: Brand[];
  readonly content: Draft[];
  readonly runs: RunRecord[];
  readonly tools: Tool[];
  readonly features: string[];
}

export function guardWorkspace(value: unknown): GuardedWorkspace | null {
  if (!isJsonObject(value)) return null;
  const brands = guardList(value.brands, guardBrand);

  const runs = guardList(value.runs, guardRun);
  const tools = guardList(value.tools, guardTool);
  const features = value.features === undefined ? [] : guardList(value.features, (item) => (str(item) ? item : null));
  if (!features) return null;
  const content = guardList(value.content, (item) => guardDraft(item, features));
  if (!brands || !content || !runs || !tools) return null;
  return { brands, content, runs, tools, features };
}

/** A sample is a JSON object of tool input; anything else fails closed. */
export function guardSample(value: unknown): Record<string, unknown> | null {
  return isJsonObject(value) ? value : null;
}

/** The service's error envelope is exactly `{ error: string }`; only then is its text shown. */
export function errorText(value: unknown): string | null {
  return isJsonObject(value) && str(value.error) ? value.error : null;
}
