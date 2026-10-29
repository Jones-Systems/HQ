import type { PreviewBookmarkStore } from './preview-navigation.ts';
import type { CatalogEntry } from '@hq/contracts/catalog';
import type { PreviewTransport } from '@hq/contracts/preview';
import type { RunsConnection } from '../sections/runs/env.ts';
import type { WorkspaceRecords } from '../storage/index.ts';

export interface InteractiveCatalogItem {
  readonly entry: CatalogEntry;
  readonly hostLabel: string;
  readonly freshness: string;
}

/** Main supplies enrolled catalogs; listing cannot enroll, launch, clone or dispatch. */
export interface InteractiveCatalogPort {
  list(): Promise<readonly InteractiveCatalogItem[]>;
}

export interface DesignRuntimePorts {
  readonly previewBookmark?: PreviewBookmarkStore;
  readonly documents?: WorkspaceRecords | null;
  readonly preview?: PreviewTransport;
  readonly sources?: InteractiveCatalogPort;
  readonly runsConnection?: RunsConnection;
  readonly onSelectProject?: (project: { readonly id: string; readonly label: string; readonly navigation?: 'preserve-design' }) => void;
}

export function interactiveTarget(item: InteractiveCatalogItem): { readonly url: string; readonly kind: 'website' | 'web-prototype' } | null {
  const { metadata } = item.entry;
  const kind = metadata.experienceKind;
  if ((kind !== 'website' && kind !== 'web-prototype') || metadata.launchStatus !== 'available' || typeof metadata.launchUrl !== 'string'
    || ['missing-at-source', 'conflict', 'offline', 'unavailable'].includes(item.freshness)) return null;
  try {
    const url = new URL(metadata.launchUrl);
    if (url.href.length > 2048 || url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return { url: url.href, kind };
  } catch { return null; }
}

/** The catalog's opaque identity is the workspace binding; names and remote similarity never merge it. */
export function catalogProject(item: InteractiveCatalogItem) {
  return { id: String(item.entry.sourceProjectId), name: item.entry.displayName };
}
