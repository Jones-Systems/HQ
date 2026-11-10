// Source profile: the data-only external descriptor of one namespace's pinned source.
// Prefix and relationship tables live in profiles supplied at runtime; nothing here names a real corpus.

import {
  MAX_PATH_LENGTH,
  NAMESPACES,
  failWith,
  invalid,
  ok,
  validatePagePath,
  type WikiNamespace,
  type WikiResult,
} from '../../contract/src/index.ts';
import { fnv64Hex } from './text.ts';

export const TOPIC_MODES = ['field', 'directory', 'none'] as const;
export type TopicMode = (typeof TOPIC_MODES)[number];

export interface FieldMappings {
  /** Frontmatter field naming the page title; null = no field, the title falls back to H1 then file stem. */
  readonly title: string | null;
  /** Frontmatter fields whose values are alternative names of the page. */
  readonly aliases: readonly string[];
  /** Frontmatter fields whose values are topic labels (used when `topicMode` is `field`). */
  readonly topics: readonly string[];
  /** Frontmatter fields whose values name other pages (read as wiki-link targets). */
  readonly relationships: readonly string[];
}

export interface SourceProfile {
  readonly namespace: WikiNamespace;
  /** Absolute path of the configured bare repository. The adapter resolves it to a real path. */
  readonly gitDir: string;
  /** Exact value `remote.origin.url` must have. */
  readonly expectedRemote: string;
  /** Plain branch label; resolved as `refs/heads/<ref>`. */
  readonly ref: string;
  /** Directory inside the repository that is the namespace root; empty = repository root. */
  readonly rootPrefix: string;
  /** Lowercase extensions (with the dot) of page files. */
  readonly pageExtensions: readonly string[];
  readonly fieldMappings: FieldMappings;
  readonly topicMode: TopicMode;
}

const MAX_GIT_DIR_LENGTH = 4096;
const MAX_REMOTE_LENGTH = 2048;
const MAX_MAPPED_FIELDS = 16;
const FIELD_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const RESERVED_FIELD_NAMES: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const EXTENSION = /^\.[A-Za-z0-9]{1,16}$/;
const REF_LABEL = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,255}$/;
const ABSOLUTE = /^(?:\/(?!\/)|[A-Za-z]:[\\/])/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const REMOTE_CREDENTIALS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/;
const PROFILE_KEYS = ['namespace', 'gitDir', 'expectedRemote', 'ref', 'rootPrefix', 'pageExtensions', 'fieldMappings', 'topicMode'];
const MAPPING_KEYS = ['title', 'aliases', 'topics', 'relationships'];

/** Generic defaults only; real field names come from the external profile. */
export const DEFAULT_FIELD_MAPPINGS: FieldMappings = Object.freeze({
  title: 'title',
  aliases: Object.freeze(['aliases']),
  topics: Object.freeze(['tags']),
  relationships: Object.freeze([]),
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[], path: string): WikiResult<never> | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return failWith(invalid('unknown-property', `unknown property "${key}"`, `${path}.${key}`));
  }
  return null;
}

