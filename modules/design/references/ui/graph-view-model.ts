import type { ReferenceSource } from '../src/contract.ts';
import type {
  AnchorNode, AvailabilityLabel, CaptureId, CaptureRecord, GraphState, SubjectId, SubjectKind, SubjectNode,
} from '../src/graph-contract.ts';
import type { BrowseNode } from '../src/graph-ops.ts';
import { availabilityLabel, browseGraph, capturesOfSubject, pinsForProject } from '../src/graph-ops.ts';
import type { GraphAccess } from '../src/graph-service.ts';
import { describeEvidence, platformName } from '../src/provenance.ts';
import { isGraphPublishable, publishBlock } from '../src/rights.ts';
import type { ProjectRef } from './view-model.ts';

export interface GraphSelection {
  readonly subjectId: SubjectId | null;
  readonly captureId: CaptureId | null;
}

export const AVAILABILITY_TEXT: Record<AvailabilityLabel, string> = {
  present: 'Image stored',
  'no-image': 'No image captured',
  'blob-missing': 'Image file missing from storage',
  'source-unavailable': 'Source could not be reached',
  'missing-at-source': 'Gone at source — stored copy kept',
};

const KIND_LABELS: Record<SubjectKind, string> = { site: 'Site', page: 'Page', app: 'App', flow: 'Flow', screen: 'Screen' };

const RIGHTS_TEXT = {
  granted: 'Publishable',
  'rights-restricted': 'Restricted',
  'rights-unknown': 'Rights unknown',
  private: 'Private',
} as const;

export interface SubjectRow {
  readonly id: SubjectId;
  readonly depth: number;
  readonly kindLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly captureCount: number;
  readonly rating: number | null;
  readonly availability: { readonly label: AvailabilityLabel; readonly text: string } | null;
  readonly selected: boolean;
}

export interface CaptureRow {
  readonly id: CaptureId;
  readonly capturedAt: string;
  readonly evidenceLabel: string;
  readonly caveat: string | null;
  readonly isLatest: boolean;
  readonly availability: { readonly label: AvailabilityLabel; readonly text: string };
  readonly rights: { readonly label: string; readonly publishable: boolean };
  readonly producer: string | null;
  readonly anchorCount: number;
  readonly pinnedInCurrentProject: boolean;
  readonly selected: boolean;
}

export interface AnchorRow {
  readonly id: string;
  readonly depth: number;
  readonly kindLabel: string;
  readonly label: string;
}

export interface GraphViewModel {
  readonly rows: readonly SubjectRow[];
  readonly detail: {
    readonly subject: { readonly id: SubjectId; readonly title: string; readonly kindLabel: string; readonly rating: number | null };
    readonly captures: readonly CaptureRow[];
    readonly anchors: readonly AnchorRow[];
  } | null;
  readonly emptyMessage: string | null;
  readonly banner: string | null;
  readonly canEdit: boolean;
  readonly currentProject: ProjectRef | null;
}

function subjectDetail(subject: SubjectNode): string {
  switch (subject.identity.kind) {
    case 'site': return new URL(subject.identity.origin).host;
    case 'page': { const url = new URL(subject.identity.url); return `${url.pathname}${url.search}`; }
    case 'app': return `${subject.identity.appId} · ${platformName(subject.identity.platform)}`;
    case 'flow': case 'screen': return subject.identity.key;
  }
}

function sourceOf(state: GraphState, subject: SubjectNode): ReferenceSource {
  if (subject.identity.kind === 'page') return { kind: 'url', url: subject.identity.url };
  const app = subject.parentId === null ? undefined : state.subjects[subject.parentId];
  if (app === undefined || app.identity.kind !== 'app') return { kind: 'url', url: 'about:blank' };
  return { kind: 'app', platform: app.identity.platform, appId: app.identity.appId, appName: app.title, screen: null };
}

