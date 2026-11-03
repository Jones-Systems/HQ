import type { CanvasArrangement, CanvasItemRef, NodeId, ProvenanceKind, Rect, Size } from './contract.ts';
import { findNode, selectionBounds } from './arrangement.ts';
import type { ProviderRegistry } from './providers.ts';

/** Display text for provider provenance claims. Browser-made items never read as native. */
export const PROVENANCE_LABELS: Readonly<Record<ProvenanceKind, string>> = {
  'static-capture': 'Static capture',
  'live-preview': 'Live preview',
  'web-approximation': 'Web approximation — not native evidence',
  'component-sandbox': 'Component sandbox',
  'native-evidence': 'Native evidence (provider claim)',
  reference: 'Reference',
  unspecified: 'Provenance not stated',
};

export type ItemSourceState = 'ready' | 'missing-provider' | 'missing-item' | 'error';

export type InspectorModel =
  | { readonly kind: 'empty'; readonly itemCount: number; readonly artboardCount: number }
  | {
    readonly kind: 'item';
    readonly id: NodeId;
    readonly title: string;
    readonly itemKind: string | null;
    readonly providerLabel: string | null;
    /** Read-only: the exact pinned source. Canvas edits never change it. */
    readonly ref: CanvasItemRef;
    readonly provenance: string | null;
    readonly source: ItemSourceState;
    readonly sourceMessage: string | null;
    readonly frame: Rect;
    readonly intrinsicSize: Size | null;
    readonly scale: number | null;
    readonly artboardName: string | null;
    readonly locked: boolean;
    readonly hidden: boolean;
    readonly details: readonly { readonly label: string; readonly value: string }[];
  }
  | {
    readonly kind: 'artboard';
    readonly id: NodeId;
    readonly name: string;
    readonly frame: Rect;
    readonly locked: boolean;
    readonly childCount: number;
  }
  | {
    readonly kind: 'multiple';
    readonly count: number;
    readonly bounds: Rect;
    /** `null` when the selection mixes values. */
    readonly locked: boolean | null;
    readonly hidden: boolean | null;
    readonly canAlign: boolean;
    readonly canDistribute: boolean;
  };

function mixed<T>(values: readonly T[]): T | null {
  return values.every((value) => value === values[0]) ? values[0] ?? null : null;
}

/** Placeholder title for an item whose provider cannot describe it; never invents a new revision. */
export function fallbackTitle(ref: CanvasItemRef): string {
  return `${ref.entityId} @ ${ref.revision}`;
}

export function inspect(arrangement: CanvasArrangement, selection: readonly NodeId[], registry: ProviderRegistry): InspectorModel {
  const nodes = selection.map((id) => findNode(arrangement, id)).filter((node) => node !== null);
  if (nodes.length === 0) return { kind: 'empty', itemCount: arrangement.items.length, artboardCount: arrangement.artboards.length };
  if (nodes.length > 1) {
    const items = nodes.flatMap((node) => node.kind === 'item' ? [node.node] : []);
    return {
      kind: 'multiple', count: nodes.length, bounds: selectionBounds(arrangement, selection)!,
      locked: mixed(nodes.map((node) => node.node.locked)),
      hidden: items.length === nodes.length ? mixed(items.map((item) => item.hidden)) : null,
      canAlign: nodes.length >= 2, canDistribute: nodes.length >= 3,
    };
  }
  const only = nodes[0]!;
  if (only.kind === 'artboard') {
    return {
      kind: 'artboard', id: only.node.id, name: only.node.name, frame: only.node.frame, locked: only.node.locked,
      childCount: arrangement.items.filter((item) => item.artboardId === only.node.id).length,
    };
  }
  const placement = only.node;
  const description = registry.describe(placement.ref);
  const descriptor = description.status === 'ready' ? description.descriptor : null;
  const intrinsicSize = descriptor?.intrinsicSize ?? null;
  return {
    kind: 'item', id: placement.id, title: descriptor?.title ?? fallbackTitle(placement.ref),
    itemKind: descriptor?.kind ?? null,
    providerLabel: description.status === 'missing-provider' ? null : description.providerLabel,
    ref: placement.ref, provenance: descriptor ? PROVENANCE_LABELS[descriptor.provenance] : null,
    source: description.status,
    sourceMessage: description.status === 'missing-provider' ? `Provider ${placement.ref.providerId} is not registered`
      : description.status === 'missing-item' ? 'The provider does not know this revision'
        : description.status === 'error' ? description.message : null,
    frame: placement.frame, intrinsicSize,
    scale: intrinsicSize && intrinsicSize.width > 0 ? placement.frame.width / intrinsicSize.width : null,
    artboardName: placement.artboardId ? arrangement.artboards.find((board) => board.id === placement.artboardId)?.name ?? null : null,
    locked: placement.locked, hidden: placement.hidden, details: descriptor?.details ?? [],
  };
}
