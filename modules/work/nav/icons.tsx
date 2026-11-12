import type { ReactNode } from 'react';
import type { NavItem } from './routes';

// Line icons for the Work frame, drawn like the theme's kind and date-kind marks (24px grid, 1.6 stroke, round caps) so
// they sit in one family with them. They are decoration: every nav item and control carries its own visible or accessible
// words.

const NAV_PATHS: Record<NavItem['page'], ReactNode> = {
  glance: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
  timeline: <path d="M4 7h9M8 12h12M6 17h8" />,
  review: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  archive: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5M10 13h4" /></>,
  board: <><rect x="4" y="4.5" width="4.5" height="15" rx="1.2" /><rect x="10" y="4.5" width="4.5" height="9" rx="1.2" /><rect x="16" y="4.5" width="4" height="12" rx="1.2" /></>,
  'by-date': <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4M8 14h3" /></>,
  week: <><rect x="3.5" y="5" width="17" height="14.5" rx="2" /><path d="M9.2 5v14.5M14.8 5v14.5M3.5 10h17" /></>,
  settings: <><path d="M4.5 8h6M15.5 8h4M4.5 16h3M12.5 16h7" /><circle cx="13" cy="8" r="2.2" /><circle cx="10" cy="16" r="2.2" /></>,
};

/** The line icon for a navigation item. */
export function NavIcon({ page }: { page: NavItem['page'] }) {
  return <svg className="work-icon wd-nav-icon" viewBox="0 0 24 24" aria-hidden="true">{NAV_PATHS[page]}</svg>;
}

export function PlusIcon() {
  return <svg className="work-icon work-icon--sm wd-capture-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

export function SearchIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>;
}

export function FilterIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}

export function CloseIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

export function InfoIcon() {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>;
}
