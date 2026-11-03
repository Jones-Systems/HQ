import { isJsonObject } from '../../core';
import type { FileKind } from '../../workbench/handoff';
import { parseJsonText, readImportFile, type ImportedValue } from '../../workbench/imports';

/** A file that passed the local check, with what HQ could read from it. */
export interface CheckedFile {
  readonly name: string;
  readonly bytes: number;
  readonly kind: FileKind;
  /** The parsed contents with where they came from: the exact value a workbench slot takes. */
  readonly imported: ImportedValue;
  /** Top-level records: a list's length, or the length of an `items` list. Null when the file has no list to count. */
  readonly records: number | null;
  /** The as-of time the file itself states (`as_of` or `asOf`), or null. HQ never guesses one. */
  readonly asOf: string | null;
  /** SHA-256 of the file's bytes, when this window can compute it. */
  readonly digest: string | null;
}

export type CheckResult =
  | { readonly ok: true; readonly file: CheckedFile }
  /** `message` names the line and column of a syntax error, without echoing file contents. */
  | { readonly ok: false; readonly name: string; readonly message: string };

/** The failure line shows the file name in bold already, so the message starts after it. */
function withoutName(message: string, name: string): string {
  for (const prefix of [`${name}: `, `${name} `]) if (message.startsWith(prefix)) return message.slice(prefix.length);
  return message;
}

function recordsOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isJsonObject(value) && Array.isArray(value.items)) return value.items.length;
  return null;
}

function asOfOf(value: unknown): string | null {
  if (!isJsonObject(value)) return null;
  const stated = value.as_of ?? value.asOf;
  return typeof stated === 'string' && stated.trim() !== '' ? stated : null;
}

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    return [...new Uint8Array(await subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** `3f9a0c…e21b`: enough to tell two files apart at a glance. */
export function shortDigest(digest: string): string {
  return `${digest.slice(0, 6)}…${digest.slice(-4)}`;
}

/**
 * Checks one file on this device: size, JSON or JSON Lines syntax (with the line and column of the first problem) and
 * the facts a workbench needs. It reads the file and nothing else; nothing is uploaded, saved or sent.
 */
export async function checkFile(file: File): Promise<CheckResult> {
  const read = await readImportFile(file, 'json-or-jsonl');
  if (!read.ok) return { ok: false, name: file.name, message: withoutName(read.message, file.name) };
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  // Blank text reads as JSON Lines with no rows, which would pass as a valid file with nothing in it.
  if (text.trim() === '') return { ok: false, name: file.name, message: 'is empty: it has no JSON in it.' };
  // A name that isn't .jsonl still counts as JSON Lines when the text isn't one JSON document but parsed line by line.
  const kind: FileKind = /\.(jsonl|ndjson)$/iu.test(file.name) || !parseJsonText(text).ok ? 'jsonl' : 'json';
  const { value } = read.imported;
  return {
    ok: true,
    file: { name: file.name, bytes: file.size, kind, imported: read.imported, records: recordsOf(value), asOf: asOfOf(value), digest: await sha256(bytes) },
  };
}
