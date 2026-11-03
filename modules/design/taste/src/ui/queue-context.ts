import { createContext, useContext } from 'react';

/**
 * Taste's side of the Sources handoff. A composed view owns the real queue and hands Taste this context; the
 * section never imports the composition layer. Items mirror the handoff subjects structurally.
 */

export const QUEUE_ITEM_KINDS = ['reference', 'component', 'flow', 'other'] as const;
export type QueueItemKind = (typeof QUEUE_ITEM_KINDS)[number];

/** One thing waiting for a Taste rating. */
export interface TasteQueueItem {
  /** Stable identity at the sending section, for example a reference id. */
  readonly id: string;
  readonly kind: QueueItemKind;
  readonly label: string;
  /** Short secondary text, for example a site or revision. */
  readonly detail?: string;
  /** A `data:` or same-document image the sending section already shows. Never fetched from elsewhere. */
  readonly imageUrl?: string;
  /** Section id that sent it, resolved to a title by `originLabel`. */
  readonly from: string;
}

export interface TasteQueueValue {
  readonly items: readonly TasteQueueItem[];
  /** Called once an item's rating is confirmed saved; the owner of the queue removes it. */
  readonly onRated: (item: TasteQueueItem) => void;
  /** Called when the owner skips an item without rating it; the owner of the queue removes it. */
  readonly onSkipped: (item: TasteQueueItem) => void;
  /** Section title for `from` ("From References"). Defaults to the humanised section id. */
  readonly originLabel?: (from: string) => string;
}

export const TasteQueueContext = createContext<TasteQueueValue | null>(null);

/** The queue handed down by the composed view, or null when Taste is mounted on its own. */
export function useTasteQueue(): TasteQueueValue | null {
  return useContext(TasteQueueContext);
}
