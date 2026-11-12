import { PageHeader } from '../theme';
import { useEnv } from './env';
import { ViewHint } from './parts';
import './plan-week.css';

// Plan week (flow assessment 2026-11-03, P-1): a date-based board for the coming week. A backlog column, one column
// per day from the Planner's week_start, and a "This week, no day" lane. A drop adds or reschedules a day-precision
// Target through the store; it never invents a date and never starts anything. The Weekly plan lists (D-3) stay
// Proposed. Slice D of the flow assessment builds this view.

export const PLAN_WEEK_TITLE = 'Plan week';

export function PlanWeekView() {
  const { settings } = useEnv();
  return (
    <section className="wv-week" aria-labelledby="wv-week-title">
      <PageHeader
        title={PLAN_WEEK_TITLE} titleId="wv-week-title"
        meta={`Weeks start on ${settings.week_start === 'sun' ? 'Sunday' : 'Monday'}, from the Planner settings.`}
      />
      <ViewHint>Drag a card onto a day to give it a Target that day. Planning change only · no run started.</ViewHint>
    </section>
  );
}
