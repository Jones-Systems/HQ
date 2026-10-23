import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Dialog, StatusChip } from '@hq/ui';
import {
  DATE_KIND_LABEL, DATE_KINDS, DEFAULT_SETTINGS, LIMITS, plannerToday, STATUS_LABEL, STATUSES,
  type DateInput, type DateKind, type NewItemFields, type Status, type WorkState, type WorkStore,
} from '../core';
import { reportWrite } from '../board/actions';
import type { Feedback } from '../board/feedback';
import { DRAFT_LABEL, DRAFT_SCOPE_NOTE, type DraftStore } from './drafts';
import { suggestDate } from './suggest';
import '../board/board.css';
import './capture.css';

/** Shown in the capture footer: capturing writes one planning record and starts nothing. */
export const CAPTURE_FOOTER = 'Saves a planning record only. Nothing starts.';

export interface QuickCaptureProps {
  open: boolean;
  onClose(): void;
  store: WorkStore;
  state: WorkState;
  feedback: Feedback;
  drafts: DraftStore;
  /** Inbox from the toolbar and the N shortcut; a column's own status from its Add a card. */
  initialStatus?: Status;
  now?: () => Date;
}

/**
 * Quick capture (RV-2): a title-only capture into Inbox by default. No date is invented: a date-like word only
 * offers a Target, and the title is saved exactly as typed. Enter saves; Shift+Enter saves and keeps the dialog open.
 * While the Planner is unreachable the user may explicitly keep the capture as an HQ draft instead (RW-10).
 */
export function QuickCapture({ open, onClose, store, state, feedback, drafts, initialStatus = 'inbox', now }: QuickCaptureProps) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Status>(initialStatus);
  const [date, setDate] = useState<DateInput | null>(null);
  const [dateKind, setDateKind] = useState<DateKind>('target');
  const [dateValue, setDateValue] = useState('');
  const [addingDate, setAddingDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setStatus(initialStatus); setDate(null); setAddingDate(false); setDateValue('');
    setError(null); setUnavailable(false);
  }, [open, initialStatus]);

  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const offline = state.save.kind === 'offline' || (state.load === 'unavailable' && !state.confirmed);
  const suggestion = date ? null : suggestDate(title, today);

  const fields = (): NewItemFields => ({ title, status, ...(date ? { dates: [date] } : {}) });

  const reset = (keepOpen: boolean) => {
    setTitle(''); setDate(null); setAddingDate(false); setDateValue(''); setError(null); setUnavailable(false);
    if (keepOpen) titleRef.current?.focus();
    else onClose();
  };

  const keepAsDraft = (keepOpen: boolean) => {
    if (!title.trim()) { setError('A title is required.'); return; }
    drafts.add(fields());
    feedback.push({ message: `Kept “${title.trim()}” as an HQ draft`, meta: `${DRAFT_LABEL} · send it with Send drafts`, tone: 'info' });
    reset(keepOpen);
  };

  const save = async (keepOpen: boolean) => {
    if (busy) return;
    if (!title.trim()) { setError('A title is required.'); return; }
    if (offline) { setUnavailable(true); return; }
    setBusy(true);
    try {
      const outcome = await store.create(fields());
      if (outcome.status === 'failed' && outcome.error.kind === 'unavailable') {
        setUnavailable(true);
        return;
      }
      if (outcome.status === 'failed' && outcome.error.kind === 'invalid') {
        setError(outcome.error.errors.map((e) => e.message).join(' '));
        return;
      }
      reportWrite(feedback, outcome, `Captured “${title.trim()}” to ${STATUS_LABEL[status]}`);
      reset(keepOpen);
    } finally {
      setBusy(false);
    }
  };

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void (unavailable ? keepAsDraft(event.shiftKey) : save(event.shiftKey));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void (unavailable ? keepAsDraft(false) : save(false));
  };

  const applyDate = () => {
    if (!dateValue) return;
    setDate({ kind: dateKind, precision: 'day', value: dateValue });
    setAddingDate(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Capture"
      description={`Adds to the top of ${STATUS_LABEL[status]}. Only a title is needed.`}
      initialFocusRef={titleRef}
      className="work-ui work-capture"
    >
      <form className="work-capture-form" onSubmit={onSubmit} aria-describedby={`${id}-footer`}>
        <label className="work-field" htmlFor={`${id}-title`}>
          <span className="work-field-label">Title</span>
          <input
            ref={titleRef}
            id={`${id}-title`}
            className="work-input"
            value={title}
            maxLength={LIMITS.title}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { setTitle(event.target.value.replace(/[\r\n]+/gu, ' ')); setError(null); }}
            onKeyDown={onTitleKey}
          />
        </label>
        {error && <p className="work-field-error" id={`${id}-error`} role="alert">{error}</p>}

        {suggestion && (
          <div className="work-suggestion" role="status">
            <span>‘{suggestion.word}’ looks like a date. Add {suggestion.label}? The title stays as typed.</span>
            <Button size="sm" onClick={() => setDate(suggestion.date)}>Add date</Button>
          </div>
        )}

        <div className="work-capture-row">
          <label className="work-field" htmlFor={`${id}-status`}>
            <span className="work-field-label">Status</span>
            <select id={`${id}-status`} className="work-input" value={status} onChange={(event) => setStatus(event.target.value as Status)}>
              {STATUSES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <div className="work-field">
            <span className="work-field-label">Date</span>
            {date ? (
              <span className="work-capture-date">
                <span>{DATE_KIND_LABEL[date.kind]} · {date.value}</span>
                <Button size="sm" variant="ghost" onClick={() => setDate(null)}>Remove date</Button>
              </span>
            ) : addingDate ? (
              <span className="work-capture-date">
                <select aria-label="Date kind" className="work-input" value={dateKind} onChange={(event) => setDateKind(event.target.value as DateKind)}>
                  {DATE_KINDS.map((kind) => <option key={kind} value={kind}>{DATE_KIND_LABEL[kind]}</option>)}
                </select>
                <input aria-label="Day" type="date" className="work-input" value={dateValue} onChange={(event) => setDateValue(event.target.value)} />
                <Button size="sm" onClick={applyDate} disabled={!dateValue}>Add</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setAddingDate(true)}>Add a date (optional)</Button>
            )}
          </div>
        </div>

        {unavailable && (
          <div className="work-banner work-banner--offline" role="alert">
            <StatusChip tone="unavailable" label="Planner unreachable" detail="nothing was saved" />
            <span>You can keep this capture as an HQ draft. {DRAFT_SCOPE_NOTE}</span>
          </div>
        )}

        <footer className="work-capture-foot">
          <span className="hq-meta" id={`${id}-footer`}>{CAPTURE_FOOTER}{!unavailable && ' Shift+Enter saves and adds another.'}</span>
          <span className="work-capture-actions">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {unavailable
              ? <Button variant="primary" type="submit">Keep as HQ draft</Button>
              : <Button variant="primary" type="submit" busy={busy} busyLabel="Saving">Save</Button>}
          </span>
        </footer>
      </form>
    </Dialog>
  );
}
