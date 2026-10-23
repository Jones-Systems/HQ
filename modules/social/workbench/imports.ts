import { MAX_BODY_BYTES, isJsonObject } from '../core';

/**
 * Typed file import. A file is read locally, parsed and previewed; nothing is sent until an explicit Run.
 * The service caps a whole request at 2,000,000 bytes, so a larger file can never run.
 */

export type ImportFormat = 'json' | 'json-or-jsonl';

export interface ImportedValue {
  readonly value: unknown;
  /** Where the value came from, shown in the shape preview. */
  readonly origin: { readonly kind: 'file'; readonly name: string; readonly bytes: number } | { readonly kind: 'example' } | { readonly kind: 'json' };
}

export type ParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/** Line and column (1-based) of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}

/** `line` is set for JSON Lines, where each line is parsed on its own. */
function syntaxMessage(text: string, error: unknown, line?: number): string {
  const raw = error instanceof Error ? error.message : String(error);
  const position = /position (\d+)/u.exec(raw);
  // V8 may quote the offending text; the message names the place instead of echoing file contents.
  const reason = raw.replace(/\s*(?:in JSON\s*)?at position \d+.*$/su, '').replace(/, ".*" is not valid JSON$/su, '').replace(/^JSON\.parse:\s*/u, '');
  if (!position) return line === undefined ? `Not valid JSON: ${reason}` : `Not valid JSON on line ${line}: ${reason}`;
  const at = lineColumn(text, Number(position[1]));
  return `Not valid JSON at line ${line ?? at.line}, column ${at.column}: ${reason}`;
}

/** Parses JSON text, reporting the line and column of a syntax error. */
export function parseJsonText(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: syntaxMessage(text, error) };
  }
}

/** JSON Lines: one JSON value per non-blank line. */
export function parseJsonLines(text: string): ParseResult {
  const rows: unknown[] = [];
  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line) as unknown);
    } catch (error) {
      return { ok: false, message: syntaxMessage(line, error, index + 1) };
    }
  }
  return { ok: true, value: rows };
}

/** A `.jsonl` name, or text that is not one JSON document but parses line by line, is read as JSON Lines. */
export function parseImportText(text: string, name: string, format: ImportFormat): ParseResult {
  if (format === 'json-or-jsonl' && /\.(jsonl|ndjson)$/iu.test(name)) return parseJsonLines(text);
  const whole = parseJsonText(text);
  if (whole.ok || format === 'json') return whole;
  const lines = parseJsonLines(text);
  return lines.ok ? lines : whole;
}

export async function readImportFile(file: File, format: ImportFormat): Promise<{ ok: true; imported: ImportedValue } | { ok: false; message: string }> {
  if (file.size > MAX_BODY_BYTES) return { ok: false, message: `${file.name} is larger than 2 MB. The Social service accepts at most 2,000,000 bytes per run.` };
  if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
  const parsed = parseImportText(await file.text(), file.name, format);
  if (!parsed.ok) return { ok: false, message: `${file.name}: ${parsed.message}` };
  return { ok: true, imported: { value: parsed.value, origin: { kind: 'file', name: file.name, bytes: file.size } } };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function keyList(keys: readonly string[], limit = 6): string {
  if (keys.length === 0) return 'no keys';
  const shown = keys.slice(0, limit).join(', ');
  return keys.length > limit ? `${shown}, +${keys.length - limit} more` : shown;
}

/** A short, value-free description of a JSON value's shape: never its contents. */
export function describeShape(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty list';
    const objects = value.filter(isJsonObject);
    if (objects.length === value.length) {
      const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))];
      return `List of ${plural(value.length, 'record')} · keys ${keyList(keys)}`;
    }
    return `List of ${plural(value.length, 'value')}`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value);
    const lists = keys.filter((key) => Array.isArray(value[key])).map((key) => `${key}: ${plural((value[key] as unknown[]).length, 'item')}`);
    return `Object · ${plural(keys.length, 'key')} (${keyList(keys)})${lists.length ? ` · ${lists.slice(0, 3).join(', ')}` : ''}`;
  }
  if (typeof value === 'string') return 'Text';
  if (value === null) return 'null';
  return typeof value;
}

export function describeOrigin(imported: ImportedValue): string {
  const origin = imported.origin;
  if (origin.kind === 'file') return `${origin.name} · ${origin.bytes.toLocaleString('en-US')} bytes`;
  return origin.kind === 'example' ? 'From the loaded example' : 'From Advanced JSON';
}
