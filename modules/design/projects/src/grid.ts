/**
 * Virtual gallery grid geometry. Only blocks intersecting the viewport (plus a
 * bounded overscan) are rendered, and only visible tiles plus a bounded
 * prefetch window request thumbnails.
 *
 * This is layout arithmetic. It is not evidence of rendered browser layout.
 */
import type { GalleryGroup, GalleryItem } from './gallery.ts';
import type { PreviewRef } from './contract.ts';

export interface GridMetrics {
  readonly width: number;
  readonly minTileWidth: number;
  readonly tileHeight: number;
  readonly gap: number;
  readonly headerHeight: number;
}

export const DEFAULT_GRID_METRICS: Omit<GridMetrics, 'width'> = { minTileWidth: 220, tileHeight: 210, gap: 16, headerHeight: 44 };

export type GridBlock =
  | { readonly type: 'header'; readonly key: string; readonly group: GalleryGroup; readonly y: number; readonly height: number }
  | { readonly type: 'tile'; readonly key: string; readonly item: GalleryItem; readonly row: number;
    readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export interface GridLayout {
  readonly columns: number;
  readonly tileWidth: number;
  readonly totalHeight: number;
  /** Ordered by y, then x. */
  readonly blocks: readonly GridBlock[];
}

export function layoutGrid(groups: readonly GalleryGroup[], metrics: GridMetrics): GridLayout {
  const width = Math.max(metrics.minTileWidth, metrics.width);
  const columns = Math.max(1, Math.floor((width + metrics.gap) / (metrics.minTileWidth + metrics.gap)));
  const tileWidth = (width - metrics.gap * (columns - 1)) / columns;
  const blocks: GridBlock[] = [];
  let y = 0;
  let row = 0;
  for (const group of groups) {
    blocks.push({ type: 'header', key: `header:${group.key}`, group, y, height: metrics.headerHeight });
    y += metrics.headerHeight;
    group.items.forEach((item, index) => {
      const column = index % columns;
      const rowInGroup = Math.floor(index / columns);
      blocks.push({
        type: 'tile', key: item.key, item, row: row + rowInGroup,
        x: column * (tileWidth + metrics.gap), y: y + rowInGroup * (metrics.tileHeight + metrics.gap),
        width: tileWidth, height: metrics.tileHeight,
      });
    });
    const rows = Math.ceil(group.items.length / columns);
    row += rows;
    y += rows * (metrics.tileHeight + metrics.gap) + (rows > 0 ? metrics.gap : 0);
  }
  return { columns, tileWidth, totalHeight: y, blocks };
}

function firstEndingAfter(blocks: readonly GridBlock[], top: number): number {
  // Block bottoms are non-decreasing in layout order, so binary search applies.
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const block = blocks[mid]!;
    if (block.y + block.height <= top) low = mid + 1; else high = mid;
  }
  return low;
}

/** Blocks intersecting [top - overscan, top + height + overscan]. */
export function visibleBlocks(layout: GridLayout, scrollTop: number, viewportHeight: number, overscan = 0): GridBlock[] {
  const top = Math.max(0, scrollTop - overscan);
  const bottom = scrollTop + viewportHeight + overscan;
  const result: GridBlock[] = [];
  for (let index = firstEndingAfter(layout.blocks, top); index < layout.blocks.length; index += 1) {
    const block = layout.blocks[index]!;
    if (block.y >= bottom) break;
    result.push(block);
  }
  return result;
}

export interface ThumbnailPlan {
  /** Deduplicated by digest, visible tiles first in reading order. */
  readonly visible: readonly PreviewRef[];
  /** Bounded look-ahead below (then above) the viewport, excluding visible digests. */
  readonly prefetch: readonly PreviewRef[];
}

export function planThumbnails(layout: GridLayout, scrollTop: number, viewportHeight: number,
  options: { readonly prefetchRows: number; readonly maxPrefetch: number }): ThumbnailPlan {
  const seen = new Set<string>();
  const take = (blocks: readonly GridBlock[], limit: number): PreviewRef[] => {
    const refs: PreviewRef[] = [];
    for (const block of blocks) {
      if (refs.length >= limit) break;
      if (block.type !== 'tile' || !block.item.thumbnail || seen.has(block.item.thumbnail.digest)) continue;
      seen.add(block.item.thumbnail.digest);
      refs.push(block.item.thumbnail);
    }
    return refs;
  };
  const visible = take(visibleBlocks(layout, scrollTop, viewportHeight), Number.POSITIVE_INFINITY);
  const rowSpan = (layout.blocks.find((block) => block.type === 'tile')?.height ?? 0) * Math.max(0, options.prefetchRows);
  const below = visibleBlocks(layout, scrollTop + viewportHeight, rowSpan);
  const above = visibleBlocks(layout, Math.max(0, scrollTop - rowSpan), Math.min(rowSpan, scrollTop)).reverse();
  return { visible, prefetch: take([...below, ...above], Math.max(0, options.maxPrefetch)) };
}
