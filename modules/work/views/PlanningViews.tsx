import { Component, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { InlineNotice, Skeleton, StateView } from '@hq/ui';
import {
  DEFAULT_SETTINGS, EMPTY_FILTERS, plannerToday, useWorkState,
  type Filters, type PlannerError, type SettingsResult, type WorkStore, type WriteOutcome,
} from '../core';
import { reportWrite, undoLatest } from '../board/actions';
import { createFeedback, PLANNING_ONLY_META, type Feedback } from '../board/feedback';
import { SyncBanners, SyncIndicator } from '../board/SyncStatus';
import { WorkToasts } from '../board/WorkToasts';
import { ArchiveView } from './Archive';
import { ByDateView } from './ByDate';
import { CalendarView } from './Calendar';
import { isTyping, ViewEnvProvider, type ViewEnv, type ViewLinks } from './env';
import { GlanceView } from './Glance';
import { ListView } from './ListView';
import { PROJECT_NOTE, type PlanningViewId } from './meta';
import { PlanWeekView } from './PlanWeek';
import { ReviewView } from './Review';
import { TimelineView } from './Timeline';
import './frame.css';

// The host for the Work planning views. It owns what every view shares: the
// not-project-scoped note, Ctrl/⌘+Z, the conflict notices and the loading and
// unavailable states. Save state, toasts and store notices belong to the Work
// top bar and the one toast viewport; this host only raises them (through the
// shared Work feedback list) and, when mounted alone, brings its own indicator
// and toast mirror. Every write goes through the Work store; navigation, layout
// switches and opening an item never write and never execute anything.

export interface PlanningViewsProps extends ViewLinks {
  readonly store: WorkStore;
  readonly view: PlanningViewId;
  /** Board-level filters from the Work toolbar. `area` filters by the Planner's label, never as a project. */
  readonly filters?: Filters;
  /** Clock for "today" in the Planner display zone; tests pass a fixed one. */
  readonly now?: () => Date;
  readonly pollMs?: number;
  /**
   * The Work feedback list. The Work domain passes its own and shows the toasts and the save state in its top bar.
   * Without it (a test host, an evidence page) this host keeps a list of its own and shows both itself.
   */
  readonly feedback?: Feedback;
}

const VIEWS: Record<PlanningViewId, () => ReactNode> = {
  glance: () => <GlanceView />,
  list: () => <ListView />,
  calendar: () => <CalendarView />,
  timeline: () => <TimelineView />,
  review: () => <ReviewView />,
  archive: () => <ArchiveView />,
  'by-date': () => <ByDateView />,
  week: () => <PlanWeekView />,
};

/** The skeleton shape that reads like each page while its first snapshot loads. */
const SKELETONS: Record<PlanningViewId, SkeletonShape> = {
  glance: 'grid', list: 'rows', calendar: 'grid', timeline: 'rows', review: 'rows', archive: 'rows', 'by-date': 'columns', week: 'columns',
};

const UNKNOWN_TEXT = 'Save result unknown. Check asks the Planner whether this request was saved; nothing is re-sent blindly.';

/** Words for a failed write (kept for existing callers; the views report through `reportWrite`). Unavailable and order conflicts are reported by the store's own notices. */
export function failureText(error: PlannerError): string | null {
  switch (error.kind) {
    case 'invalid': return `Not saved: ${error.errors.map((e) => e.message).join(' ')}`;
    case 'revision_conflict': return 'Not saved: this item changed elsewhere. Its current version is shown.';
    case 'not_found': return 'Not saved: the item is no longer available.';
    case 'request_id_reused': return 'Saving is paused: the Planner reported a reused request ID. Nothing will be re-sent.';
    case 'unknown': return UNKNOWN_TEXT;
    case 'unavailable':
    case 'order_conflict':
      return null;
  }
}

export function PlanningViews({ store, view, filters = EMPTY_FILTERS, now = defaultNow, pollMs, feedback: given, openItem, editDate, capture, navigate }: PlanningViewsProps) {
  const state = useWorkState(store, { pollMs });
  const [own] = useState(createFeedback);
  const feedback = given ?? own;
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now());

  /**
   * Raises the outcome of a write through the one Work mapping (`reportWrite`): a saved write offers Undo, a refused
   * one says what was kept, an unknown one offers Check.
   */
  const run = useCallback(async (write: Promise<WriteOutcome> | Promise<WriteOutcome<SettingsResult>>, success: string) => {
    const outcome = await write;
    reportWrite(feedback, outcome as WriteOutcome, success);
    return outcome.status === 'saved';
  }, [feedback]);

  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), []);

  const env: ViewEnv = useMemo(() => ({
    store, state, settings, today, now, filters, run, announce, feedback, openItem, editDate, capture, navigate,
  }), [store, state, settings, today, now, filters, run, announce, feedback, openItem, editDate, capture, navigate]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && !isTyping(event.target)) {
      // Marked handled so an outer Work-level shortcut does not undo twice.
      event.preventDefault();
      void undoLatest(store, feedback).then((outcome) => {
        if (outcome.status === 'empty') feedback.push({ message: 'Nothing to undo.', meta: PLANNING_ONLY_META, tone: 'info' });
      });
    }
  };

  // Nothing loaded yet: a skeleton while the first read is in flight, the full-page state only when it never answered.
  const body = state.confirmed === null
    ? state.load === 'unavailable'
      ? (
        <StateView
          state="unavailable"
          title="Planner service unreachable"
          description="Nothing can be shown until the Planner answers. No changes were made."
          action={{ label: 'Try again', onAction: () => void store.load() }}
        />
      )
      : <PageSkeleton shape={SKELETONS[view]} label="Loading planning…" />
    : <ViewBoundary key={view}><ViewEnvProvider value={env}>{VIEWS[view]()}</ViewEnvProvider></ViewBoundary>;

  const titleOf = (id: string) => state.items.find((it) => it.id === id)?.title;
  const standalone = given === undefined;

  return (
    <div className="wv" data-view={view} onKeyDown={onKeyDown}>
      <div className="wv-topline">
        <p className="wv-project-note" role="note">{PROJECT_NOTE}</p>
        {standalone && <SyncIndicator store={store} state={state} />}
      </div>
      {state.confirmed !== null && (
        <div className="wv-notices">
          <SyncBanners store={store} state={state} />
          {state.conflicts.map((c) => (
            <InlineNotice
              key={c.itemId} tone="warning" variant="bar" live="polite" title="Changed elsewhere"
              onDismiss={() => store.dismissConflict(c.itemId)}
            >
              {`“${titleOf(c.itemId) ?? c.current.title}” changed on another device, so your change was not applied. Its current version is shown.`}
            </InlineNotice>
          ))}
        </div>
      )}
      <div className="wv-body">{body}</div>
      {standalone && <WorkToasts store={store} state={state} feedback={feedback} />}
      <p className="hq-sr-only" role="status">{announcement.text}{announcement.n % 2 ? '​' : ''}</p>
    </div>
  );
}

