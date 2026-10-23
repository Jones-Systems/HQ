import type { LibraryState, ReferenceId, ReferenceRecord } from './contract.ts';
import type {
  AppScreenCandidate, AppTreeCandidate, GraphCaptureCandidate, GraphTreeCandidate, WebsitePageCandidate,
  WebsiteTreeCandidate,
} from './graph-contract.ts';
import { originOf } from './graph-identity.ts';
import { APP_HOME_SCREEN, INERT_MEDIA_TYPES } from './graph-import.ts';
import { HQ_RIGHTS_VOCABULARY } from './rights.ts';

export interface FlatAdoptionPlan {
  readonly trees: readonly GraphTreeCandidate[];
  /** References that cannot become graph captures, each with the reason. */
  readonly skipped: readonly { readonly id: ReferenceId; readonly code: string }[];
}

function toCapture(record: ReferenceRecord): GraphCaptureCandidate {
  return {
    kind: record.kind,
    capturedAt: record.capturedAt,
    capturedBy: record.capturedBy,
    referenceId: record.id,
    ...(record.asset === null
      ? { captureKey: `flat:${record.id}` }
      : {
        asset: {
          digest: record.asset.digest, byteLength: record.asset.bytes, mediaType: record.asset.mediaType,
          ...(record.asset.w === null ? {} : { w: record.asset.w }),
          ...(record.asset.h === null ? {} : { h: record.asset.h }),
          ...(record.asset.durationMs === null ? {} : { durationMs: record.asset.durationMs }),
        },
      }),
    ...(record.nativeEvidence === null ? {} : { nativeEvidence: record.nativeEvidence }),
    rights: {
      vocabulary: HQ_RIGHTS_VOCABULARY, value: record.rights.status, setBy: record.rights.setBy,
      ...(record.rights.basis === null ? {} : { basis: record.rights.basis }),
      ...(record.rights.attribution === null ? {} : { attribution: record.rights.attribution }),
    },
  };
}

/**
 * Plans how the flat `hq.design.references/v1` library maps into graph trees:
 * a URL source becomes site > page, an app source becomes app > screen. The
 * library is read, never changed, and the plan is deterministic.
 */
export function planFlatAdoption(library: LibraryState): FlatAdoptionPlan {
  const skipped: { id: ReferenceId; code: string }[] = [];
  const sites = new Map<string, Map<string, { title: string; captures: GraphCaptureCandidate[] }>>();
  const apps = new Map<string, { platform: string; appId: string; title: string; screens: Map<string, { title: string; captures: GraphCaptureCandidate[] }> }>();
  const records = Object.values(library.references).sort((a, b) => a.id.localeCompare(b.id));
  for (const record of records) {
    if (record.tombstonedAt !== null) { skipped.push({ id: record.id, code: 'tombstoned' }); continue; }
    if (record.asset !== null && !INERT_MEDIA_TYPES.includes(record.asset.mediaType)) {
      skipped.push({ id: record.id, code: 'executable-or-unsupported-media-type' });
      continue;
    }
    const capture = toCapture(record);
    if (record.source.kind === 'url') {
      const origin = originOf(record.source.url);
      const pages = sites.get(origin) ?? new Map();
      const page = pages.get(record.source.url) ?? { title: record.title, captures: [] };
      page.captures.push(capture);
      pages.set(record.source.url, page);
      sites.set(origin, pages);
    } else {
      const key = `${record.source.platform}\u0000${record.source.appId}`;
      const app = apps.get(key) ?? { platform: record.source.platform, appId: record.source.appId, title: record.source.appName, screens: new Map() };
      const screenKey = record.source.screen ?? APP_HOME_SCREEN;
      const screen = app.screens.get(screenKey) ?? { title: record.source.screen ?? record.source.appName, captures: [] };
      screen.captures.push(capture);
      app.screens.set(screenKey, screen);
      apps.set(key, app);
    }
  }
  const trees: GraphTreeCandidate[] = [];
  for (const [origin, pages] of [...sites].sort(([a], [b]) => a.localeCompare(b))) {
    const tree: WebsiteTreeCandidate = {
      kind: 'website', origin, title: new URL(origin).host,
      pages: [...pages].sort(([a], [b]) => a.localeCompare(b)).map(([url, page]): WebsitePageCandidate => ({ url, title: page.title, captures: page.captures })),
    };
    trees.push(tree);
  }
  for (const [, app] of [...apps].sort(([a], [b]) => a.localeCompare(b))) {
    const tree: AppTreeCandidate = {
      kind: 'app', platform: app.platform, appId: app.appId, title: app.title,
      screens: [...app.screens].sort(([a], [b]) => a.localeCompare(b)).map(([key, screen]): AppScreenCandidate => ({ key, title: screen.title, captures: screen.captures })),
    };
    trees.push(tree);
  }
  return { trees, skipped };
}
