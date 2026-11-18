import type { InteractiveCatalogItem } from './runtime-ports.ts';
import { interactiveTarget } from './runtime-ports.ts';
import type { InteractiveWorkspace } from './interactive-workspace.ts';

export interface PreviewIdentity { readonly hostId: string; readonly sourceProjectId: string }
export interface PreviewBookmarkStore { read(): PreviewIdentity | null; write(identity: PreviewIdentity): void }
const bookmarkKey = 'hq.design.last-explicit-preview.v1';
export const rendererPreviewBookmark: PreviewBookmarkStore = {
  read() {
    try {
      const value: unknown = JSON.parse(globalThis.localStorage?.getItem(bookmarkKey) ?? 'null');
      if (!value || typeof value !== 'object') return null;
      const entry = value as Record<string, unknown>;
      return typeof entry.hostId === 'string' && entry.hostId.length > 0 && typeof entry.sourceProjectId === 'string' && entry.sourceProjectId.length > 0
        ? { hostId: entry.hostId, sourceProjectId: entry.sourceProjectId } : null;
    } catch { return null; }
  },
  write(identity) {
    try { globalThis.localStorage?.setItem(bookmarkKey, JSON.stringify({ hostId: identity.hostId, sourceProjectId: identity.sourceProjectId })); } catch { /* Storage can be disabled; explicit preview actions remain available. */ }
  },
};
export function previewIdentity(item: InteractiveCatalogItem): PreviewIdentity {
  return { hostId: item.entry.hostId, sourceProjectId: item.entry.sourceProjectId };
}
export function previewKey(identity: PreviewIdentity): string { return JSON.stringify([identity.hostId, identity.sourceProjectId]); }
export function findPreview(items: readonly InteractiveCatalogItem[], identity: PreviewIdentity) {
  return items.find((item) => item.entry.hostId === identity.hostId && item.entry.sourceProjectId === identity.sourceProjectId) ?? null;
}
export function previewKind(item: InteractiveCatalogItem): string { return item.entry.metadata.experienceKind === 'web-prototype' ? 'Prototype' : 'Website'; }
export function previewCollection(item: InteractiveCatalogItem): string {
  const name = item.entry.metadata.collectionName;
  return typeof name === 'string' && name.trim() ? name : item.hostLabel;
}
export function previewUnavailableReason(item: InteractiveCatalogItem | null): string {
  if (!item) return 'This source is not in the current interactive catalog. Refresh sources or reconnect its host.';
  if (item.entry.metadata.experienceKind === 'stills') return 'Still images: use the reference import workflow.';
  if (['missing-at-source', 'conflict', 'offline', 'unavailable'].includes(item.freshness)) return `Source ${item.freshness}. Refresh sources or reconnect its host.`;
  return typeof item.entry.metadata.holdReason === 'string' ? item.entry.metadata.holdReason : 'No available interactive presentation.';
}
export function previewGroups(items: readonly InteractiveCatalogItem[]) {
  const groups = new Map<string, { key: string; label: string; items: InteractiveCatalogItem[] }>();
  const unavailable: InteractiveCatalogItem[] = [];
  for (const item of items) {
    if (!interactiveTarget(item)) { unavailable.push(item); continue; }
    const key = JSON.stringify([item.entry.hostId, item.entry.rootId, item.entry.metadata.collectionId ?? null]);
    const group = groups.get(key) ?? { key, label: previewCollection(item), items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return { groups: [...groups.values()], unavailable };
}
export async function openPreviewSource(interactive: InteractiveWorkspace, identity: PreviewIdentity): Promise<boolean> {
  const snapshot = interactive.snapshot();
  const item = findPreview(snapshot.items, identity);
  if (snapshot.busy || snapshot.held || !item || !interactiveTarget(item)) return false;
  await interactive.select(item);
  const selected = interactive.snapshot().selected;
  if (interactive.snapshot().error || !selected || previewKey(previewIdentity(selected)) !== previewKey(identity)) return false;
  await interactive.open();
  return interactive.snapshot().session !== null && !interactive.snapshot().error;
}
