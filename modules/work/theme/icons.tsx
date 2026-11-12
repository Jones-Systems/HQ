import type { ReactNode } from 'react';
import type { DateKind, ItemKind, Status } from '../core';

// The one set of Work marks, shared by every surface. A mark is a shape that reinforces a visible word; it never carries
// meaning alone. Kind marks are deliberately not squares, so nothing reads as a checkbox that isn't one.

const KIND_PATHS: Record<ItemKind, ReactNode> = {
  project: <path d="M3.5 7.5v10h17v-8h-8l-2-2z" />,
  idea: <><path d="M9 17h6M10 20h4" /><path d="M12 4a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" /></>,
  goal: <path d="M6 20V4m0 1h11l-2 4 2 4H6" />,
  chore: <path d="m14 4 6 6-9 9H5v-6zM12 6l6 6" />,
};

/** The item kind (project, idea, goal, chore) as a 16px line icon. Decorative: pair it with words or a label. */
export function KindIcon({ kind, small = false }: { kind: ItemKind; small?: boolean }) {
  return <svg className={small ? 'work-icon work-icon--sm' : 'work-icon'} viewBox="0 0 24 24" aria-hidden="true">{KIND_PATHS[kind]}</svg>;
}

const DATE_KIND_PATHS: Record<DateKind, ReactNode> = {
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></>,
  deadline: <path d="M6 20V4m0 1h11l-2 4 2 4H6" />,
  start: <path d="M5 12h12m-4-5 5 5-5 5" />,
  event: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
};

/** The date kind (target, deadline, start, event) as a 14px line icon. Decorative: chips always show the date words. */
export function DateKindIcon({ kind }: { kind: DateKind }) {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true">{DATE_KIND_PATHS[kind]}</svg>;
}

/** The status shape (ring, half, dot, filled, bars, square, slash) that sits beside every status word. */
export function StatusDot({ status }: { status: Status }) {
  return <span className={`wk-dot wk-dot--${status}`} aria-hidden="true" />;
}

/** A round "mark done" check. The button around it owns the label and the move. */
export function CheckIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>;
}

export function ArrowUpIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>;
}