function checkRefLabel(value: string): boolean {
  if (!REF_LABEL.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/') || value.endsWith('.')) return false;
  return value.split('/').every((segment) => !segment.startsWith('.') && !segment.endsWith('.lock'));
}

function fieldNameList(value: unknown, path: string): WikiResult<readonly string[]> {
  if (!Array.isArray(value)) return failWith(invalid('wrong-type', 'expected an array of field names', path));
  if (value.length > MAX_MAPPED_FIELDS) return failWith(invalid('too-long', `at most ${MAX_MAPPED_FIELDS} fields`, path));
  const seen = new Set<string>();
  for (const [i, name] of value.entries()) {
    const error = fieldNameError(name, `${path}[${i}]`);
    if (error !== null) return failWith(error);
    if (seen.has(name as string)) return failWith(invalid('duplicate', 'duplicate field name', `${path}[${i}]`));
    seen.add(name as string);
  }
  return ok(Object.freeze([...(value as string[])]));
}

function fieldNameError(name: unknown, path: string) {
  if (typeof name !== 'string') return invalid('wrong-type', 'field name must be a string', path);
  if (name.length === 0 || name.length > 64 || !FIELD_NAME.test(name) || RESERVED_FIELD_NAMES.includes(name)) {
    return invalid('invalid-format', 'field name must be a short plain identifier', path);
  }
  return null;
}

/**
 * Validate and normalise a data-only source profile (defaults filled, extensions lowercased).
 * The result is a fresh frozen object; the input is never retained.
 */
export function validateSourceProfile(value: unknown): WikiResult<SourceProfile> {
  if (!isPlainRecord(value)) return failWith(invalid('wrong-type', 'profile must be an object', '$'));
  const unknown = unknownKey(value, PROFILE_KEYS, '$');
  if (unknown !== null) return unknown;
  for (const required of ['namespace', 'gitDir', 'expectedRemote', 'ref']) {
    if (!(required in value)) return failWith(invalid('missing-property', `missing property "${required}"`, `$.${required}`));
  }

  const namespace = value['namespace'];
  if (typeof namespace !== 'string' || !(NAMESPACES as readonly string[]).includes(namespace)) {
    return failWith(invalid('unknown-namespace', `namespace must be one of ${NAMESPACES.join(', ')}`, '$.namespace'));
  }

  const gitDir = value['gitDir'];
  if (typeof gitDir !== 'string') return failWith(invalid('wrong-type', 'gitDir must be a string', '$.gitDir'));
  if (gitDir.length === 0 || gitDir.length > MAX_GIT_DIR_LENGTH) return failWith(invalid('too-long', 'gitDir length is out of range', '$.gitDir'));
  if (CONTROL.test(gitDir)) return failWith(invalid('control-character', 'gitDir contains a control character', '$.gitDir'));
  if (!ABSOLUTE.test(gitDir)) return failWith(invalid('invalid-format', 'gitDir must be an absolute path', '$.gitDir'));
  if (gitDir.split(/[\\/]/).includes('..')) return failWith(invalid('traversal', 'gitDir must not contain dot-dot segments', '$.gitDir'));

  const remote = value['expectedRemote'];
  if (typeof remote !== 'string') return failWith(invalid('wrong-type', 'expectedRemote must be a string', '$.expectedRemote'));
  if (remote.length === 0 || remote.length > MAX_REMOTE_LENGTH) return failWith(invalid('too-long', 'expectedRemote length is out of range', '$.expectedRemote'));
  if (CONTROL.test(remote) || /\s/.test(remote)) return failWith(invalid('invalid-format', 'expectedRemote contains whitespace or controls', '$.expectedRemote'));
  if (remote.startsWith('-')) return failWith(invalid('invalid-format', 'expectedRemote must not start with a dash', '$.expectedRemote'));
  if (REMOTE_CREDENTIALS.test(remote)) return failWith(invalid('forbidden-capability', 'expectedRemote must not embed credentials', '$.expectedRemote'));

  const ref = value['ref'];
  if (typeof ref !== 'string' || !checkRefLabel(ref)) return failWith(invalid('invalid-format', 'ref must be a plain branch label', '$.ref'));

  let rootPrefix = '';
  if ('rootPrefix' in value) {
    const prefix = value['rootPrefix'];
    if (typeof prefix !== 'string') return failWith(invalid('wrong-type', 'rootPrefix must be a string', '$.rootPrefix'));
    if (prefix.length > MAX_PATH_LENGTH) return failWith(invalid('too-long', 'rootPrefix is too long', '$.rootPrefix'));
    if (prefix !== '') {
      const result = validatePagePath(prefix);
      if (!result.ok) return failWith(invalid('invalid-format', 'rootPrefix must be empty or a relative path of plain segments', '$.rootPrefix'));
      rootPrefix = prefix;
    }
  }

  let pageExtensions: readonly string[] = Object.freeze(['.md']);
  if ('pageExtensions' in value) {
    const list = value['pageExtensions'];
    if (!Array.isArray(list)) return failWith(invalid('wrong-type', 'pageExtensions must be an array', '$.pageExtensions'));
    if (list.length < 1 || list.length > 8) return failWith(invalid('out-of-range', 'pageExtensions needs 1..8 entries', '$.pageExtensions'));
    const lowered: string[] = [];
    for (const [i, ext] of list.entries()) {
      if (typeof ext !== 'string' || !EXTENSION.test(ext)) {
        return failWith(invalid('invalid-format', 'an extension is a dot plus 1..16 letters or digits', `$.pageExtensions[${i}]`));
      }
      if (lowered.includes(ext.toLowerCase())) return failWith(invalid('duplicate', 'duplicate extension', `$.pageExtensions[${i}]`));
      lowered.push(ext.toLowerCase());
    }
    pageExtensions = Object.freeze(lowered);
  }

  let fieldMappings: FieldMappings = DEFAULT_FIELD_MAPPINGS;
  if ('fieldMappings' in value) {
    const mappings = value['fieldMappings'];
    if (!isPlainRecord(mappings)) return failWith(invalid('wrong-type', 'fieldMappings must be an object', '$.fieldMappings'));
    const unknownMapping = unknownKey(mappings, MAPPING_KEYS, '$.fieldMappings');
    if (unknownMapping !== null) return unknownMapping;
    let title: string | null = DEFAULT_FIELD_MAPPINGS.title;
    if ('title' in mappings) {
      if (mappings['title'] === null) title = null;
      else {
        const error = fieldNameError(mappings['title'], '$.fieldMappings.title');
        if (error !== null) return failWith(error);
        title = mappings['title'] as string;
      }
    }
    const lists: Record<'aliases' | 'topics' | 'relationships', readonly string[]> = {
      aliases: DEFAULT_FIELD_MAPPINGS.aliases,
      topics: DEFAULT_FIELD_MAPPINGS.topics,
      relationships: DEFAULT_FIELD_MAPPINGS.relationships,
    };
    for (const key of ['aliases', 'topics', 'relationships'] as const) {
      if (!(key in mappings)) continue;
      const list = fieldNameList(mappings[key], `$.fieldMappings.${key}`);
      if (!list.ok) return list;
      lists[key] = list.value;
    }
    fieldMappings = Object.freeze({ title, aliases: lists.aliases, topics: lists.topics, relationships: lists.relationships });
  }

  let topicMode: TopicMode = 'field';
  if ('topicMode' in value) {
    const mode = value['topicMode'];
    if (typeof mode !== 'string' || !(TOPIC_MODES as readonly string[]).includes(mode)) {
      return failWith(invalid('invalid-format', `topicMode must be one of ${TOPIC_MODES.join(', ')}`, '$.topicMode'));
    }
    topicMode = mode as TopicMode;
  }

  return ok(
    Object.freeze({
      namespace: namespace as WikiNamespace,
      gitDir,
      expectedRemote: remote,
      ref,
      rootPrefix,
      pageExtensions,
      fieldMappings,
      topicMode,
    }),
  );
}

/** Version of the parsing/indexing rules; bumping it makes older snapshots rebuild. */
export const INDEX_RULES_VERSION = 1;

/** Stable key of everything in a profile (and the rules version) that changes the index content. */
export function profileIndexKey(profile: SourceProfile): string {
  return fnv64Hex(
    JSON.stringify([
      INDEX_RULES_VERSION,
      profile.namespace,
      profile.ref,
      profile.rootPrefix,
      profile.pageExtensions,
      profile.fieldMappings.title,
      profile.fieldMappings.aliases,
      profile.fieldMappings.topics,
      profile.fieldMappings.relationships,
      profile.topicMode,
    ]),
  );
}
