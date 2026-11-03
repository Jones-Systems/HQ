import { FieldError, StatusIndicator, fieldErrorProps, useToast } from '@hq/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { AttachmentId, ClarificationId, Destination, RequestDraft } from '../src/contract.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { GuardedButton } from './GuardedButton.tsx';
import { formatBytes, holdReason, saveLabel, saveTone } from './model.ts';

/** A destination the owner may pick for this request, such as the labelled simulated one in the example. */
export interface DestinationOffer {
  readonly destination: Extract<Destination, { readonly kind: 'existing-thread' }>;
  /** The button text, for example "Choose simulated destination". */
  readonly buttonLabel: string;
  /** What choosing it means, shown beside the choice. */
  readonly note?: string;
}

export interface DraftEditorProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  readonly draft: RequestDraft;
  readonly newId: (kind: 'clarification' | 'attachment') => string;
  readonly destinationOffer?: DestinationOffer | null;
  /** A readable name for a source version; absent or null falls back to the stored view and version. */
  readonly sourceLabel?: (versionId: string) => string | null;
  /** Shown after a freeze so the owner can move on. Opening Runs sends nothing. */
  readonly onOpenRuns?: () => void;
  /** Put the cursor in the title when the editor first appears, for a request that was just created. */
  readonly focusTitle?: boolean;
}

