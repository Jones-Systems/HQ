import { useEffect, useId, type RefObject } from 'react';
import { Button, StatusChip } from '@hq/ui';
import type { WorkStore } from '../core';
import { isTyping } from '../board/actions';
import type { Feedback } from '../board/feedback';
import { DRAFT_LABEL, draftScopeNote, HANDOFF_NOTE, useDrafts, type DraftStore } from './drafts';
import '../theme';
import '../board/feedback.css';
import './capture.css';

/** HQ drafts awaiting an explicit Send drafts. Nothing here sends on its own, including on reconnect (RW-10). */
export function DraftsPanel({ drafts, store, feedback }: { drafts: DraftStore; store: WorkStore; feedback: Feedback }) {
  const draftState = useDrafts(drafts);
  const { drafts: list, sending, durability } = draftState;
  const reasonId = useId();
  const reason = sending ? 'Wait for the current send to finish.'
    : durability === 'loading' || durability === 'blocked' ? draftScopeNote(draftState)
      : list.length === 0 ? 'Keep an HQ draft first.'
        : list.every((draft) => draft.handoff) ? HANDOFF_NOTE : null;
  if (list.length === 0 && (durability === 'off' || durability === 'saved')) return null;
  const send = async () => {
    if (reason) return;
    let summary;
    try { summary = await drafts.sendAll(store); }
    catch (cause) { feedback.push({ message: cause instanceof Error ? cause.message : 'Drafts could not be sent; keep HQ open.', tone: 'warning' }); return; }
    const parts = [
      summary.sent && `${summary.sent} sent`,
      summary.unconfirmed && `${summary.unconfirmed} unconfirmed`,
      summary.kept && `${summary.kept} still drafts`,
    ].filter(Boolean);
    feedback.push({
      message: summary.stopped ? `${summary.reason ?? 'The Planner is unavailable'}. ${parts.join(', ')}.` : `Drafts: ${parts.join(', ')}.`,
      tone: summary.stopped || summary.kept ? 'warning' : 'info',
    });
  };
  return (
    <section className="work-drafts work-ui" aria-label="HQ drafts">
      <header className="work-drafts-head">
        <StatusChip tone="warning" label={`${list.length} HQ ${list.length === 1 ? 'draft' : 'drafts'}`} detail="not in the Planner" />
        <span className="hq-meta">{draftScopeNote(draftState)}</span>
        <Button size="sm" variant="primary" busy={sending} busyLabel="Sending" aria-disabled={!!reason} aria-describedby={reason ? reasonId : undefined} title={reason ?? undefined} onClick={() => void send()}>Send drafts</Button>
      </header>
      {reason && <p className="hq-meta" id={reasonId}>{reason}</p>}
      <ul className="work-drafts-list">
        {list.map((draft) => (
          <li key={draft.id} className="work-draft">
            <span className="work-draft-title">{draft.fields.title}</span>
            <span className="hq-meta">{DRAFT_LABEL}</span>
            {draft.handoff && <span className="work-field-error">{HANDOFF_NOTE}</span>}
            {draft.error && <span className="work-field-error">{draft.error}</span>}
            <Button size="sm" variant="ghost" onClick={() => { if (!sending && durability !== 'blocked' && durability !== 'loading') drafts.discard(draft.id); }} aria-disabled={sending || durability === 'blocked'} aria-describedby={reason ? reasonId : undefined}>Discard</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * N opens quick capture, but only while focus is inside the Work surface `root` and not in a text field, so the key
 * never fires from another domain (RV-2).
 */
export function useCaptureShortcut(root: RefObject<HTMLElement | null>, open: () => void): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      open();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [root, open]);
}
