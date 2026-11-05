// Work navigation metadata (T4 information architecture). The Board itself
// belongs to the board lane; these views are the rest of the Work views.

/** The planning views this package renders. `by-date` is the read-only By date board (RV-5). */
export const PLANNING_VIEW_IDS = ['glance', 'list', 'calendar', 'timeline', 'review', 'archive', 'by-date'] as const;
export type PlanningViewId = (typeof PLANNING_VIEW_IDS)[number];

/** Work views in Planner order; the number keys match the Planner. */
export const WORK_VIEWS = [
  { id: 'glance', label: 'Glance', key: '1' },
  { id: 'board', label: 'Board', key: '2' },
  { id: 'list', label: 'List', key: '3' },
  { id: 'calendar', label: 'Calendar', key: '4' },
  { id: 'timeline', label: 'Timeline', key: '5' },
  { id: 'review', label: 'Review', key: '6' },
  { id: 'archive', label: 'Archive', key: '7' },
] as const;

/** Work boards. "lists" is kept as an alias destination for By date (RV-5). */
export const WORK_BOARDS = [
  { id: 'status', label: 'Status board' },
  { id: 'by-date', label: 'By date', aliases: ['lists'] },
] as const;

/** RV-7 working default: Work's home is the Board. */
export const WORK_HOME_VIEW = 'board';

/** RV-7: Planner items carry no project, so Work shows all planning and says so. */
export const PROJECT_NOTE = "Planner items aren't project-scoped · showing all planning";

/** Shown in every toast: a planning write is local planning data and never starts anything. */
export const NO_RUN_NOTE = 'Planning change only · no run started';

/** Where a view link may lead. Navigation only; it never writes or executes. */
export type WorkDestination =
  | { view: 'board'; column?: string }
  | { view: PlanningViewId };