function defaultNow(): Date {
  return new Date();
}

export type SkeletonShape = 'rows' | 'columns' | 'grid';

/**
 * A placeholder shaped like the page it stands in for: rows for a list, columns for a board, panels for Glance.
 * It is the loading state wherever Work has nothing to show yet; it never replaces content that has loaded.
 */
export function PageSkeleton({ shape, label }: { shape: SkeletonShape; label: string }) {
  const blocks = shape === 'columns' ? 4 : shape === 'grid' ? 3 : 0;
  return (
    <div className="wv-skeleton" data-state="loading" data-shape={shape} aria-busy="true">
      <p className="wk-quiet wv-skeleton-label" role="status">{label}</p>
      <div className="wv-skeleton-head">
        <Skeleton width="168px" height="22px" />
        <Skeleton width="min(320px, 60%)" />
      </div>
      {shape === 'rows' && (
        <div className="wv-skeleton-rows">
          {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} height="36px" />)}
        </div>
      )}
      {blocks > 0 && (
        <div className="wv-skeleton-blocks">
          {Array.from({ length: blocks }, (_, index) => (
            <div key={index} className="wv-skeleton-block">
              <Skeleton width="40%" />
              <Skeleton shape="block" height="64px" />
              <Skeleton shape="block" height="64px" />
              {index % 2 === 0 && <Skeleton shape="block" height="64px" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A view that throws shows the kit's error state instead of blanking Work. */
class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <StateView
          state="error"
          title="This view could not be shown"
          description="Nothing was changed. Other Work views still work."
          action={{ label: 'Try again', onAction: () => this.setState({ failed: false }) }}
        />
      );
    }
    return this.props.children;
  }
}
