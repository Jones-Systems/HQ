import path from 'node:path';
import { fail } from './errors.ts';
import type { Limits } from './safe-fs.ts';
import { DEFAULT_LIMITS } from './safe-fs.ts';

export const CONFIG_SCHEMA = 'hq.design.reference-producer-config/v1';

export interface DeclaredRightsConfig {
  readonly vocabulary: string;
  readonly value: string;
  readonly basis?: string;
  readonly attribution?: string;
}

export interface ProducerRef {
  readonly id: string;
  readonly label?: string;
}

interface SourceBase {
  readonly id: string;
  readonly root: string;
  readonly producer: ProducerRef | null;
  readonly rights: DeclaredRightsConfig | null;
  readonly limits: Limits;
}

export interface GallerySource extends SourceBase {
  readonly kind: 'gallery';
  readonly pointer: string;
  readonly releases: readonly string[];
}

export interface StudySource extends SourceBase {
  readonly kind: 'study';
}

export type SourceDescriptor = GallerySource | StudySource;

export interface ProducerConfig {
  readonly outputRoot: string;
  readonly sources: readonly SourceDescriptor[];
}

type Json = Record<string, unknown>;

function object(value: unknown, where: string, allowed: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('config-invalid', where);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return fail('config-unknown-field', `${where}.<unknown>`);
  return value as Json;
}

const TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);

function limits(value: unknown, where: string): Limits {
  if (value === undefined) return DEFAULT_LIMITS;
  const raw = object(value, where, ['maxFileBytes', 'maxJsonBytes', 'maxTotalBytes', 'maxFiles']);
  const pick = (key: keyof Limits): number => {
    const found = raw[key];
    if (found === undefined) return DEFAULT_LIMITS[key];
    // Caps can only be lowered: a config cannot raise a limit above the built-in ceiling.
    if (typeof found !== 'number' || !Number.isSafeInteger(found) || found < 1 || found > DEFAULT_LIMITS[key]) return fail('config-invalid', `${where}.${key}`);
    return found;
  };
  return { maxFileBytes: pick('maxFileBytes'), maxJsonBytes: pick('maxJsonBytes'), maxTotalBytes: pick('maxTotalBytes'), maxFiles: pick('maxFiles') };
}

/** Strict closed-shape parse of the external local configuration. Values are never echoed in errors. */
export function parseConfig(bytes: Uint8Array): ProducerConfig {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('config-not-json'); }
  const raw = object(value, '$', ['schema', 'outputRoot', 'sources']);
  if (raw.schema !== CONFIG_SCHEMA) return fail(typeof raw.schema === 'string' && /^hq\.design\.reference-producer-config\/v[2-9]/u.test(raw.schema) ? 'config-future-version' : 'config-invalid', '$.schema');
  if (!text(raw.outputRoot, 1024) || !path.isAbsolute(raw.outputRoot)) return fail('config-invalid', '$.outputRoot');
  if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > 64) return fail('config-invalid', '$.sources');
  const seen = new Set<string>();
  const sources = raw.sources.map((item: unknown, index): SourceDescriptor => {
    const where = `$.sources[${index}]`;
    const source = object(item, where, ['id', 'kind', 'root', 'pointer', 'releases', 'producer', 'rights', 'limits']);
    if (typeof source.id !== 'string' || !TOKEN.test(source.id) || seen.has(source.id)) return fail('config-invalid', `${where}.id`);
    seen.add(source.id);
    if (!text(source.root, 1024) || !path.isAbsolute(source.root)) return fail('config-invalid', `${where}.root`);
    let producer: ProducerRef | null = null;
    if (source.producer !== undefined) {
      const ref = object(source.producer, `${where}.producer`, ['id', 'label']);
      if (!text(ref.id, 100) || (ref.label !== undefined && !text(ref.label, 200))) return fail('config-invalid', `${where}.producer`);
      producer = ref.label === undefined ? { id: ref.id } : { id: ref.id, label: ref.label as string };
    }
    let rights: DeclaredRightsConfig | null = null;
    if (source.rights !== undefined) {
      const r = object(source.rights, `${where}.rights`, ['vocabulary', 'value', 'basis', 'attribution']);
      if (!text(r.vocabulary, 64) || !text(r.value, 64) || (r.basis !== undefined && !text(r.basis, 500)) || (r.attribution !== undefined && !text(r.attribution, 500))) {
        return fail('config-invalid', `${where}.rights`);
      }
      rights = r as unknown as DeclaredRightsConfig;
    }
    const base = { id: source.id, root: source.root, producer, rights, limits: limits(source.limits, `${where}.limits`) };
    if (source.kind === 'gallery') {
      if (typeof source.pointer !== 'string' || !NAME.test(source.pointer)) return fail('config-invalid', `${where}.pointer`);
      if (!Array.isArray(source.releases) || source.releases.length < 1 || source.releases.length > 8
        || !source.releases.every((name: unknown) => typeof name === 'string' && NAME.test(name)) || new Set(source.releases).size !== source.releases.length
        || source.releases.includes(source.pointer)) return fail('config-invalid', `${where}.releases`);
      return { ...base, kind: 'gallery', pointer: source.pointer, releases: source.releases as string[] };
    }
    if (source.kind === 'study') {
      if (source.pointer !== undefined || source.releases !== undefined) return fail('config-unknown-field', `${where}.pointer`);
      return { ...base, kind: 'study' };
    }
    return fail('config-invalid', `${where}.kind`);
  });
  return { outputRoot: raw.outputRoot, sources };
}
