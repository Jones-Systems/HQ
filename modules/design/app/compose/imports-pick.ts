/**
 * The durable Imports `pickSource` (B3 backend contract, section 12).
 *
 * `import.pick` opens the native PNG picker. The dialog tells the owner the files are imported as their own work,
 * and that statement is why the source's rights basis is `owned`. The source is an `hq.files` v1 source with:
 *  - one stable source ID for local file imports, and
 *  - item keys that are the normalized file names,
 * so picking the same files again changes nothing, a changed file under the same name is an update, and a changed
 * file whose record the owner edited is a conflict. Nothing here reads a path; the host sends names and bytes only.
 */
import type { DesignServiceTransport } from '@hq/contracts/services';
import { importSourceId, type ImportSource, type SourceItem } from '../../imports/src/contract.ts';
import { isBoundedText } from '../../imports/src/media.ts';
import { bridgeResultValue, DesignBridgeError } from './bridge-documents.ts';
import { designFailure, DesignOperationError, toDesignOperationError, type DesignFailureKind } from './errors.ts';
import { IMPORTS_CONTEXTS } from './imports-storage.ts';

/** Local file imports share one source per project, so the same file name is the same item every time. */
export const LOCAL_FILES_SOURCE_ID = 'src-local-png-files';
/** Neutral holder text: the native dialog's wording is the owner's explicit statement. */
export const LOCAL_FILES_RIGHTS = Object.freeze({ basis: 'owned', holder: 'Owner' } as const);

export type PickedPng = { readonly name: string; readonly mediaType: 'image/png'; readonly bytes: Uint8Array };
export type ImportPick = { readonly status: 'canceled' }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'picked'; readonly files: readonly PickedPng[] };

const REJECTIONS: Readonly<Record<string, { readonly kind: DesignFailureKind; readonly description: string }>> = Object.freeze({
  unavailable: { kind: 'unavailable', description: 'HQ could not open the file picker. Nothing was imported.' },
  'invalid-selection': { kind: 'invalid', description: 'HQ could not use that selection. Nothing was imported.' },
  'too-many-files': { kind: 'too-large', description: 'That is too many files at once. Nothing was imported.' },
  'not-regular-file': { kind: 'invalid', description: 'One of the items is not a regular file. Nothing was imported.' },
  'file-too-large': { kind: 'too-large', description: 'One of the files is larger than 16 MB. Nothing was imported.' },
  'total-too-large': { kind: 'too-large', description: 'The files together are larger than 64 MB. Nothing was imported.' },
  'invalid-png': { kind: 'invalid', description: 'One of the files is not a PNG image. Nothing was imported.' },
  'file-changed': { kind: 'stale', description: 'A file changed while HQ was reading it. Choose it again.' },
  'read-limit': { kind: 'too-large', description: 'A file took too long to read. Nothing was imported.' },
});

/** The typed failure for a picker refusal. The picker's own reason stays on it as `reason`. */
export function pickRejection(reason: string): DesignOperationError {
  const known = Object.hasOwn(REJECTIONS, reason) ? REJECTIONS[reason]! : REJECTIONS.unavailable!;
  return new DesignOperationError(designFailure(known.kind, IMPORTS_CONTEXTS.pick, { reason, description: known.description }));
}

const invalidName = (reason: 'invalid-name' | 'duplicate-name', description: string) =>
  new DesignOperationError(designFailure('invalid', IMPORTS_CONTEXTS.pick, { reason, description }));

/** Builds the import source for picked files. Rejects with a typed failure when a name cannot be an item key. */
export function importSourceFromFiles(files: readonly PickedPng[]): ImportSource {
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  for (const file of files) {
    const key = file.name.normalize('NFC').trim();
    if (!isBoundedText(key, 160)) throw invalidName('invalid-name', 'One of the file names cannot be used. Rename it, then choose it again.');
    if (seen.has(key)) throw invalidName('duplicate-name', 'Two of the files have the same name. Rename one, then choose them again.');
    seen.add(key);
    const title = key.replace(/\.png$/iu, '').trim();
    items.push({
      key, title: title === '' ? key : title, rights: LOCAL_FILES_RIGHTS, provenance: { originalName: key },
      payload: { kind: 'png', bytes: new Uint8Array(file.bytes) },
    });
  }
  return { kind: 'hq.files', version: 1, sourceId: importSourceId(LOCAL_FILES_SOURCE_ID), items };
}

function picked(value: unknown): ImportPick {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  if (record?.status === 'canceled') return { status: 'canceled' };
  if (record?.status === 'rejected' && typeof record.reason === 'string') return { status: 'rejected', reason: record.reason };
  if (record?.status === 'picked' && Array.isArray(record.files)
    && record.files.every((file) => typeof file === 'object' && file !== null && typeof file.name === 'string'
      && file.mediaType === 'image/png' && file.bytes instanceof Uint8Array)) return { status: 'picked', files: record.files as PickedPng[] };
  throw new DesignBridgeError('unavailable');
}

/** `pickSource` for the Imports controller: null when the owner cancels, a typed failure when the pick is refused. */
export function createImportsPickSource(transport: DesignServiceTransport): () => Promise<ImportSource | null> {
  return async () => {
    try {
      let result: unknown;
      try { result = await transport.call('import.pick', {}); } catch { throw new DesignBridgeError('unavailable'); }
      const pick = picked(bridgeResultValue(result, 'unavailable'));
      if (pick.status === 'canceled' || (pick.status === 'picked' && pick.files.length === 0)) return null;
      if (pick.status === 'rejected') throw pickRejection(pick.reason);
      return importSourceFromFiles(pick.files);
    } catch (error) {
      throw toDesignOperationError(error, IMPORTS_CONTEXTS.pick);
    }
  };
}
