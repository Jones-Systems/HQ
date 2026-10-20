// Work planning views (task.work-views.001): Glance, List, Calendar, Timeline,
// Review, Archive and the read-only By date board. The Work domain mounts
// `PlanningViews` with the shared Work store; the Board, card detail and
// capture belong to their own lanes and connect through the optional links.
import './work-views.css';

export { PlanningViews, failureText, type PlanningViewsProps } from './PlanningViews';
export type { ViewLinks } from './env';
export {
  NO_RUN_NOTE, PLANNING_VIEW_IDS, PROJECT_NOTE, WORK_BOARDS, WORK_HOME_VIEW, WORK_VIEWS,
  type PlanningViewId, type WorkDestination,
} from './meta';
export {
  addDatePatch, CHIP_KEY_DAYS, removeDatePatch, rescheduleDatePatch, scheduleDay, shiftDatePatch, stepHorizon,
  TIMELINE_LANES, timelineGeometry, timelineScale, UPCOMING_DAYS,
} from './moves';
export { BY_DATE_BANNER, BY_DATE_INERT } from './ByDate';
export { LIST_COLUMNS } from './ListView';
