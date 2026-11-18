import { Button } from '@hq/ui';
import { useId, useState } from 'react';
import type { AttachmentId, ClarificationId, RequestDraft } from '../src/contract.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { formatBytes, saveLabel } from './model.ts';

export interface DraftEditorProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  readonly draft: RequestDraft;
  readonly newId: (kind: 'clarification' | 'attachment') => string;
}

export function DraftEditor({ session, state, draft, newId }: DraftEditorProps) {
  const disabled = !session.editable;
  const blockersId = useId();
  const [question, setQuestion] = useState('');

  return <section className="hqr-panel" aria-labelledby="hqr-draft-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-draft-title">{draft.origin === 'initial' ? 'Draft request' : draft.origin === 'revision' ? 'Revision draft' : 'Continuation draft'}</h2>
      <p className="hqr-privacy" data-privacy={draft.privacy}>
        <span className="hqr-badge">Private draft</span> Not sent · stays on this device ·{' '}
        <span role="status" aria-live="polite">{saveLabel(state)}</span>
      </p>
    </header>

    <label className="hqr-field">Title
      <input value={draft.title} disabled={disabled} maxLength={300}
        onChange={(event) => session.edit({ type: 'set-title', title: event.target.value })} />
    </label>
    <label className="hqr-field">What should change
      <textarea value={draft.intent} disabled={disabled} rows={5}
        onChange={(event) => session.edit({ type: 'set-intent', intent: event.target.value })} />
    </label>

    <h3>Sources</h3>
    {draft.sources.length === 0 ? <p className="hqr-empty">No source versions yet. Add them from the canvas or compare view.</p>
      : <ul className="hqr-list">{draft.sources.map((source) => <li key={source.versionId}>
        <span>{source.viewId}</span> <code>{source.versionId}</code> <span className="hqr-muted">revision {source.sourceRevision}</span>
      </li>)}</ul>}

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
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await session.addAttachment(new Uint8Array(await file.arrayBuffer()), { attachmentId: newId('attachment'), mediaType: file.type || 'image/png', label: file.name.slice(0, 300) || 'Image' });
      }} />
    </label>

    <h3>Clarify</h3>
    {draft.clarifications.length === 0 && <p className="hqr-empty">No questions. Ask one if anything is ambiguous before freezing.</p>}
    <ul className="hqr-list">{draft.clarifications.map((item) =>
      <Clarification key={item.clarificationId} session={session} disabled={disabled} id={item.clarificationId as ClarificationId}
        question={item.question} answer={item.answer} dismissed={item.dismissed === true} />)}</ul>
    <form className="hqr-inline" onSubmit={(event) => {
      event.preventDefault();
      if (question.trim() && session.edit({ type: 'ask', clarificationId: newId('clarification') as ClarificationId, question: question.trim() })) setQuestion('');
    }}>
      <input aria-label="New clarifying question" placeholder="Ask a clarifying question" value={question} disabled={disabled}
        onChange={(event) => setQuestion(event.target.value)} />
      <Button type="submit" disabled={disabled || question.trim() === ''}>Ask</Button>
    </form>

    <footer className="hqr-freeze">
      <Button type="button" variant="primary" disabled={disabled || state.blockers.length > 0}
        aria-describedby={blockersId} onClick={() => { void session.freeze(); }}>
        {state.busy === 'freezing' ? 'Freezing…' : 'Freeze request'}
      </Button>
      <div id={blockersId}>
        {state.blockers.length > 0
          ? <ul className="hqr-blockers">{state.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          : <p className="hqr-hint">Freezing records an immutable packet. It does not send anything.</p>}
      </div>
    </footer>
  </section>;
}

function Clarification({ session, disabled, id, question, answer, dismissed }: {
  readonly session: RequestSession; readonly disabled: boolean; readonly id: ClarificationId;
  readonly question: string; readonly answer: string | undefined; readonly dismissed: boolean;
}) {
  const [text, setText] = useState(answer ?? '');
  const resolved = answer !== undefined || dismissed;
  return <li className="hqr-clarification" data-resolved={resolved}>
    <p className="hqr-question">{question}</p>
    {dismissed && answer === undefined ? <p className="hqr-muted">Dismissed</p> : <>
      <textarea aria-label={`Answer: ${question}`} rows={2} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} />
      <div className="hqr-inline">
        <Button type="button" disabled={disabled || text.trim() === '' || text === answer}
          onClick={() => session.edit({ type: 'answer', clarificationId: id, answer: text })}>{answer === undefined ? 'Save answer' : 'Update answer'}</Button>
        {!resolved && <Button type="button" disabled={disabled} onClick={() => session.edit({ type: 'dismiss', clarificationId: id })}>Dismiss</Button>}
      </div>
    </>}
  </li>;
}
