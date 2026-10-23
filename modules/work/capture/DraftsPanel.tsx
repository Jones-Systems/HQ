import { useEffect, type RefObject } from 'react';
import { Button, StatusChip } from '@hq/ui';
import type { WorkStore } from '../core';
import { isTyping } from '../board/actions';
import type { Feedback } from '../board/feedback';
import { DRAFT_LABEL, DRAFT_SCOPE_NOTE, useDrafts, type DraftStore } from './drafts';
import '../board/board.css';
import './capture.css';

/** HQ drafts awaiting an explicit Send drafts. Nothing here sends on its own, including on reconnect (RW-10). */
export function DraftsPanel({ drafts, store, feedback }: { drafts: DraftStore; store: WorkStore; feedback: Feedback }) {
  const { drafts: list, sending } = useDrafts(drafts);
  if (list.length === 0) return null;
  const send = async () => {
    const summary = await drafts.sendAll(store);
    const parts = [
      summary.sent && `${summary.sent} sent`,
      summary.unconfirmed && `${summary.unconfirmed} unconfirmed`,
      summary.kept && `${summary.kept} still drafts`,
    ].filter(Boolean);
    feedback.push({
      message: summary.stopped ? `The Planner is unavailable. ${parts.join(', ')}.` : `Drafts: ${parts.join(', ')}.`,
      tone: summary.stopped || summary.kept ? 'warning' : 'info',
    });
  };
  return (
    <section className="work-drafts work-ui" aria-label="HQ drafts">
      <header className="work-drafts-head">
        <StatusChip tone="warning" label={`${list.length} HQ ${list.length === 1 ? 'draft' : 'drafts'}`} detail="not in the Planner" />
        <span className="hq-meta">{DRAFT_SCOPE_NOTE}</span>
        <Button size="sm" variant="primary" busy={sending} busyLabel="Sending" onClick={() => void send()}>Send drafts</Button>
      </header>
      <ul className="work-drafts-list">
        {list.map((draft) => (
          <li key={draft.id} className="work-draft">
            <span className="work-draft-title">{draft.fields.title}</span>
            <span className="hq-meta">{DRAFT_LABEL}</span>
            {draft.error && <span className="work-field-error">{draft.error}</span>}
            <Button size="sm" variant="ghost" onClick={() => drafts.discard(draft.id)} disabled={sending}>Discard</Button>
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
