import { fail } from './errors.ts';
import type { Tally } from './tally.ts';

export type Json = Record<string, unknown>;

/** Fields that are taste or captured-content material: dropped and counted, never read or copied. */
const EXCLUDED_FIELDS: readonly string[] = ['rating', 'ratings', 'note', 'notes', 'taste', 'html', 'js', 'css', 'script', 'scripts', 'markup'];

/**
 * Parses a source JSON document and checks its schema discriminator. An unknown name is
 * `unknown-schema`; the same name with a newer version is `future-version`. Both abort the run.
 */
export function parseDocument(bytes: Uint8Array, schema: string, where: string): Json {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('not-json', where); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('invalid-document', where);
  const found = (value as Json).schema;
  if (found === schema) return value as Json;
  const [name] = schema.split('/v');
  if (typeof found === 'string' && found.startsWith(`${name}/v`)) {
    const version = Number(found.slice(`${name}/v`.length));
    if (Number.isInteger(version) && version > Number(schema.slice(schema.lastIndexOf('/v') + 2))) return fail('future-version', where);
  }
  return fail('unknown-schema', where);
}

/** Counts every field outside `allowed`, separating taste/content material from other unknown fields. */
export function account(raw: Json, allowed: readonly string[], tally: Tally): void {
  for (const key of Object.keys(raw)) {
    if (allowed.includes(key)) continue;
    tally.add(EXCLUDED_FIELDS.includes(key.toLowerCase()) ? 'fields-excluded' : 'fields-ignored');
  }
}

export function obj(value: unknown, where: string): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : fail('invalid-field', where);
}

export function arr(value: unknown, where: string, max: number): readonly unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail('invalid-field', where);
}

export function str(value: unknown, where: string, max = 300): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value : fail('invalid-field', where);
}

export function optionalStr(value: unknown, where: string, max = 300): string | undefined {
  return value === undefined ? undefined : str(value, where, max);
}

export function posInt(value: unknown, where: string): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail('invalid-field', where);
}

export function digest(value: unknown, where: string): string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value) ? value : fail('invalid-field', where);
}
