/** Explicit recursive field allow-lists. Unknown fields are never copied into a bundle. */
import type { JsonValue } from '../../../../packages/design-store/src/contract.ts';
import { canonicalize } from './canonical.ts';
import { TEXT_FORMAT } from './text-envelope.ts';

type Shape = 'scalar' | { readonly [key: string]: Shape } | readonly [Shape] | { readonly map: Shape };
const scalar = 'scalar';
const fields = (names: string): Record<string, Shape> => Object.fromEntries(names.split(' ').map(k => [k, scalar]));
const point = fields('x y'), rect = fields('x y width height'), viewport = fields('w h dpr');
const asset = fields('digest mediaType bytes w h durationMs');
const rights = fields('basis holder license attribution status setBy setAt');
const provenance = fields('originalName author capturedAt note sourceKind sourceVersion sourceId itemKey itemDigest mappingId mappingVersion importId importedAt');
const content = { ...fields('kind mediaType digest bytes w h entry url'), files: [{ ...fields('path digest mediaType bytes') }] } satisfies Shape;
const imported = { ...fields('schema recordId projectId viewId sourceId itemKey title notes versionId'), rights, provenance,
  versionHistory: [scalar], tombstone: fields('importId at'), importState: fields('importId itemDigest writtenDigest') } satisfies Shape;
