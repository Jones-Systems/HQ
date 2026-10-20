import { StateView } from '@hq/ui';
import {
  addDays, dateState, DEFAULT_SETTINGS, formatDay, isLive, isOpen, matchesFilters, relativeDays, reviewBucketsFor,
  sortByPosition, STATUSES, type Item, type Settings,
} from '../core';
import { useEnv } from './env';
import { currentPeriodEntries, UPCOMING_DAYS, upcomingEntries } from './moves';
import { ago, DateChip, ItemRow, MotivationPill, Quiet, SectionHead, StatusMark, cx } from './parts';

// Glance (RV-4): what matters now, what's coming, and what needs sorting,
// without opening anything. Every link here only navigates.

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
const CLOSED = new Set(['done', 'dropped']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Planner greeting by the hour in the display zone. */
export function greeting(now: Date, settings: Pick<Settings, 'default_tz'>): string {
  const hourIn = (timeZone: string) => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now)) % 24;
  let hour: number;
  try { hour = hourIn(settings.default_tz); } catch { hour = hourIn(DEFAULT_SETTINGS.default_tz); }
  if (hour < 5) return 'Late night planning';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export function GlanceView() {
  const env = useEnv();
  const { today, settings, state } = env;
  const all = state.items.filter(isLive);
  if (!all.length) {
    return (
      <StateView
        state="empty"
        title="Your planning hub is empty"
        description="Capture projects, ideas and goals with just a title. Sort them later on the board, give them a horizon, and add dates only when they help."
        action={env.capture ? { label: 'New item', onAction: () => env.capture!({}) } : undefined}
      />
    );
  }
  const items = all.filter((it) => matchesFilters(it, env.filters));
  const open = items.filter(isOpen);
  const buckets = reviewBucketsFor(items, settings, env.now());
  const upcoming = upcomingEntries(open, today);
  const go = env.navigate;

  const summary = [`${open.filter((i) => i.status === 'active').length} active`];
  if (buckets.overdue.length) summary.push(`${buckets.overdue.length} overdue`);
  summary.push(`${upcoming.length} date${upcoming.length === 1 ? '' : 's'} in the next ${UPCOMING_DAYS} days`);
  if (buckets.inbox.length) summary.push(`${buckets.inbox.length} in Inbox`);

  const now = sortByPosition(open.filter((i) => i.status === 'active' || i.horizon === 'now'))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      || (PRIORITY_RANK[a.priority ?? 'normal'] ?? 1) - (PRIORITY_RANK[b.priority ?? 'normal'] ?? 1));
  const periods = currentPeriodEntries(open, today);
  const attention = buckets.passedTargets.length + buckets.stale.length + buckets.mismatched.length;
  const recent = [...items].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 5);
  const more = (label: string, to: () => void) => <button type="button" className="wv-more" onClick={to}>{label} ›</button>;

  const upcomingGroups: { day: string; list: typeof upcoming }[] = [];
  for (const x of upcoming) {
    const last = upcomingGroups[upcomingGroups.length - 1];
    if (last && last.day === x.start) last.list.push(x);
    else upcomingGroups.push({ day: x.start, list: [x] });
  }

  return (
    <div className="wv-glance">
      <section className="wv-glance-hero">
        <p className="wv-eyebrow">{longDay(today)}</p>
        <h2 className="wv-glance-heading">{greeting(env.now(), settings)}</h2>
        <p className="wv-glance-summary">{summary.join(' · ')}</p>
        <nav className="wv-strip" aria-label="Items by status">
          {STATUSES.filter((s) => !CLOSED.has(s.id)).map((s) => {
            const count = items.filter((i) => i.status === s.id).length;
            const body = <><StatusMark status={s.id} /><strong>{count}</strong></>;
            return go
              ? <button key={s.id} type="button" className="wv-strip-pill" aria-label={`${s.label}: ${count}. Open on the board`} onClick={() => go({ view: 'board', column: s.id })}>{body}</button>
              : <span key={s.id} className="wv-strip-pill">{body}</span>;
          })}
          <span className="wv-strip-done">{items.filter((i) => i.status === 'done').length} done</span>
        </nav>
      </section>

      <div className="wv-glance-grid">
        <section className="wv-panel wv-panel--now" aria-label="Now">
          <SectionHead title="Now" count={now.length} />
          {now.length
            ? (
              <div className="wv-rows">
                {now.slice(0, 8).map((item) => {
                  const step = item.next_steps.find((s) => !s.done);
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      sub={step ? `Next: ${step.text}` : undefined}
                      trailing={<>{item.status === 'active' && <StatusMark status="active" />}<MotivationPill motivation={item.motivation} /></>}
                    />
                  );
                })}
                {now.length > 8 && go && more(`${now.length - 8} more on the board`, () => go({ view: 'board' }))}
              </div>
            )
            : <Quiet title="Nothing marked Active or Now." hint="Set a horizon of Now or move a card to Active." />}
        </section>

        <section className="wv-panel wv-panel--upcoming" aria-label={`Next ${UPCOMING_DAYS} days`}>
          <SectionHead title={`Next ${UPCOMING_DAYS} days`} count={upcoming.length + buckets.overdue.length} />
          <div className="wv-mini-agenda">
            {buckets.overdue.length > 0 && (
              <div className="wv-agenda-group is-overdue">
                <div className="wv-agenda-dayname">Overdue</div>
                {buckets.overdue.map(({ item, entry }) => <ItemRow key={`${item.id}:${entry.id}`} item={item} trailing={<DateChip entry={entry} state="overdue" />} />)}
              </div>
            )}
            {upcomingGroups.map((g) => {
              const near = g.day === today || g.day === addDays(today, 1);
              return (
                <div key={g.day} className={cx('wv-agenda-group', g.day === today && 'is-today')}>
                  <div className="wv-agenda-dayname">
                    {g.day === today ? 'Today' : g.day === addDays(today, 1) ? 'Tomorrow' : formatDay(g.day, { today })}
                    {!near && <span className="wv-muted"> · {relativeDays(today, g.day)}</span>}
                  </div>
                  {g.list.map(({ item, entry }) => <ItemRow key={`${item.id}:${entry.id}`} item={item} trailing={<DateChip entry={entry} state={dateState(entry, today, true)} />} />)}
                </div>
              );
            })}
            {periods.length > 0 && (
              <div className="wv-agenda-group is-period">
                <div className="wv-agenda-dayname">{MONTHS[Number(today.slice(5, 7)) - 1]} &amp; this quarter — no set day</div>
                {periods.map(({ item, entry }) => <ItemRow key={`${item.id}:${entry.id}`} item={item} trailing={<DateChip entry={entry} state="current" />} />)}
              </div>
            )}
            {!buckets.overdue.length && !upcoming.length && !periods.length
              && <Quiet title="No dates coming up." hint="Dates are optional. Add one from an item or on the calendar." />}
          </div>
          {go && more('Open calendar', () => go({ view: 'calendar' }))}
        </section>

        <section className="wv-panel wv-panel--inbox" aria-label="Inbox">
          <SectionHead title="Inbox" count={buckets.inbox.length} />
          {buckets.inbox.length
            ? (
              <div className="wv-rows">
                {buckets.inbox.slice(0, 6).map((item) => <ItemRow key={item.id} item={item} trailing={<MotivationPill motivation={item.motivation} />} />)}
                {go && more('Sort in Review', () => go({ view: 'review' }))}
              </div>
            )
            : <Quiet title="Inbox is clear." hint="Quick captures land here until you sort them." />}
        </section>

        <section className="wv-panel wv-panel--attention" aria-label="Worth a look">
          <SectionHead title="Worth a look" count={attention} />
          {attention
            ? (
              <ul className="wv-attn">
                {buckets.passedTargets.length > 0 && <AttnLine text={`${buckets.passedTargets.length} target date${buckets.passedTargets.length === 1 ? ' has' : 's have'} passed`} />}
                {buckets.stale.length > 0 && <AttnLine text={`${buckets.stale.length} active item${buckets.stale.length === 1 ? '' : 's'} untouched for ${settings.stale_days}+ days`} />}
                {buckets.mismatched.length > 0 && <AttnLine text={`${buckets.mismatched.length} horizon/date mismatch${buckets.mismatched.length === 1 ? '' : 'es'}`} />}
              </ul>
            )
            : <Quiet title="Nothing needs a look." hint="Passed targets, quiet active items and horizon mismatches show up here." />}
        </section>

        <section className="wv-panel wv-panel--recent" aria-label="Recently changed">
          <SectionHead title="Recently changed" />
          <div className="wv-rows">
            {recent.map((item: Item) => <ItemRow key={item.id} item={item} trailing={<span className="wv-muted">{ago(item.updated_at, env.now(), settings)}</span>} />)}
          </div>
        </section>
      </div>
    </div>
  );
}

function AttnLine({ text }: { text: string }) {
  const { navigate } = useEnv();
  return <li>{navigate ? <button type="button" className="wv-attn-line" onClick={() => navigate({ view: 'review' })}>{text} ›</button> : text}</li>;
}
