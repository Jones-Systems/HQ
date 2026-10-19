import type {
  BlobDigest, CollectionId, LibraryState, ReferenceCollection, ReferenceId, ReferenceRecord, ReferenceUse,
} from './contract.ts';
import { EXPORT_SCHEMA } from './contract.ts';
import { jcsDigest } from './jcs.ts';
import type { ExecutionClass } from './provenance.ts';
import { describeEvidence, isPublishPermitted } from './provenance.ts';

export type ExportMode = 'publishable' | 'internal';

export type ExclusionReason = 'rights-not-permitted' | 'tombstoned';

export interface ExportedReference extends Omit<ReferenceRecord, 'notes'> {
  /** Omitted in publishable exports: notes are private owner content. */
  readonly notes?: string;
  /** Derived, never importer-supplied; consumers must not relabel it. */
  readonly evidence: { readonly executionClass: ExecutionClass; readonly isNativeExecution: boolean };
}

export interface ReferenceExport {
  readonly schema: typeof EXPORT_SCHEMA;
  readonly mode: ExportMode;
  readonly references: readonly ExportedReference[];
  readonly collections: readonly ReferenceCollection[];
  readonly uses: readonly ReferenceUse[];
  /** Blobs a consumer must copy alongside this export. */
  readonly blobs: readonly BlobDigest[];
  readonly excluded: readonly { readonly id: ReferenceId; readonly reason: ExclusionReason }[];
  /** Stores or fields deliberately left out, so omission is never silent. */
  readonly omitted: readonly string[];
  /** SHA-256 of the JCS form of every other field (authoring digest, not a wire digest). */
  readonly authoringDigest: string;
}

export interface ExportOptions {
  readonly mode: ExportMode;
  /** Limit to one live collection's members. */
  readonly collectionId?: CollectionId;
  /** Limit to explicit references. */
  readonly referenceIds?: readonly ReferenceId[];
}

/**
 * Builds an export. In `publishable` mode only references with an explicit
 * `permitted` rights flag are included; everything else is listed under
 * `excluded`, and notes and project links are omitted.
 */
export async function exportReferences(state: LibraryState, options: ExportOptions): Promise<ReferenceExport> {
  const publishable = options.mode === 'publishable';
  const selection = selectIds(state, options);
  const references: ExportedReference[] = [];
  const excluded: { id: ReferenceId; reason: ExclusionReason }[] = [];
  for (const record of Object.values(state.references).sort((a, b) => a.id.localeCompare(b.id))) {
    if (selection !== null && !selection.has(record.id)) continue;
    if (record.tombstonedAt !== null) { excluded.push({ id: record.id, reason: 'tombstoned' }); continue; }
    if (publishable && !isPublishPermitted(record)) { excluded.push({ id: record.id, reason: 'rights-not-permitted' }); continue; }
    const { executionClass, isNativeExecution } = describeEvidence(record);
    const { notes, ...rest } = record;
    references.push({ ...rest, ...(publishable ? {} : { notes }), evidence: { executionClass, isNativeExecution } });
  }
  const included = new Set(references.map((record) => record.id));
  const collections = Object.values(state.collections)
    .filter((collection) => collection.tombstonedAt === null
      && (options.collectionId === undefined || collection.id === options.collectionId))
    .map((collection) => ({ ...collection, referenceIds: collection.referenceIds.filter((id) => included.has(id)) }))
    .filter((collection) => !publishable || collection.referenceIds.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const uses = publishable ? [] : Object.values(state.uses)
    .filter((use) => use.tombstonedAt === null && included.has(use.referenceId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const blobs = [...new Set(references.flatMap((record) => (record.asset === null ? [] : [record.asset.digest])))].sort();
  const omitted = publishable
    ? ['notes', 'uses', 'tombstoned-collections', 'tombstoned-references']
    : ['tombstoned-collections', 'tombstoned-references'];
  const body = { schema: EXPORT_SCHEMA, mode: options.mode, references, collections, uses, blobs, excluded, omitted };
  return { ...body, authoringDigest: await jcsDigest(body) };
}

function selectIds(state: LibraryState, options: ExportOptions): Set<ReferenceId> | null {
  let selection: Set<ReferenceId> | null = null;
  if (options.collectionId !== undefined) {
    const collection = state.collections[options.collectionId];
    selection = new Set(collection && collection.tombstonedAt === null ? collection.referenceIds : []);
  }
  if (options.referenceIds !== undefined) {
    const explicit = new Set(options.referenceIds);
    selection = selection === null ? explicit : new Set([...selection].filter((id) => explicit.has(id)));
  }
  return selection;
}
