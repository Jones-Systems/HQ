import { forwardRef, useEffect, useId, useRef, type FormEvent } from 'react';
import { Button, StatusChip } from '@hq/ui';
import { reportWrite } from '../board';
import { DRAFT_LABEL, draftScopeNote, useDrafts, landCapture, suggestDate } from '../capture';
import { DATE_KIND_LABEL, DEFAULT_SETTINGS, formatValue, LIMITS, plannerToday, type NewItemFields, type WorkState } from '../core';
import { PlusIcon } from './icons';
import { useWorkUi, type WorkSession } from './session';

/** The toolbar capture's promise: one planning record into Inbox, nothing started. It is the field's description. */
export const TOOLBAR_CAPTURE_NOTE = 'Adds a title to the top of Inbox. Saves a planning record only; nothing starts.';

export interface ToolbarCaptureProps {
  session: WorkSession;
  state: WorkState;
  now?: () => Date;
  /** Opens the full capture dialog, for a status or a typed date. */
  onMore(): void;
}

/**
 * Quick capture from the Work top bar (RV-2, C-2): one compact field with an `N` hint that widens on focus, a title into
 * Inbox, no date invented. The text lives in the Work session, so a domain switch keeps it unsaved and untouched; it is
 * sent only by Enter or Capture. A saved capture flies to where it landed (C-1). While the Planner is unreachable the
 * user may explicitly keep it as an HQ draft instead (RW-10); that offer leaves as soon as the Planner answers again.
 */
export const ToolbarCapture = forwardRef<HTMLInputElement, ToolbarCaptureProps>(function ToolbarCapture({ session, state, now, onMore }, ref) {
  const id = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const { capture } = useWorkUi(session.ui);
  const { ui, store, feedback, drafts } = session;
  const draftState = useDrafts(drafts);
  const draftBlocked = draftState.durability === 'loading' || draftState.durability === 'blocked';
  const busy = capture.sending;
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const offline = state.save.kind === 'offline' || (state.load === 'unavailable' && !state.confirmed);
  const suggestion = capture.date ? null : suggestDate(capture.text, today);
  const title = capture.text.trim();

  // F7-X15: "Planner unreachable · nothing was saved" describes the last attempt. Once the Planner answers again it is
  // no longer true, so it leaves at once instead of waiting for the next submit or edit.
  useEffect(() => {
    if (capture.unavailable && !offline) ui.setCapture({ unavailable: false });
  }, [capture.unavailable, offline, ui]);

  const fields = (): NewItemFields => ({ title: capture.text, status: 'inbox', ...(capture.date ? { dates: [capture.date] } : {}) });

  const keepAsDraft = () => {
    if (ui.getState().capture.sending) return;
    if (!title) { ui.setCapture({ error: 'A title is required.' }); return; }
    try { drafts.add(fields()); }
    catch (cause) {
      ui.setCapture({ error: cause instanceof Error ? cause.message : 'Could not keep this draft. Keep your text open.' });
      return;
    }
    feedback.push({ message: `Kept “${title}” as an HQ draft`, meta: `${DRAFT_LABEL} · ${draftScopeNote(drafts.getState())}`, tone: 'info' });
    ui.setCapture({ text: '', date: null, unavailable: false, error: null });
  };

  const save = async () => {
    if (ui.getState().capture.sending) return;
    if (!title) { ui.setCapture({ error: 'A title is required.' }); return; }
    if (offline) { ui.setCapture({ unavailable: true }); return; }
    ui.setCapture({ sending: true });
    try {
      const sent = capture.text;
      // The flight starts where the field was when it was sent.
      const from = fieldRef.current?.getBoundingClientRect() ?? null;
      const outcome = await store.create(fields());
      if (outcome.status === 'failed' && outcome.error.kind === 'unavailable') { ui.setCapture({ unavailable: true }); return; }
      if (outcome.status === 'failed' && outcome.error.kind === 'invalid') {
        ui.setCapture({ error: outcome.error.errors.map((e) => e.message).join(' ') });
        return;
      }
      reportWrite(feedback, outcome, `Captured “${sent.trim()}” to Inbox`);
      if (outcome.status === 'failed') return;
      if (outcome.status === 'saved') landCapture(from, sent.trim());
      // Text typed while the create was in flight stays; only what was sent is cleared.
      ui.setCapture(ui.getState().capture.text === sent ? { text: '', date: null, unavailable: false, error: null } : { unavailable: false, error: null });
    } finally {
      ui.setCapture({ sending: false });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (capture.unavailable) keepAsDraft();
    else void save();
  };

  const alert = Boolean(capture.error || suggestion || capture.date || capture.unavailable);

  return (
    <form className="wd-capture" onSubmit={onSubmit} aria-label="Quick capture" aria-describedby={`${id}-note`} data-alert={alert ? 'true' : undefined}>
      <div className="wd-capture-field" ref={fieldRef}>
        <PlusIcon />
        <label className="hq-sr-only" htmlFor={`${id}-title`}>Capture to Inbox</label>
        <input
          ref={ref}
          id={`${id}-title`}
          className="wd-capture-input"
          value={capture.text}
          maxLength={LIMITS.title}
          autoComplete="off"
          placeholder="Capture to Inbox…"
          aria-invalid={capture.error ? true : undefined}
          aria-describedby={capture.error ? `${id}-error ${id}-note` : `${id}-note`}
          // An edit drops a stale unreachable flag once the Planner no longer reads as offline.
          onChange={(event) => ui.setCapture({ text: event.target.value.replace(/[\r\n]+/gu, ' '), error: null, unavailable: capture.unavailable && offline })}
        />
        {!title && <kbd className="wk-kbd wd-capture-n" aria-hidden="true" title="Press N for the full capture">N</kbd>}
        {title && !capture.unavailable && (
          <Button size="sm" variant="primary" type="submit" busy={busy} busyLabel="Saving" className="wd-capture-go">Capture</Button>
        )}
        <Button size="sm" variant="ghost" className="wd-capture-more" onClick={onMore} title="Choose a status or a date (N)">Status or date…</Button>
      </div>
      <div className="wd-capture-pop">
        {capture.error && <p className="work-field-error" id={`${id}-error`} role="alert">{capture.error}</p>}
        {suggestion && (
          <p className="wd-capture-line" role="status">
            <span>‘{suggestion.word}’ looks like a date. Add {suggestion.label}? The title stays as typed.</span>
            <Button size="sm" onClick={() => ui.setCapture({ date: suggestion.date })}>Add date</Button>
          </p>
        )}
        {capture.date && (
          <p className="wd-capture-line">
            <span>{DATE_KIND_LABEL[capture.date.kind]} · {formatValue({ kind: capture.date.kind, precision: capture.date.precision, value: capture.date.value }, today)}</span>
            <Button size="sm" variant="ghost" onClick={() => ui.setCapture({ date: null })}>Remove date</Button>
          </p>
        )}
        {capture.unavailable && (
          <div className="work-banner work-banner--offline" role="alert">
            <StatusChip tone="unavailable" label="Planner unreachable" detail="nothing was saved" />
            <span id={`${id}-draft-reason`}>You can keep this capture as an HQ draft. {draftScopeNote(draftState)}</span>
            <Button size="sm" variant="primary" type="submit" aria-disabled={draftBlocked || capture.sending} aria-describedby={`${id}-draft-reason`}>Keep as HQ draft</Button>
          </div>
        )}
        <p className="hq-meta wd-capture-note" id={`${id}-note`}>{TOOLBAR_CAPTURE_NOTE}</p>
      </div>
    </form>
  );
});
