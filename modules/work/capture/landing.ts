import { flyTo } from '../motion';

// Where a new capture lands (flow assessment C-1). Two places mark the spot: the Inbox column's card list on the
// board (`data-wk-capture-target="inbox"`) and the Status board item in the Work navigation (`data-wk-capture-target="nav"`).
// After a save, a labelled token flies from the capture field to the first visible Inbox list, otherwise to the nav
// item, and the target flashes. It is decoration: the toast and the Inbox card carry the result, and under reduced
// motion nothing moves and only the target flashes.

export const CAPTURE_TARGET_ATTRIBUTE = 'data-wk-capture-target';

const isVisible = (element: Element): boolean => typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;

/** The first visible Inbox list, otherwise the visible Work nav item, otherwise nothing to fly to. */
export function captureTarget(root: ParentNode = document): Element | null {
  const inbox = [...root.querySelectorAll(`[${CAPTURE_TARGET_ATTRIBUTE}="inbox"]`)].find(isVisible);
  if (inbox) return inbox;
  const nav = [...root.querySelectorAll(`[${CAPTURE_TARGET_ATTRIBUTE}="nav"]`)].find(isVisible);
  return nav ?? null;
}

/** Flies `title` from `from` (the capture field or dialog) to where captures land. Returns the animation, or null when nothing animates. */
export function landCapture(from: Element | DOMRect | null | undefined, title: string, root: ParentNode = document): Animation | null {
  if (!from) return null;
  const target = captureTarget(root);
  return target ? flyTo(from, target, title) : null;
}
