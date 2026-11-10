import { useId, useState } from 'react';
import { Button } from '@hq/ui';
import {
  DATE_KIND_LABEL, DATE_KINDS, dateState, formatValue, LIMITS, periodBounds, PRECISION_LABEL, PRECISIONS, relativeDays,
  stripDerived, valueContaining,
  type DateInput, type DateKind, type PlanningDate, type Precision, type Settings,
} from '../core';
import { COARSE_PRECISIONS, DateKindIcon } from '../board/parts';

// The typed date editor (RV-3). Each entry keeps its own kind and precision; a
// coarse date is never shown or saved as a single day unless the user changes
// its precision. A time needs day precision and an IANA zone, as the Planner
// requires; the Planner validates and its messages are shown as they come.

const VALUE_HINT: Record<Precision, string> = {
  day: 'YYYY-MM-DD', week: 'YYYY-Www, for example 2026-W43', month: 'YYYY-MM', quarter: 'YYYY-Qn, for example 2027-Q2', year: 'YYYY',
};

interface Draft { id?: string; kind: DateKind; precision: Precision; value: string; time: string; end_time: string; tz: string; note: string }

function toDraft(entry: PlanningDate | null, today: string, settings: Settings): Draft {
  if (!entry) return { kind: 'target', precision: 'day', value: today, time: '', end_time: '', tz: settings.default_tz, note: '' };
  return {
    id: entry.id, kind: entry.kind, precision: entry.precision, value: entry.value,
    time: entry.time ?? '', end_time: entry.end_time ?? '', tz: entry.tz ?? settings.default_tz, note: entry.note,
  };
}

function toInput(draft: Draft): DateInput {
  const timed = draft.precision === 'day' && draft.time !== '';
  return {
    ...(draft.id ? { id: draft.id } : {}),
    kind: draft.kind, precision: draft.precision, value: draft.value.trim(),
    time: timed ? draft.time : null,
    end_time: timed && draft.end_time ? draft.end_time : null,
    tz: timed ? draft.tz.trim() : null,
    note: draft.note,
  };
}

/** Relative words for an entry: "in 3 days", "this period", "2 weeks ago". */
export function relativeText(entry: PlanningDate, today: string): string {
  const bounds = periodBounds(entry.precision, entry.value);
  if (!bounds) return '';
  const state = dateState(entry, today, true);
  if (state === 'current') return 'this period';
  if (state === 'today') return 'today';
  return relativeDays(today, state === 'upcoming' ? bounds[0] : bounds[1]);
}

export interface DateEditorProps {
  dates: readonly PlanningDate[];
  today: string;
  settings: Settings;
  /** Saves the whole list; the Planner validates it. Resolves to field errors, or null when saved. */
  onSave(next: DateInput[]): Promise<string | null>;
  disabled?: boolean;
}

