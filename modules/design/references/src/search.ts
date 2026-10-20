import type { CollectionId, LibraryState, ReferenceKind, ReferenceRecord, ReferenceTag } from './contract.ts';
import { REFERENCE_KINDS } from './contract.ts';
import { normalizeTag } from './library.ts';
import { describeEvidence, isOneOf, isPublishPermitted, platformName } from './provenance.ts';

export interface ReferenceQuery {
  /** Free-text terms; every term must match some searchable field. */
  readonly text?: string;
  /** Every listed tag must be present. */
  readonly tags?: readonly ReferenceTag[];
  /** Any listed kind matches. */
  readonly kinds?: readonly ReferenceKind[];
  readonly collectionId?: CollectionId | null;
  readonly publishableOnly?: boolean;
  readonly includeTombstoned?: boolean;
}

/**
 * Parses a search box string. `tag:x`, `kind:screenshot` and `is:publishable`
 * become structured filters; everything else is free text.
 */
export function parseSearchText(input: string): ReferenceQuery {
  const tags: ReferenceTag[] = [];
  const kinds: ReferenceKind[] = [];
  const terms: string[] = [];
  let publishableOnly = false;
  for (const token of input.trim().split(/\s+/u)) {
    if (token === '') continue;
    const lower = token.toLowerCase();
    if (lower.startsWith('tag:')) {
      const tag = normalizeTag(token.slice(4));
      if (tag !== null) tags.push(tag);
    } else if (lower.startsWith('kind:') && isOneOf(REFERENCE_KINDS, lower.slice(5))) {
      kinds.push(lower.slice(5) as ReferenceKind);
    } else if (lower === 'is:publishable') {
      publishableOnly = true;
    } else {
      terms.push(token);
    }
  }
  return { text: terms.join(' '), tags, kinds, publishableOnly };
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function haystack(record: ReferenceRecord): string {
  const parts = [record.title, record.notes, ...record.tags, record.kind, describeEvidence(record).label];
  if (record.source.kind === 'url') {
    parts.push(record.source.url);
  } else {
    parts.push(record.source.appName, record.source.appId, platformName(record.source.platform), record.source.screen ?? '');
  }
  return fold(parts.join('\n'));
}

function score(record: ReferenceRecord, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const title = fold(record.title);
  return terms.reduce((sum, term) => sum + (title.startsWith(term) ? 3 : title.includes(term) ? 2 : 1), 0);
}

/** Filters and ranks references: title matches first, then newest capture. */
export function searchReferences(state: LibraryState, query: ReferenceQuery): readonly ReferenceRecord[] {
  const terms = fold(query.text ?? '').split(/\s+/u).filter((term) => term !== '');
  const members = query.collectionId ? new Set(state.collections[query.collectionId]?.referenceIds ?? []) : null;
  const hits: { record: ReferenceRecord; score: number }[] = [];
  for (const record of Object.values(state.references)) {
    if (record.tombstonedAt !== null && !query.includeTombstoned) continue;
    if (members !== null && !members.has(record.id)) continue;
    if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(record.kind)) continue;
    if (query.tags && !query.tags.every((tag) => record.tags.includes(tag))) continue;
    if (query.publishableOnly && !isPublishPermitted(record)) continue;
    if (terms.length > 0) {
      const text = haystack(record);
      if (!terms.every((term) => text.includes(term))) continue;
    }
    hits.push({ record, score: score(record, terms) });
  }
  hits.sort((a, b) => b.score - a.score
    || Date.parse(b.record.capturedAt) - Date.parse(a.record.capturedAt)
    || a.record.id.localeCompare(b.record.id));
  return hits.map((hit) => hit.record);
}

/** Tag counts across live references, most used first. */
export function tagCounts(state: LibraryState): readonly { tag: ReferenceTag; count: number }[] {
  const counts = new Map<ReferenceTag, number>();
  for (const record of Object.values(state.references)) {
    if (record.tombstonedAt !== null) continue;
    for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
