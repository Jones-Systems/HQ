import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Menu, StateView } from '@hq/ui';
import {
  HORIZONS, isLive, matchesFilters, MOTIVATIONS, reviewBucketsFor, STATUS_LABEL, STATUSES,
  type Item, type ItemPatch, type PlanningDate, type Status,
} from '../core';
import { PageHeader } from '../theme';
import { RetainedRows } from './RetainedRows';
import { isPending, isTyping, useRemembered, useEnv } from './env';
import { untouchedDays } from './moves';
import { cx, DateChip, ItemRow, SectionHead, ViewHint } from './parts';
import './review.css';

// Review (RV-4): gentle prompts for a periodic look-over. Nothing changes
// until the owner chooses an action, and each action is one write.

export function ReviewView() {
  const env = useEnv();
  const { state, settings, today } = env;
  const items = state.items.filter((it) => isLive(it) && matchesFilters(it, env.filters));
  const b = reviewBucketsFor(items, settings, env.now());
  const total = b.inbox.length + b.overdue.length + b.passedTargets.length + b.stale.length + b.mismatched.length + b.unsorted.length;

  const groups = { inbox: b.inbox.map((i) => i.id), overdue: b.overdue.map((x) => `${x.item.id}:${x.entry.id}`),
    passedTargets: b.passedTargets.map((x) => `${x.item.id}:${x.entry.id}`), stale: b.stale.map((i) => i.id),
    mismatched: b.mismatched.map((x) => x.item.id), unsorted: b.unsorted.map((i) => i.id) };
  const [seen, setSeen] = useRemembered<Record<string, string[]>>('review.seen', {});
  const currentKeys = Object.entries(groups).flatMap(([g, ids]) => ids.map((id) => `${g}/${id}`));
  const allKeys = [...new Set([...(seen.all ?? []), ...currentKeys])];
  const inboxSeen = [...new Set([...(seen.inbox ?? []), ...groups.inbox])];
  const signature = allKeys.join('|') + inboxSeen.join('|');
  useEffect(() => { setSeen({ all: allKeys, inbox: inboxSeen }); }, [signature]);
  const resolved = allKeys.filter((key) => !currentKeys.includes(key)).length;
  const cutoff = env.now().getTime() - 7 * 86400000;
  const recent = (stamp: string) => { const t = Date.parse(stamp); return t >= cutoff && t <= env.now().getTime(); };
  const triageKey = (event: KeyboardEvent<HTMLDivElement>, item: Item) => {
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const motivation = ({ n: 'need', w: 'want', e: 'exploring' } as Record<string, Item['motivation']>)[key] as Item['motivation'] | undefined;
    const horizon = HORIZONS[Number(key) - 1];
    const status = ({ c: 'considering', m: 'next', a: 'active', h: 'on_hold', d: 'done', x: 'dropped' } as const)[key as 'c'];
    if (key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault(); event.stopPropagation();
      const rows = [...event.currentTarget.closest('section')!.querySelectorAll<HTMLElement>('[data-triage]')];
      const index = rows.indexOf(event.currentTarget);
      rows[index + (key === 'arrowdown' ? 1 : -1)]?.focus(); return;
    }
    if (key === 'enter' && event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); env.openItem?.(item.id); return; }
    if (!motivation && !horizon && !status) return;
    event.preventDefault(); event.stopPropagation();
    if (motivation) patch(item, { motivation: item.motivation === motivation ? null : motivation }, 'Why saved.');
    else if (horizon) patch(item, { horizon: item.horizon === horizon.id ? null : horizon.id }, 'Horizon saved.');
    else if (status) move(item, status);
  };
  const patch = (item: Item, fields: ItemPatch, message: string) => { if (!isPending(state, item.id) && !state.held) void env.run(env.store.patch(item.id, fields), message); };
  const move = (item: Item, status: Status) => {
    if (isPending(state, item.id) || state.held) return;
    const row = document.activeElement?.closest<HTMLElement>('[data-triage]');
    const rows = row ? [...(row.closest('section')?.querySelectorAll<HTMLElement>('[data-triage]') ?? [])] : [];
    const next = row ? rows[rows.indexOf(row) + 1] ?? rows[rows.indexOf(row) - 1] : null;
    void env.run(env.store.move(item.id, status, { place: 'top' }), `Moved “${item.title}” to ${STATUS_LABEL[status]}.`);
    if (row?.dataset.triage === item.id) requestAnimationFrame(() => { if (next?.isConnected) next.focus(); else document.getElementById('wv-review-title')?.focus(); });
  };
  const editDate = (item: Item, entry: PlanningDate, label: string) => (env.editDate
    ? <Button size="sm" onClick={() => env.editDate!(item.id, entry.id)}>{label}</Button>
    : null);
  const moveMenu = (item: Item) => (
    <Menu
      size="sm"
      trigger="Move to…"
      triggerLabel={`Move “${item.title}” to…`}
      items={STATUSES.map((s) => ({ id: s.id, label: s.label, disabled: s.id === item.status || isPending(state, item.id), onSelect: () => move(item, s.id) }))}
    />
  );
  const staleControl = <QuietAfter />;

  return (
    <div className="wv-review">
      <PageHeader title={<span id="wv-review-title" tabIndex={-1}>Review</span>} meta={`${total} prompts · ${resolved} resolved this session`} />
      <div className="wv-review-week" aria-label="This week">This week · {items.filter((i) => i.status === 'done' && recent(i.updated_at)).length} finished · {items.filter((i) => recent(i.created_at)).length} captured · {items.filter((i) => i.status === 'dropped' && recent(i.updated_at)).length} dropped</div>
      <ViewHint>Gentle prompts. Nothing changes until you choose an action.</ViewHint>
      {!total && <StateView state="empty" title="All clear" description="Inbox is empty, no dates have slipped past, and active items are fresh." />}

      {(b.inbox.length > 0 || allKeys.some((k) => k.startsWith('inbox/'))) && (
        <Section title="Sort the Inbox" count={b.inbox.length} hint="Give each capture a reason and a horizon, then move it on.">
          <p className="wv-triage-help">Why: N Need · W Want · E Exploring. Horizon: 1–4. Move: C Considering · M Next · A Active · H On hold · D Done · X Dropped. ↑/↓ focuses rows.</p>
          <p>{inboxSeen.filter((id) => !groups.inbox.includes(id)).length} of {inboxSeen.length} sorted this session</p>
          {b.inbox.map((item) => (
            <div key={item.id} className="wv-review-row" data-triage={item.id} tabIndex={b.inbox[0]?.id === item.id ? 0 : -1} onKeyDown={(e) => triageKey(e, item)}>
              <ItemRow item={item} />
              <div className="wv-review-actions">
                <div className="wv-seg wv-seg--mini" role="group" aria-label={`Why for ${item.title}`}>
                  {MOTIVATIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={cx('wv-seg-btn', `wv-pill--${m.id}`)}
                      aria-keyshortcuts={m.id === 'need' ? 'N' : m.id === 'want' ? 'W' : 'E'}
                      disabled={isPending(state, item.id)}
                      aria-pressed={item.motivation === m.id}
                      onClick={() => patch(item, { motivation: item.motivation === m.id ? null : m.id }, `Why saved for “${item.title}”.`)}
                    >{m.label}<kbd className="wk-kbd" aria-hidden="true">{m.id === 'need' ? 'N' : m.id === 'want' ? 'W' : 'E'}</kbd></button>
                  ))}
                </div>
                <div className="wv-seg wv-seg--mini" role="group" aria-label={`Horizon for ${item.title}`}>
                  {HORIZONS.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="wv-seg-btn"
                      aria-keyshortcuts={String(HORIZONS.indexOf(h) + 1)}
                      disabled={isPending(state, item.id)}
                      aria-pressed={item.horizon === h.id}
                      onClick={() => patch(item, { horizon: item.horizon === h.id ? null : h.id }, `Horizon saved for “${item.title}”.`)}
                    >{h.label}<kbd className="wk-kbd" aria-hidden="true">{HORIZONS.indexOf(h) + 1}</kbd></button>
                  ))}
                </div>
                <div role="group" aria-label={`Move ${item.title} to`}>{STATUSES.filter((s) => s.id !== 'inbox').map((s) => <Button key={s.id} size="sm" disabled={isPending(state, item.id)} onClick={() => move(item, s.id)}>{s.label}</Button>)}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      {(b.overdue.length > 0 || allKeys.some((k) => k.startsWith('overdue/'))) && (
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

      {(b.passedTargets.length > 0 || allKeys.some((k) => k.startsWith('passedTargets/'))) && (
        <Section title="Targets that have passed" count={b.passedTargets.length} hint="A passed target is a hint, not a failure.">
          {b.passedTargets.map(({ item, entry }) => (
            <div key={`${item.id}:${entry.id}`} className="wv-review-row">
              <ItemRow item={item} trailing={<DateChip entry={entry} state="passed" />} />
              <div className="wv-review-actions">{editDate(item, entry, 'New target')}</div>
            </div>
          ))}
        </Section>
      )}

      {(b.stale.length > 0 || allKeys.some((k) => k.startsWith('stale/')))
        ? (
          <Section title="Active but quiet" count={b.stale.length} hint="Active items you have not touched for a while." action={staleControl}>
            {b.stale.map((item) => (
              <div key={item.id} className="wv-review-row">
                <ItemRow item={item} sub={`untouched ${untouchedDays(item, today, settings)} days`} />
                <div className="wv-review-actions">
                  <Button size="sm" disabled={isPending(state, item.id)} onClick={() => void env.run(env.store.markReviewed(item.id), `Marked “${item.title}” as still active.`)}>Still active</Button>
                  {moveMenu(item)}
                </div>
              </div>
            ))}
          </Section>
        )
        : <div className="wv-review-setting">{staleControl}</div>}

      {(b.mismatched.length > 0 || allKeys.some((k) => k.startsWith('mismatched/'))) && (
        <Section title="Horizon and date disagree" count={b.mismatched.length} hint="Both are valid; this is just a second look.">
          {b.mismatched.map(({ item, reason }) => <div key={item.id} className="wv-review-row"><ItemRow item={item} sub={reason} /></div>)}
        </Section>
      )}

      {(b.unsorted.length > 0 || allKeys.some((k) => k.startsWith('unsorted/'))) && (
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
      <RetainedRows>{children}</RetainedRows>
      {count === 0 && <p>All clear · {title}</p>}
    </section>
  );
}

/** The Planner's "Quiet after" preference (`stale_days`, 1–365). It saves on Enter or when focus leaves. */
function QuietAfter() {
  const env = useEnv();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(env.settings.stale_days);
  const commit = () => {
    if (draft === null || env.store.getState().held) return;
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
