import type {
  BlobDigest, ClaimLevel, CollectionId, LibraryState, ReferenceId, ReferenceRecord, RightsStatus,
} from '../src/contract.ts';
import { usesForReference } from '../src/library.ts';
import { describeEvidence, isPublishPermitted, platformName } from '../src/provenance.ts';
import type { LibraryAccess } from '../src/service.ts';
import { parseSearchText, searchReferences } from '../src/search.ts';

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

export interface CollectionItem {
  readonly id: CollectionId;
  readonly name: string;
  readonly count: number;
  readonly selected: boolean;
}

export interface ReferenceCard {
  readonly id: ReferenceId;
  readonly title: string;
  readonly sourceLabel: string;
  readonly evidenceLabel: string;
  readonly caveat: string | null;
  readonly isNativeExecution: boolean;
  readonly rights: { readonly status: RightsStatus; readonly label: string; readonly publishable: boolean };
  readonly tags: readonly string[];
  readonly capturedAt: string;
  readonly thumbnail: { readonly digest: BlobDigest; readonly w: number | null; readonly h: number | null; readonly presentation: ThumbnailPresentation } | null;
  readonly usedInCurrentProject: boolean;
  /** Already waiting in the Taste queue (the composed view supplies the ids). */
  readonly queuedForTaste: boolean;
  readonly selected: boolean;
}

/**
 * How a reference image sits in its card: `banner` fills a landscape website frame from the top;
 * `contained` and `phone` show the whole image at its own aspect ratio on a neutral matte, `phone`
 * inside a simple device outline. Presentation only: nothing implies the image is interactive.
 */
export type ThumbnailPresentation = 'banner' | 'contained' | 'phone';
const PHONE_PLATFORMS: ReadonlySet<string> = new Set(['ios', 'android', 'watchos']);

export function thumbnailPresentation(source: ReferenceRecord['source'], w: number | null, h: number | null): ThumbnailPresentation {
  const known = w !== null && h !== null && w > 0 && h > 0;
  const landscape = known && w >= h * 1.05;
  if (source.kind === 'app') return PHONE_PLATFORMS.has(source.platform) && !landscape ? 'phone' : 'contained';
  return !known || landscape ? 'banner' : 'contained';
}

export interface ReferenceDetail {
  readonly id: ReferenceId;
  readonly title: string;
  readonly notes: string;
  readonly provenance: readonly { readonly term: string; readonly value: string }[];
  readonly usedIn: readonly string[];
}

export interface LibraryViewModel {
  readonly totalLive: number;
  readonly query: string;
  readonly collections: readonly CollectionItem[];
  readonly allSelected: boolean;
  readonly cards: readonly ReferenceCard[];
  readonly detail: ReferenceDetail | null;
  readonly emptyMessage: string | null;
  readonly banner: string | null;
  readonly canEdit: boolean;
  readonly currentProject: ProjectRef | null;
}

/** What "Rate taste" hands to the composed view: the reference and the image the view already shows. */
export interface ReferenceTasteSubject {
  readonly id: ReferenceId;
  readonly title: string;
  /** The site or app, for example `example.com/pricing`. */
  readonly detail: string;
  /** The preview URL the view displays; null when there is no image to show. */
  readonly imageUrl: string | null;
}

/** Optional facts the composed view knows and the library does not. */
export interface LibraryViewOptions {
  /** Reference ids that are already waiting for a Taste rating. */
  readonly queuedForTaste?: Iterable<string>;
}

export interface ViewSelection {
  readonly query: string;
  readonly collectionId: CollectionId | null;
  readonly selectedId: ReferenceId | null;
}

const RIGHTS_LABELS: Record<RightsStatus, string> = {
  permitted: 'Publishable', restricted: 'Restricted', unknown: 'Rights unknown',
};

const CLAIM_LABELS: Record<ClaimLevel, string> = {
  'agent-reported': 'Agent-reported', observed: 'Observed', 'owner-judged': 'Owner-judged',
};

export function sourceLabel(record: Pick<ReferenceRecord, 'source'>): string {
  const { source } = record;
  if (source.kind === 'url') {
    const url = new URL(source.url);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  }
  return `${source.appName} · ${platformName(source.platform)}${source.screen === null ? '' : ` · ${source.screen}`}`;
}

function bannerFor(access: LibraryAccess): string | null {
  switch (access.mode) {
    case 'writable': return null;
    case 'fenced': return 'A save may or may not have completed. Reload to read the saved library before editing again.';
    case 'read-only':
      if (access.reason === 'future-schema') return 'This library was saved by a newer HQ version. It is open read-only and will not be changed.';
      if (access.reason === 'storage-read-only') return 'Storage is read-only. Changes cannot be saved.';
      return 'The saved library could not be read. It is open read-only and has not been repaired or changed.';
  }
}