export function DraftEditor({ session, state, draft, newId, destinationOffer = null, sourceLabel, onOpenRuns, focusTitle = false }: DraftEditorProps) {
  const toast = useToast();
  const disabled = !session.editable;
  const hold = holdReason(state);
  const blockersId = useId();
  const titleId = useId();
  const intentId = useId();
  const titleErrorId = `${titleId}-error`;
  const intentErrorId = `${intentId}-error`;
  const titleRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState('');
  const [touched, setTouched] = useState({ title: false, intent: false });
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [focusTitle]);

  const titleError = touched.title && draft.title.trim() === '' ? 'Add a title.' : undefined;
  const intentError = touched.intent && draft.intent.trim() === '' ? 'Describe what should change.' : undefined;
  const freezeReason = hold ?? (state.blockers.length > 0 ? state.blockers.join(' ') : null);

  const freeze = async () => {
    if (freezeReason) return;
    const packet = await session.freeze();
    if (packet) {
      toast.success(`Request frozen as packet #${packet.lineage.sequence}`, {
        description: `“${packet.title}” is recorded on this device. Nothing was sent.`,
        ...(onOpenRuns ? { action: { label: 'Open Runs', onAction: onOpenRuns } } : {}),
      });
      return;
    }
    const after = session.state;
    if (after.unknown) {
      toast.unknown('Freeze result unknown', {
        description: `${after.error ?? 'The result was not confirmed.'} Nothing was sent. Reconcile to read what was saved.`,
        action: { label: 'Reconcile', onAction: () => { void session.reconcile(); } },
      });
    } else if (after.error) {
      toast.error("Couldn't freeze the request", { description: `${after.error} Your draft is kept on this device and nothing was sent.` });
    }
  };

  const destination = draft.destination;
  const offered = destinationOffer && destination.kind === 'existing-thread' && destination.destinationId === destinationOffer.destination.destinationId;

  return <section className="hqr-panel" aria-labelledby="hqr-draft-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-draft-title">{draft.origin === 'initial' ? 'Draft request' : draft.origin === 'revision' ? 'Revision draft' : 'Continuation draft'}</h2>
      <p className="hqr-privacy" data-privacy={draft.privacy}>
        <span className="hqr-badge">Private draft</span> Not sent · stays on this device ·{' '}
        <StatusIndicator tone={saveTone(state)} busy={state.save === 'saving'} label={saveLabel(state)} />
      </p>
    </header>

    <div className="hqr-field">
      <label htmlFor={titleId}>Title</label>
      <input id={titleId} ref={titleRef} value={draft.title} disabled={disabled} maxLength={300}
        {...fieldErrorProps(titleErrorId, titleError)}
        onBlur={() => setTouched((previous) => ({ ...previous, title: true }))}
        onChange={(event) => session.edit({ type: 'set-title', title: event.target.value })} />
      <FieldError id={titleErrorId}>{titleError}</FieldError>
    </div>
    <div className="hqr-field">
      <label htmlFor={intentId}>What should change</label>
      <textarea id={intentId} value={draft.intent} disabled={disabled} rows={5}
        {...fieldErrorProps(intentErrorId, intentError)}
        onBlur={() => setTouched((previous) => ({ ...previous, intent: true }))}
        onChange={(event) => session.edit({ type: 'set-intent', intent: event.target.value })} />
      <FieldError id={intentErrorId}>{intentError}</FieldError>
    </div>

    <h3>Sources</h3>
    {draft.sources.length === 0 ? <p className="hqr-empty">No source versions yet. Add them from the canvas or compare view.</p>
      : <ul className="hqr-list">{draft.sources.map((source) => {
        const name = sourceLabel?.(source.versionId) ?? null;
        return <li key={source.versionId}>
          {name ? <span>{name}</span> : <><span>{source.viewId}</span> <code>{source.versionId}</code></>}
          {' '}<span className="hqr-muted">revision {source.sourceRevision}</span>
        </li>;
      })}</ul>}

    <h3>Annotations</h3>
    {draft.annotations.length === 0 ? <p className="hqr-empty">No annotations attached.</p>
      : <ul className="hqr-list">{draft.annotations.map((item) => <li key={item.id}>
        <span className="hqr-letter" aria-label={`Reference ${item.letter}`}>{item.letter}</span>
        <span className="hqr-muted">{item.kind === 'cite' ? 'Cite' : item.kind === 'pick' ? 'Pick' : item.kind}</span> {item.note}
      </li>)}</ul>}

    <h3>Attachments</h3>
    <p className="hqr-hint">Images are included only when you tick them.</p>
    {draft.attachments.length > 0 && <ul className="hqr-list">{draft.attachments.map((item) => <li key={item.attachmentId}>
      <label className="hqr-check">
        <input type="checkbox" checked={item.selected} disabled={disabled}
          onChange={(event) => session.edit({ type: 'select-attachment', attachmentId: item.attachmentId as AttachmentId, selected: event.target.checked })} />
        {item.label} <span className="hqr-muted">{formatBytes(item.bytes)}</span>
        {!item.selected && <span className="hqr-badge hqr-badge-quiet">Not included</span>}
      </label>
    </li>)}</ul>}
    <label className="hqr-file">Add image…
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        const added = await session.addAttachment(new Uint8Array(await file.arrayBuffer()), { attachmentId: newId('attachment'), mediaType: file.type || 'image/png', label: file.name.slice(0, 300) || 'Image' });
        if (!added) toast.error("Couldn't add the image", { description: 'The image was not attached. Your draft is unchanged.' });
      }} />
    </label>

    <h3>Clarify</h3>
    {draft.clarifications.length === 0 && <p className="hqr-empty">No questions. Ask one if anything is ambiguous before freezing.</p>}
    <ul className="hqr-list">{draft.clarifications.map((item) =>
      <Clarification key={item.clarificationId} session={session} disabled={disabled} hold={hold} id={item.clarificationId as ClarificationId}
        question={item.question} answer={item.answer} dismissed={item.dismissed === true} />)}</ul>
    <form className="hqr-inline" onSubmit={(event) => {
      event.preventDefault();
      if (question.trim() && session.edit({ type: 'ask', clarificationId: newId('clarification') as ClarificationId, question: question.trim() })) setQuestion('');
    }}>
      <input aria-label="New clarifying question" placeholder="Ask a clarifying question" value={question} disabled={disabled}
        onChange={(event) => setQuestion(event.target.value)} />
      <GuardedButton type="submit" unavailable={hold ?? (question.trim() === '' ? 'Write a question first.' : null)}>Ask</GuardedButton>
    </form>

    <h3>Destination</h3>
    <div className="hqr-destination">
      {destination.kind === 'existing-thread'
        ? <p>{destination.label}</p>
        : <p className="hqr-muted">No destination chosen yet. Without one, Runs cannot send or simulate this request.</p>}
      {destinationOffer && (offered
        ? <GuardedButton variant="ghost" unavailable={hold}
          onClick={() => { session.edit({ type: 'set-destination', destination: { kind: 'unassigned' } }); }}>Clear destination</GuardedButton>
        : <GuardedButton unavailable={hold}
          onClick={() => { session.edit({ type: 'set-destination', destination: destinationOffer.destination }); }}>{destinationOffer.buttonLabel}</GuardedButton>)}
      {destinationOffer?.note && <p className="hqr-hint">{destinationOffer.note}</p>}
    </div>

    <footer className="hqr-freeze">
      <GuardedButton variant="primary" unavailable={freezeReason} reasonId={blockersId}
        busy={state.busy === 'freezing'} busyLabel="Freezing" onClick={() => { void freeze(); }}>Freeze request</GuardedButton>
      <div id={blockersId} className="hqr-freeze-notes">
        {freezeReason
          ? <ul className="hqr-blockers" aria-label="Why freezing is unavailable">{(hold ? [hold] : state.blockers).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          : <p className="hqr-hint">Freezing records an immutable packet. It does not send anything.</p>}
      </div>
    </footer>
  </section>;
}

function Clarification({ session, disabled, hold, id, question, answer, dismissed }: {
  readonly session: RequestSession; readonly disabled: boolean; readonly hold: string | null; readonly id: ClarificationId;
  readonly question: string; readonly answer: string | undefined; readonly dismissed: boolean;
}) {
  const [text, setText] = useState(answer ?? '');
  const resolved = answer !== undefined || dismissed;
  const saveReason = hold ?? (text.trim() === '' ? 'Write an answer first.' : text === answer ? 'The answer has not changed.' : null);
  return <li className="hqr-clarification" data-resolved={resolved}>
    <p className="hqr-question">{question}</p>
    {dismissed && answer === undefined ? <p className="hqr-muted">Dismissed</p> : <>
      <textarea aria-label={`Answer: ${question}`} rows={2} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} />
      <div className="hqr-inline">
        <GuardedButton unavailable={saveReason}
          onClick={() => session.edit({ type: 'answer', clarificationId: id, answer: text })}>{answer === undefined ? 'Save answer' : 'Update answer'}</GuardedButton>
        {!resolved && <GuardedButton unavailable={hold} onClick={() => session.edit({ type: 'dismiss', clarificationId: id })}>Dismiss</GuardedButton>}
      </div>
    </>}
  </li>;
}