export function DateEditor({ dates, today, settings, onSave, disabled }: DateEditorProps) {
  const id = useId();
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existing = (): DateInput[] => dates.map((entry) => stripDerived(entry));

  const commit = async (next: DateInput[]) => {
    setBusy(true);
    try {
      const problem = await onSave(next);
      setError(problem);
      if (!problem) setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (!editing) return;
    const input = toInput(editing.draft);
    const next = existing();
    if (editing.index === null) next.push(input);
    else next[editing.index] = input;
    void commit(next);
  };

  const setDraft = (patch: Partial<Draft>) => setEditing((current) => current && { ...current, draft: { ...current.draft, ...patch } });

  const changePrecision = (precision: Precision) => {
    if (!editing) return;
    // An explicit precision change keeps the period's start day, so nothing is silently moved.
    const start = periodBounds(editing.draft.precision, editing.draft.value)?.[0] ?? today;
    setDraft({ precision, value: valueContaining(precision, start), ...(precision === 'day' ? {} : { time: '', end_time: '' }) });
  };

  const draft = editing?.draft;
  return (
    <div className="work-dates">
      {dates.length === 0 && !editing && <p className="work-empty-line">No dates. Nothing is dated unless you add one.</p>}
      <ul className="work-date-list">
        {dates.map((entry, index) => (
          <li key={entry.id} className={`work-date${COARSE_PRECISIONS.has(entry.precision) ? ' work-date--coarse' : ''}`}>
            <span className={`work-date-kind work-chip--dk-${entry.kind}`}><DateKindIcon kind={entry.kind} />{DATE_KIND_LABEL[entry.kind]}</span>
            <span className="work-date-value">
              <span>{formatValue(entry, today)}</span>
              <span className="hq-meta">{PRECISION_LABEL[entry.precision]} · {relativeText(entry, today)}{entry.note && ` · ${entry.note}`}</span>
            </span>
            <span className="work-date-actions">
              <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => { setError(null); setEditing({ index, draft: toDraft(entry, today, settings) }); }}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void commit(existing().filter((_, i) => i !== index))}>Remove</Button>
            </span>
          </li>
        ))}
      </ul>
      {editing && draft ? (
        <fieldset className="work-date-form" aria-describedby={error ? `${id}-error` : undefined}>
          <legend>{editing.index === null ? 'Add a date' : 'Edit date'}</legend>
          <label className="work-field">
            <span className="work-field-label">Kind</span>
            <select className="work-input" value={draft.kind} onChange={(event) => setDraft({ kind: event.target.value as DateKind })}>
              {DATE_KINDS.map((kind) => <option key={kind} value={kind}>{DATE_KIND_LABEL[kind]}</option>)}
            </select>
          </label>
          <label className="work-field">
            <span className="work-field-label">Precision</span>
            <select className="work-input" value={draft.precision} onChange={(event) => changePrecision(event.target.value as Precision)}>
              {PRECISIONS.map((precision) => <option key={precision} value={precision}>{PRECISION_LABEL[precision]}</option>)}
            </select>
          </label>
          <label className="work-field">
            <span className="work-field-label">{PRECISION_LABEL[draft.precision]}</span>
            <input
              className="work-input"
              type={draft.precision === 'day' ? 'date' : draft.precision === 'month' ? 'month' : 'text'}
              value={draft.value}
              placeholder={VALUE_HINT[draft.precision]}
              onChange={(event) => setDraft({ value: event.target.value })}
            />
            <span className="hq-meta">{VALUE_HINT[draft.precision]}</span>
          </label>
          {draft.precision === 'day' && (
            <>
              <label className="work-field">
                <span className="work-field-label">Time (optional)</span>
                <input className="work-input" type="time" value={draft.time} onChange={(event) => setDraft({ time: event.target.value })} />
              </label>
              {draft.time && (
                <>
                  <label className="work-field">
                    <span className="work-field-label">Ends (optional)</span>
                    <input className="work-input" type="time" value={draft.end_time} onChange={(event) => setDraft({ end_time: event.target.value })} />
                  </label>
                  <label className="work-field">
                    <span className="work-field-label">Time zone</span>
                    <input className="work-input" value={draft.tz} spellCheck={false} onChange={(event) => setDraft({ tz: event.target.value })} />
                  </label>
                </>
              )}
            </>
          )}
          <label className="work-field work-field--wide">
            <span className="work-field-label">Note (optional)</span>
            <input className="work-input" value={draft.note} maxLength={LIMITS.dateNote} onChange={(event) => setDraft({ note: event.target.value })} />
          </label>
          {error && <p className="work-field-error work-field--wide" id={`${id}-error`} role="alert">{error}</p>}
          <span className="work-date-form-actions">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
            <Button size="sm" variant="primary" busy={busy} busyLabel="Saving" onClick={saveDraft}>Save date</Button>
          </span>
        </fieldset>
      ) : (
        <Button size="sm" variant="ghost" disabled={disabled || dates.length >= LIMITS.dates} onClick={() => { setError(null); setEditing({ index: null, draft: toDraft(null, today, settings) }); }}>
          + Add a date
        </Button>
      )}
    </div>
  );
}