export function buildLibraryView(
  state: LibraryState, access: LibraryAccess, selection: ViewSelection, currentProject: ProjectRef | null,
  options: LibraryViewOptions = {},
): LibraryViewModel {
  const queued = new Set<string>(options.queuedForTaste ?? []);
  const liveCollections = Object.values(state.collections).filter((collection) => collection.tombstonedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const collectionId = selection.collectionId !== null && liveCollections.some((item) => item.id === selection.collectionId)
    ? selection.collectionId : null;
  const live = (id: ReferenceId) => state.references[id]?.tombstonedAt === null;
  const query = parseSearchText(selection.query);
  const results = searchReferences(state, { ...query, collectionId });
  const cards = results.map((record): ReferenceCard => {
    const evidence = describeEvidence(record);
    const uses = usesForReference(state, record.id);
    const image = record.asset !== null && record.asset.mediaType.startsWith('image/');
    return {
      id: record.id,
      title: record.title,
      sourceLabel: sourceLabel(record),
      evidenceLabel: evidence.label,
      caveat: evidence.caveat,
      isNativeExecution: evidence.isNativeExecution,
      rights: { status: record.rights.status, label: RIGHTS_LABELS[record.rights.status], publishable: isPublishPermitted(record) },
      tags: record.tags,
      capturedAt: record.capturedAt,
      thumbnail: image ? { digest: record.asset!.digest, w: record.asset!.w, h: record.asset!.h, presentation: thumbnailPresentation(record.source, record.asset!.w, record.asset!.h) } : null,
      usedInCurrentProject: currentProject !== null && uses.some((use) => use.projectId === currentProject.id),
      queuedForTaste: queued.has(record.id),
      selected: record.id === selection.selectedId,
    };
  });
  const selected = selection.selectedId === null ? undefined : state.references[selection.selectedId];
  const totalLive = Object.values(state.references).filter((record) => record.tombstonedAt === null).length;
  return {
    totalLive,
    query: selection.query,
    collections: liveCollections.map((collection) => ({
      id: collection.id, name: collection.name, selected: collection.id === collectionId,
      count: collection.referenceIds.filter(live).length,
    })),
    allSelected: collectionId === null,
    cards,
    detail: selected === undefined || selected.tombstonedAt !== null ? null : detailFor(state, selected),
    emptyMessage: cards.length > 0 ? null
      : totalLive === 0 ? 'No references yet. Imported screenshots, recordings, prototypes and native captures appear here.'
        : 'No references match these filters.',
    banner: bannerFor(access),
    canEdit: access.mode === 'writable',
    currentProject,
  };
}

function detailFor(state: LibraryState, record: ReferenceRecord): ReferenceDetail {
  const evidence = describeEvidence(record);
  const provenance = [
    { term: 'Source', value: record.source.kind === 'url' ? record.source.url : sourceLabel(record) },
    { term: 'Kind', value: record.kind },
    { term: 'Evidence', value: evidence.caveat === null ? evidence.label : `${evidence.label} — ${evidence.caveat}` },
    { term: 'Captured', value: `${record.capturedAt} (${CLAIM_LABELS[record.capturedBy]})` },
    {
      term: 'Rights',
      value: `${RIGHTS_LABELS[record.rights.status]}${record.rights.basis === null ? '' : ` — ${record.rights.basis}`} (${CLAIM_LABELS[record.rights.setBy]})`,
    },
  ];
  if (record.rights.attribution !== null) provenance.push({ term: 'Attribution', value: record.rights.attribution });
  if (record.asset !== null) provenance.push({ term: 'Asset', value: `${record.asset.mediaType}, ${record.asset.bytes} bytes` });
  if (record.nativeEvidence !== null) {
    provenance.push({ term: 'Build', value: `${record.nativeEvidence.buildRef} (${CLAIM_LABELS[record.nativeEvidence.claim]})` });
  }
  return {
    id: record.id, title: record.title, notes: record.notes, provenance,
    usedIn: usesForReference(state, record.id).map((use) => use.viewId === null ? use.projectId : `${use.projectId} / ${use.viewId}`),
  };
}

export interface LightboxPosition {
  /** 1-based position among the references currently shown. */
  readonly position: number;
  readonly total: number;
  readonly previous: ReferenceId | null;
  readonly next: ReferenceId | null;
}

/** Where a reference sits among the shown cards, for the lightbox's previous and next. Null when it is not shown. */
export function lightboxPosition(cards: readonly Pick<ReferenceCard, 'id'>[], id: ReferenceId | null): LightboxPosition | null {
  const index = id === null ? -1 : cards.findIndex((card) => card.id === id);
  if (index < 0) return null;
  return { position: index + 1, total: cards.length, previous: cards[index - 1]?.id ?? null, next: cards[index + 1]?.id ?? null };
}

/**
 * Roving focus for a wrapping grid: the index to focus after `key`, or null when the key is not a grid key.
 * Down from a column with no item below (a short last row) lands on the last item.
 */
export function gridFocusTarget(key: string, index: number, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const width = Math.max(1, Math.floor(columns));
  switch (key) {
    case 'ArrowLeft': return Math.max(0, index - 1);
    case 'ArrowRight': return Math.min(last, index + 1);
    case 'ArrowUp': return index - width >= 0 ? index - width : index;
    case 'ArrowDown':
      if (index + width <= last) return index + width;
      return Math.floor(index / width) < Math.floor(last / width) ? last : index;
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}