const counts = fields('items created updated unchanged conflicts');
const target = { ...fields('kind path textHash quote prefix suffix'), rect, rects: [rect], points: [point] } satisfies Shape;
const anchor = { ...fields('versionId route state captureDigest'), viewport, scroll: point, target } satisfies Shape;
const shapes: Record<string, Shape> = {
  'hq.design.project-content/v1': { ...fields('schema projectId updatedAt'), views: [fields('id title kind createdAt')],
    versions: [{ ...fields('id viewId ordinal label createdAt origin basedOn'), capture: { ...fields('route sourceRevision captureDigest'), viewport }, thumbnail: { ...fields('digest mediaType bytes'), viewport } }],
    links: [fields('projectId sourceProjectId linkedAt observedRevision')] },
  'hq.design.flow/v1': { ...fields('schema id projectId title platform start'), routes: [{ route: scalar, states: [scalar] }],
    screens: [{ ...fields('id title versionId route state captureDigest'), viewport }],
    hotspots: [{ ...fields('id screenId label'), rect, transition: { ...fields('animation durationMs'), target: fields('kind screenId route state url') } }] },
  'hq.design.annotations/v1': { ...fields('schema versionId nextLetterIndex'), revisit: [scalar], annotations: [{ ...fields('id letter note kind'), anchor }] },
  'hq.design.references/v1': { schema: scalar,
    references: { map: { ...fields('id kind capturedAt capturedBy title notes importedAt lastImportedAt importCount tombstonedAt'), source: fields('kind url platform appId appName screen'), asset, rights, tags: [scalar], nativeEvidence: fields('platform runtime buildRef claim') } },
    collections: { map: { ...fields('id name description createdAt tombstonedAt'), referenceIds: [scalar] } },
    uses: { map: fields('id referenceId projectId viewId purpose linkedAt tombstonedAt') } },
  'hq.design.canvas-arrangement/v1': { ...fields('schema canvasId projectId'), grid: fields('size snap'),
    artboards: [{ ...fields('id name locked'), frame: rect }], items: [{ ...fields('id artboardId locked hidden'), frame: rect, ref: fields('providerId entityId revision') }] },
  'hq.design.comparison/v1': { ...fields('schema id projectId syncScroll'), panels: [{ ...fields('id role presetId width'), source: fields('kind versionId captureId captureDigest route state'), viewport, scroll: point }] },
  'hq.design.imported-record/v1': imported,
  'hq.design.view-version/v1': { ...fields('schema versionId viewId projectId'), content, rights, provenance },
  'hq.design.import-conflict/v1': { ...fields('schema recordId itemKey importId reason status raisedAt resolvedAt baselineItemDigest incomingItemDigest incomingVersionId'), incoming: { title: scalar, rights, provenance } },
  'hq.design.import/v1': { ...fields('schema importId projectId sourceDigest importedAt'), source: fields('kind version sourceId'), mapping: fields('id version'), counts,
    records: [{ ...fields('itemKey recordId viewId versionId action itemDigest afterDigest'), before: imported }],
    conflicts: [fields('itemKey recordId reason incomingVersionId')] },
  'hq.design.import-undo/v1': { ...fields('schema importId undoneAt'), tombstoned: [scalar], reverted: [scalar], retained: [scalar], withdrawnConflicts: [scalar] },
};
const componentShapes: Record<string, Shape> = {
  source: { ...fields('componentId name markup styles script colorScheme revision digest'), size: fields('width height'), props: { map: { ...fields('kind default maxLength min max step'), options: [scalar] } } },
  variants: { ...fields('componentId sourceRevision'), variants: [{ ...fields('id name'), props: { map: scalar } }] },
  system: { ...fields('id name'), tokens: [fields('id type value description')], groups: [{ ...fields('id name'), tokenIds: [scalar], componentIds: [scalar] }] },
  motion: { ...fields('id revision title duration iterations direction'), component: fields('componentId revision'), tracks: [{ ...fields('id target property'), keyframes: [{ ...fields('offset value'), easing: fields('kind x1 y1 x2 y2 count position stiffness damping mass') }] }] },
  project: { projectId: scalar, components: [fields('componentId revision')], studies: [fields('studyId revision')] },
};
function project(value: JsonValue, shape: Shape): JsonValue {
  if (value === null) return null;
  if (shape === 'scalar') {
    if (typeof value === 'object') throw new Error('Expected scalar in export projection');
    return value;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new Error('Expected array in export projection');
    return value.map(v => project(v, shape[0]!));
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object in export projection');
  const spec = shape as Record<string, Shape>, source = value as Record<string, JsonValue>;
  const out: Record<string, JsonValue> = {};
  if (Object.hasOwn(spec, 'map')) for (const key of Object.keys(source)) Object.defineProperty(out, key, { value: project(source[key]!, spec.map!), enumerable: true });
  else for (const key of Object.keys(spec)) if (Object.hasOwn(source, key)) out[key] = project(source[key]!, spec[key]!);
  return out;
}
const schemaRoots: Record<string, string> = {
  'hq.design.project-content/v1': 'design/projects/', 'hq.design.flow/v1': 'design/flows/',
  'hq.design.annotations/v1': 'design/annotations/', 'hq.design.references/v1': 'design/references/',
  'hq.design.canvas-arrangement/v1': 'design.canvas.arrangement.v1/', 'hq.design.comparison/v1': 'design/compare/',
};
export function projectDesignDocument(key: string, value: JsonValue): JsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, JsonValue>;
  if (v.format === TEXT_FORMAT && typeof v.text === 'string') {
    const inner = projectDesignDocument(key, JSON.parse(v.text) as JsonValue);
    return inner === null ? null : { format: TEXT_FORMAT, text: canonicalize(inner) };
  }
  const schema = typeof v.schema === 'string' ? v.schema : '';
  const root = schemaRoots[schema] ?? (schema.startsWith('hq.design.import') || schema === 'hq.design.view-version/v1' ? 'design/imports/' : '');
  if (root && key.startsWith(root) && shapes[schema]) return project(value, shapes[schema]!);
  const component = /^design\/components\/design-components\/(source|variants|system|motion|project)\//u.exec(key);
  return component ? project(value, componentShapes[component[1]!]!) : null;
}
export function projectImportEvent(value: JsonValue): JsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = (value as Record<string, JsonValue>).type;
  if (type === 'import.applied') return project(value, { ...fields('type importId sourceDigest at'), counts });
  if (type === 'import.undone') return project(value, fields('type importId at tombstoned reverted retained'));
  if (type === 'conflict.resolved') return project(value, fields('type recordId choice importId at'));
  return null;
}
/** Only named blob-reference fields, never arbitrary digest-looking private text. */
export function collectBlobReferences(value: JsonValue, out: Map<string, string>, mediaType = 'application/octet-stream'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectBlobReferences(item, out, mediaType); return; }
  const record = value as Record<string, JsonValue>;
  if (record.format === TEXT_FORMAT && typeof record.text === 'string') { collectBlobReferences(JSON.parse(record.text) as JsonValue, out); return; }
  const media = typeof record.mediaType === 'string' ? record.mediaType : mediaType;
  for (const [key, item] of Object.entries(record)) {
    if ((key === 'blobDigest' || key === 'captureDigest' || (key === 'digest' && typeof record.mediaType === 'string')) && typeof item === 'string' && /^sha256:[0-9a-f]{64}$/u.test(item)) out.set(item, media);
    else if (typeof item === 'object') collectBlobReferences(item, out, media);
  }
}
