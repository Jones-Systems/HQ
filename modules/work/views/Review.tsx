import { useState, type ReactNode } from 'react';
import { Button, Menu, StateView } from '@hq/ui';
import {
  HORIZONS, isLive, matchesFilters, MOTIVATIONS, reviewBucketsFor, STATUS_LABEL, STATUSES,
  type Item, type ItemPatch, type PlanningDate, type Status,
} from '../core';
import { useEnv } from './env';
import { untouchedDays } from './moves';
import { cx, DateChip, ItemRow, SectionHead, ViewHint } from './parts';

// Review (RV-4): gentle prompts for a periodic look-over. Nothing changes
// until the owner chooses an action, and each action is one write.

export function ReviewView() {
  const env = useEnv();
  const { state, settings, today } = env;
  const items = state.items.filter((it) => isLive(it) && matchesFilters(it, env.filters));
  const b = reviewBucketsFor(items, settings, env.now());
  const total = b.inbox.length + b.overdue.length + b.passedTargets.length + b.stale.length + b.mismatched.length + b.unsorted.length;

  const patch = (item: Item, fields: ItemPatch, message: string) => void env.run(env.store.patch(item.id, fields), message);
  const move = (item: Item, status: Status) => void env.run(env.store.move(item.id, status, { place: 'top' }), `Moved “${item.title}” to ${STATUS_LABEL[status]}.`);
  const editDate = (item: Item, entry: PlanningDate, label: string) => (env.editDate
    ? <Button size="sm" onClick={() => env.editDate!(item.id, entry.id)}>{label}</Button>
    : null);
  const moveMenu = (item: Item) => (
    <Menu
      size="sm"
      trigger="Move to…"
      triggerLabel={`Move “${item.title}” to…`}
      items={STATUSES.map((s) => ({ id: s.id, label: s.label, disabled: s.id === item.status, onSelect: () => move(item, s.id) }))}
    />
  );
  const staleControl = <QuietAfter />;

  return (
    <div className="wv-review">
      <ViewHint>Gentle prompts. Nothing changes until you choose an action.</ViewHint>
      {!total && <StateView state="empty" title="All clear" description="Inbox is empty, no dates have slipped past, and active items are fresh." />}

      {b.inbox.length > 0 && (
        <Section title="Sort the Inbox" count={b.inbox.length} hint="Give each capture a reason and a horizon, then move it on.">
          {b.inbox.map((item) => (
            <div key={item.id} className="wv-review-row">
              <ItemRow item={item} />
              <div className="wv-review-actions">
                <div className="wv-seg wv-seg--mini" role="group" aria-label={`Why for ${item.title}`}>
                  {MOTIVATIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={cx('wv-seg-btn', `wv-pill--${m.id}`)}
                      aria-pressed={item.motivation === m.id}
                      onClick={() => patch(item, { motivation: item.motivation === m.id ? null : m.id }, `Why saved for “${item.title}”.`)}
                    >{m.label}</button>
                  ))}
                </div>
                <div className="wv-seg wv-seg--mini" role="group" aria-label={`Horizon for ${item.title}`}>
                  {HORIZONS.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="wv-seg-btn"
                      aria-pressed={item.horizon === h.id}
                      onClick={() => patch(item, { horizon: item.horizon === h.id ? null : h.id }, `Horizon saved for “${item.title}”.`)}
                    >{h.label}</button>
                  ))}
                </div>
                {moveMenu(item)}
              </div>
            </div>
          ))}
        </Section>
      )}

      {b.overdue.length > 0 && (
        <Section title="Overdue deadlines" count={b.overdue.length} hint="Deadlines are the only dates that can be overdue." tone="alert">
          {b.overdue.map(({ item, entry }) => (
            <div key={`${item.id}:${entry.id}`} className="wv-review-row">
              <ItemRow item={item} trailing={<DateChip entry={entry} state="overdue" />} />
              <div className="wv-review-actions">
                {editDate(item, entry, 'Reschedule')}
                <Button size="sm" onClick={() => move(item, 'done')}>Mark done</Button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {b.passedTargets.length > 0 && (
        <Section title="Targets that have passed" count={b.passedTargets.length} hint="A passed target is a hint, not a failure.">
          {b.passedTargets.map(({ item, entry }) => (
            <div key={`${item.id}:${entry.id}`} className="wv-review-row">
              <ItemRow item={item} trailing={<DateChip entry={entry} state="passed" />} />
              <div className="wv-review-actions">{editDate(item, entry, 'New target')}</div>
            </div>
          ))}
        </Section>
      )}

      {b.stale.length > 0
        ? (
          <Section title="Active but quiet" count={b.stale.length} hint="Active items you have not touched for a while." action={staleControl}>
            {b.stale.map((item) => (
              <div key={item.id} className="wv-review-row">
                <ItemRow item={item} sub={`untouched ${untouchedDays(item, today, settings)} days`} />
                <div className="wv-review-actions">
                  <Button size="sm" onClick={() => void env.run(env.store.markReviewed(item.id), `Marked “${item.title}” as still active.`)}>Still active</Button>
                  {moveMenu(item)}
                </div>
              </div>
            ))}
          </Section>
        )
        : <div className="wv-review-setting">{staleControl}</div>}

      {b.mismatched.length > 0 && (
        <Section title="Horizon and date disagree" count={b.mismatched.length} hint="Both are valid; this is just a second look.">
          {b.mismatched.map(({ item, reason }) => <div key={item.id} className="wv-review-row"><ItemRow item={item} sub={reason} /></div>)}
        </Section>
      )}

      {b.unsorted.length > 0 && (
        <Section title="No “why” yet" count={b.unsorted.length} hint="Need, Want or Exploring helps the glance view.">
          {b.unsorted.map((item) => (
            <div key={item.id} className="wv-review-row">
              <ItemRow item={item} />
              <div className="wv-review-actions">
                <div className="wv-seg wv-seg--mini" role="group" aria-label={`Why for ${item.title}`}>
                  {MOTIVATIONS.map((m) => (
                    <button key={m.id} type="button" className={cx('wv-seg-btn', `wv-pill--${m.id}`)} aria-pressed={false} onClick={() => patch(item, { motivation: m.id }, `Why saved for “${item.title}”.`)}>{m.label}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, hint, tone, action, children }: { title: string; count: number; hint: string; tone?: 'alert'; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={cx('wv-review-section', tone === 'alert' && 'is-alert')} aria-label={title}>
      <SectionHead title={title} count={count} action={action} />
      <p className="wv-section-hint">{hint}</p>
      {children}
    </section>
  );
}

/** The Planner's "Quiet after" preference (`stale_days`, 1–365). It saves on Enter or when focus leaves. */
function QuietAfter() {
  const env = useEnv();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(env.settings.stale_days);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n > 365 || n === env.settings.stale_days) return;
    void env.run(env.store.updateSettings({ ...env.settings, stale_days: n }), `Active items now count as quiet after ${n} days.`);
  };
  return (
    <label className="wv-inline-setting">
      Quiet after{' '}
      <input
        type="number"
        min={1}
        max={365}
        className="wv-input-xs"
        aria-label="Days before an active item counts as quiet"
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
      />{' '}days
    </label>
  );
}
