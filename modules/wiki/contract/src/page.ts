// Page: one resolved document as the reader consumes it.

import { checkInertText, checkKeys, checkLabel, isRecord, utf8ByteLength } from './guard.ts';
import { checkMarkdownDocument, checkLinkTarget, type LinkTarget, type MarkdownDocument } from './ast.ts';
import {
  MAX_FIELD_LIST_ITEMS,
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_VALUE_LENGTH,
  MAX_FIELDS,
  MAX_LABEL_LENGTH,
  MAX_OUT_LINKS,
  MAX_PAGE_BLOB_BYTES,
  checkPageBlobSize,
} from './limits.ts';
import { checkPageKey, type PageKey } from './page-key.ts';
import { checkCommitId } from './source.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

export type FieldScalar = string | number | boolean;
export type FieldValue = FieldScalar | readonly FieldScalar[];

/** One frontmatter field. A list (not an object) so field order is preserved and names cannot collide with prototype keys. */
export interface PageField {
  readonly name: string;
  readonly value: FieldValue;
}

export interface OutLink {
  /** Link text as written, shown inertly. */
  readonly text: string;
  readonly target: LinkTarget;
}

export const RAW_REASONS = ['frontmatter-unsupported', 'markdown-unsupported', 'not-text'] as const;
export type RawReason = (typeof RAW_REASONS)[number];

/**
 * `parsed`: the safe AST is available. `raw`: parsing fell back; `text` is shown verbatim and inert
 * (e.g. malformed frontmatter stays readable).
 */
export type PageContent =
  | { readonly state: 'parsed'; readonly ast: MarkdownDocument }
  | { readonly state: 'raw'; readonly reason: RawReason; readonly text: string };

export interface Page {
  readonly key: PageKey;
  readonly title: string;
  /** Commit the page was read from (matches the namespace's SourceDescriptor.commit). */
  readonly commit: string;
  /** Size of the source blob in bytes (≤ MAX_PAGE_BLOB_BYTES). */
  readonly byteLength: number;
  readonly fields: readonly PageField[];
  readonly outLinks: readonly OutLink[];
  readonly content: PageContent;
}

const FIELD_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const RESERVED_FIELD_NAMES: readonly string[] = ['__proto__', 'constructor', 'prototype'];

function checkScalar(value: unknown, path: string): WikiError | null {
  if (typeof value === 'string') return checkInertText(value, path, MAX_FIELD_VALUE_LENGTH);
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : invalid('out-of-range', 'numbers must be finite', path);
  return invalid('wrong-type', 'field values must be strings, numbers, booleans or lists of those', path);
}

export function checkPageField(value: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'field must be an object', path);
  const keys = checkKeys(value, ['name', 'value'], ['name', 'value'], path);
  if (keys !== null) return keys;
  const name = value['name'];
  if (typeof name !== 'string') return invalid('wrong-type', 'field name must be a string', `${path}.name`);
  if (name.length === 0 || name.length > MAX_FIELD_NAME_LENGTH || !FIELD_NAME.test(name) || RESERVED_FIELD_NAMES.includes(name)) {
    return invalid('invalid-format', 'field name must be a short plain identifier', `${path}.name`);
  }
  const fieldValue = value['value'];
  if (Array.isArray(fieldValue)) {
    if (fieldValue.length > MAX_FIELD_LIST_ITEMS) return invalid('out-of-range', `lists are limited to ${MAX_FIELD_LIST_ITEMS} items`, `${path}.value`);
    for (const [i, item] of fieldValue.entries()) {
      if (Array.isArray(item)) return invalid('wrong-type', 'lists cannot nest', `${path}.value[${i}]`);
      const error = checkScalar(item, `${path}.value[${i}]`);
      if (error !== null) return error;
    }
    return null;
  }
  return checkScalar(fieldValue, `${path}.value`);
}

export function checkOutLink(value: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'out-link must be an object', path);
  return (
    checkKeys(value, ['text', 'target'], ['text', 'target'], path) ??
    checkInertText(value['text'], `${path}.text`, MAX_LABEL_LENGTH) ??
    checkLinkTarget(value['target'], `${path}.target`)
  );
}

function checkContent(value: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'content must be an object', path);
  if (value['state'] === 'parsed') {
    return checkKeys(value, ['state', 'ast'], ['state', 'ast'], path) ?? checkMarkdownDocument(value['ast'], `${path}.ast`);
  }
  if (value['state'] === 'raw') {
    const keys = checkKeys(value, ['state', 'reason', 'text'], ['state', 'reason', 'text'], path);
    if (keys !== null) return keys;
    if (typeof value['reason'] !== 'string' || !(RAW_REASONS as readonly string[]).includes(value['reason'])) {
      return invalid('invalid-format', `reason must be one of ${RAW_REASONS.join(', ')}`, `${path}.reason`);
    }
    const text = checkInertText(value['text'], `${path}.text`, MAX_PAGE_BLOB_BYTES);
    if (text !== null) return text;
    return utf8ByteLength(value['text'] as string) > MAX_PAGE_BLOB_BYTES
      ? invalid('too-large', `raw text exceeds ${MAX_PAGE_BLOB_BYTES} bytes`, `${path}.text`)
      : null;
  }
  return invalid('invalid-format', 'content state must be parsed or raw', `${path}.state`);
}

export function checkPage(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'page must be an object', path);
  const keys = checkKeys(
    value,
    ['key', 'title', 'commit', 'byteLength', 'fields', 'outLinks', 'content'],
    ['key', 'title', 'commit', 'byteLength', 'fields', 'outLinks', 'content'],
    path,
  );
  if (keys !== null) return keys;
  const head =
    checkPageKey(value['key'], `${path}.key`) ??
    checkLabel(value['title'], `${path}.title`, MAX_LABEL_LENGTH) ??
    checkCommitId(value['commit'], `${path}.commit`) ??
    checkPageBlobSize(value['byteLength'], `${path}.byteLength`);
  if (head !== null) return head;

  const fields = value['fields'];
  if (!Array.isArray(fields)) return invalid('wrong-type', 'fields must be an array', `${path}.fields`);
  if (fields.length > MAX_FIELDS) return invalid('out-of-range', `pages are limited to ${MAX_FIELDS} fields`, `${path}.fields`);
  const names = new Set<string>();
  for (const [i, field] of fields.entries()) {
    const error = checkPageField(field, `${path}.fields[${i}]`);
    if (error !== null) return error;
    const name = (field as PageField).name;
    if (names.has(name)) return invalid('duplicate', `duplicate field "${name}"`, `${path}.fields[${i}].name`);
    names.add(name);
  }

  const outLinks = value['outLinks'];
  if (!Array.isArray(outLinks)) return invalid('wrong-type', 'outLinks must be an array', `${path}.outLinks`);
  if (outLinks.length > MAX_OUT_LINKS) return invalid('out-of-range', `pages are limited to ${MAX_OUT_LINKS} out-links`, `${path}.outLinks`);
  for (const [i, link] of outLinks.entries()) {
    const error = checkOutLink(link, `${path}.outLinks[${i}]`);
    if (error !== null) return error;
  }
  return checkContent(value['content'], `${path}.content`);
}

export function validatePage(value: unknown): WikiResult<Page> {
  return resultOf(checkPage(value), value as Page);
}