function rightsLabel(capture: CaptureRecord): { label: string; publishable: boolean } {
  const block = publishBlock(capture.rights);
  return { label: block === null ? RIGHTS_TEXT.granted : RIGHTS_TEXT[block], publishable: isGraphPublishable(capture.rights) };
}

function bannerFor(access: GraphAccess): string | null {
  switch (access.mode) {
    case 'writable': return null;
    case 'fenced': return 'A save may or may not have completed. Reload to read the saved graph before editing again.';
    case 'read-only':
      if (access.reason === 'future-schema') return 'This reference graph was saved by a newer HQ version. It is open read-only and will not be changed.';
      if (access.reason === 'storage-read-only') return 'Storage is read-only. Changes cannot be saved.';
      return 'The saved reference graph could not be read. It is open read-only and has not been repaired or changed.';
  }
}

export function buildGraphView(
  state: GraphState, access: GraphAccess, selection: GraphSelection, currentProject: ProjectRef | null,
): GraphViewModel {
  const rows: SubjectRow[] = [];
  const walk = (node: BrowseNode, depth: number): void => {
    rows.push({
      id: node.subject.id, depth, kindLabel: KIND_LABELS[node.subject.kind], title: node.subject.title,
      detail: subjectDetail(node.subject), captureCount: node.captureCount, rating: node.subject.rating,
      availability: node.availability === null ? null : { label: node.availability, text: AVAILABILITY_TEXT[node.availability] },
      selected: node.subject.id === selection.subjectId,
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of browseGraph(state)) walk(root, 0);

  const selected = selection.subjectId === null ? undefined : state.subjects[selection.subjectId];
  let detail: GraphViewModel['detail'] = null;
  if (selected !== undefined && selected.tombstonedAt === null) {
    const captures = capturesOfSubject(state, selected.id);
    const pinned = new Set(currentProject === null ? [] : pinsForProject(state, currentProject.id).map((pin) => pin.captureId));
    const latest = captures.at(-1)?.id;
    const chosenId = captures.some((capture) => capture.id === selection.captureId) ? selection.captureId : latest ?? null;
    const source = sourceOf(state, selected);
    const anchorsOf = (id: CaptureId | null): AnchorNode[] => id === null ? [] : Object.values(state.anchors).filter((anchor) => anchor.captureId === id);
    const depthOf = (anchor: AnchorNode): number => {
      let depth = 0;
      for (let parent = anchor.parentId; parent !== null && depth < 20; parent = state.anchors[parent]?.parentId ?? null) depth += 1;
      return depth;
    };
    detail = {
      subject: { id: selected.id, title: selected.title, kindLabel: KIND_LABELS[selected.kind], rating: selected.rating },
      captures: [...captures].reverse().map((capture): CaptureRow => {
        const evidence = describeEvidence({ kind: capture.kind, source, nativeEvidence: capture.nativeEvidence });
        const label = availabilityLabel(capture.availability);
        return {
          id: capture.id, capturedAt: capture.capturedAt, evidenceLabel: evidence.label, caveat: evidence.caveat,
          isLatest: capture.id === latest, availability: { label, text: AVAILABILITY_TEXT[label] }, rights: rightsLabel(capture),
          producer: capture.provenance.producer === null ? null : capture.provenance.producer.label ?? capture.provenance.producer.id,
          anchorCount: Object.values(state.anchors).filter((anchor) => anchor.captureId === capture.id).length,
          pinnedInCurrentProject: pinned.has(capture.id), selected: capture.id === chosenId,
        };
      }),
      anchors: anchorsOf(chosenId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((anchor) => ({ id: anchor.id, depth: depthOf(anchor), kindLabel: anchor.kind === 'section' ? 'Section' : 'Element', label: anchor.label })),
    };
  }
  return {
    rows, detail,
    emptyMessage: rows.length > 0 ? null : 'No sites or apps yet. Imported website and app trees appear here.',
    banner: bannerFor(access), canEdit: access.mode === 'writable', currentProject,
  };
}
