import { forwardRef, useId, useState, type FormEvent } from 'react';
import { Button, StatusChip } from '@hq/ui';
import { reportWrite } from '../board';
import { DRAFT_LABEL, DRAFT_SCOPE_NOTE, suggestDate } from '../capture';
import { DATE_KIND_LABEL, DEFAULT_SETTINGS, formatValue, LIMITS, plannerToday, type NewItemFields, type WorkState } from '../core';
import { useWorkUi, type WorkSession } from './session';

/** The toolbar capture's promise, shown under it: one planning record, nothing started. */
export const TOOLBAR_CAPTURE_NOTE = 'Adds a title to the top of Inbox. Saves a planning record only; nothing starts.';

export interface ToolbarCaptureProps {
  session: WorkSession;
  state: WorkState;
  now?: () => Date;
  /** Opens the full capture dialog, for a status or a typed date. */
  onMore(): void;
}

/**
 * Quick capture from the Work toolbar (RV-2): a title into Inbox, no date invented. The text lives in the Work session,
 * so a domain switch keeps it unsaved and untouched; it is sent only by Enter or Capture. While the Planner is
 * unreachable the user may explicitly keep it as an HQ draft instead (RW-10).
 */
export const ToolbarCapture = forwardRef<HTMLInputElement, ToolbarCaptureProps>(function ToolbarCapture({ session, state, now, onMore }, ref) {
  const id = useId();
  const { capture } = useWorkUi(session.ui);
  const [busy, setBusy] = useState(false);
  const { ui, store, feedback, drafts } = session;
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const offline = state.save.kind === 'offline' || (state.load === 'unavailable' && !state.confirmed);
  const suggestion = capture.date ? null : suggestDate(capture.text, today);
  const title = capture.text.trim();

  const fields = (): NewItemFields => ({ title: capture.text, status: 'inbox', ...(capture.date ? { dates: [capture.date] } : {}) });

  const keepAsDraft = () => {
    if (!title) { ui.setCapture({ error: 'A title is required.' }); return; }
    drafts.add(fields());
    feedback.push({ message: `Kept “${title}” as an HQ draft`, meta: `${DRAFT_LABEL} · send it with Send drafts`, tone: 'info' });
    ui.setCapture({ text: '', date: null, unavailable: false, error: null });
  };

  const save = async () => {
    if (busy) return;
    if (!title) { ui.setCapture({ error: 'A title is required.' }); return; }
    if (offline) { ui.setCapture({ unavailable: true }); return; }
    setBusy(true);
    try {
      const sent = capture.text;
      const outcome = await store.create(fields());
      if (outcome.status === 'failed' && outcome.error.kind === 'unavailable') { ui.setCapture({ unavailable: true }); return; }
      if (outcome.status === 'failed' && outcome.error.kind === 'invalid') {
        ui.setCapture({ error: outcome.error.errors.map((e) => e.message).join(' ') });
        return;
      }
      reportWrite(feedback, outcome, `Captured “${sent.trim()}” to Inbox`);
      // Text typed while the create was in flight stays; only what was sent is cleared.
      ui.setCapture(ui.getState().capture.text === sent ? { text: '', date: null, unavailable: false, error: null } : { unavailable: false, error: null });
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (capture.unavailable) keepAsDraft();
    else void save();
  };

  return (
    <form className="wd-capture" onSubmit={onSubmit} aria-label="Quick capture" aria-describedby={`${id}-note`}>
      <div className="wd-capture-row">
        <label className="hq-sr-only" htmlFor={`${id}-title`}>Capture to Inbox</label>
        <input
          ref={ref}
          id={`${id}-title`}
          className="work-input wd-capture-input"
          value={capture.text}
          maxLength={LIMITS.title}
          autoComplete="off"
          placeholder="Capture to Inbox…"
          aria-invalid={capture.error ? true : undefined}
          aria-describedby={capture.error ? `${id}-error` : undefined}
          onChange={(event) => ui.setCapture({ text: event.target.value.replace(/[\r\n]+/gu, ' '), error: null })}
        />
        {capture.unavailable
          ? <Button variant="primary" type="submit">Keep as HQ draft</Button>
          : <Button variant="primary" type="submit" busy={busy} busyLabel="Saving">Capture</Button>}
        <Button variant="ghost" onClick={onMore}>Status or date…</Button>
      </div>
      {capture.error && <p className="work-field-error" id={`${id}-error`} role="alert">{capture.error}</p>}
      {suggestion && (
        <p className="wd-capture-hint" role="status">
          <span>‘{suggestion.word}’ looks like a date. Add {suggestion.label}? The title stays as typed.</span>
          <Button size="sm" onClick={() => ui.setCapture({ date: suggestion.date })}>Add date</Button>
        </p>
      )}
      {capture.date && (
        <p className="wd-capture-hint">
          <span>{DATE_KIND_LABEL[capture.date.kind]} · {formatValue({ kind: capture.date.kind, precision: capture.date.precision, value: capture.date.value }, today)}</span>
          <Button size="sm" variant="ghost" onClick={() => ui.setCapture({ date: null })}>Remove date</Button>
        </p>
      )}
      {capture.unavailable && (
        <div className="work-banner work-banner--offline" role="alert">
          <StatusChip tone="unavailable" label="Planner unreachable" detail="nothing was saved" />
          <span>You can keep this capture as an HQ draft. {DRAFT_SCOPE_NOTE}</span>
        </div>
      )}
      <p className="hq-meta wd-capture-note" id={`${id}-note`}>{TOOLBAR_CAPTURE_NOTE}</p>
    </form>
  );
});
