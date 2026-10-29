import { useState } from 'react';
import { Button, SaveIndicator, StatusChip } from '@hq/ui';
import { CHANNELS, workspaceSnapshot, type Channel, type RunRecord } from '../core';
import { errorText, reconcileUnknownSave, saveStateOf, type Reconciliation } from '../content/actions';
import { canSaveCitation, draftFromResult, runCitation } from './citation';
import { useWorkbench } from './env';
import { SelectField, TextField } from './fields';
import { shortId } from './format';
import type { ResultSummary } from './results';

const START_DRAFT_PREFIX = 'workbench-run:';

export function startDraftKey(runId: string): string {
  return `${START_DRAFT_PREFIX}${runId}`;
}

/** The run whose receipt holds a Start draft editor, or null for any other editor key. */
export function startDraftRunId(key: string): string | null {
  return key.startsWith(START_DRAFT_PREFIX) ? key.slice(START_DRAFT_PREFIX.length) : null;
}

/**
 * Start draft from a result (RR-6). The draft is unsaved until Save to library, a content-class save. The
 * run citation is saved with it only under `hq-references-v1`; otherwise it stays visible as not saved.
 */
export function StartDraft({ run, toolName, summary }: { readonly run: RunRecord; readonly toolName: string; readonly summary: ResultSummary }) {
  const { port, session, state, context, navigate } = useWorkbench();
  const snapshot = workspaceSnapshot(state.workspace);
  const features = snapshot?.features ?? [];
  const key = startDraftKey(run.id);
  const editor = state.editors[key];
  const citation = runCitation(run, toolName, context.id);
  const savesCitation = canSaveCitation(features);
  const [check, setCheck] = useState<Reconciliation | null>(null);

  if (!editor) {
    return (
      <div className="sw-start">
        <Button variant="secondary" onClick={() => session.openEditor(key, null, draftFromResult(run, toolName, summary, citation, features))}>Start draft</Button>
        <p className="sw-hint">Opens an unsaved draft with a citation of this run. Nothing is saved until you choose Save to library.</p>
      </div>
    );
  }

  const saved = editor.base;
  const saveState = saveStateOf(editor);
  // A save whose result is unknown is never repeated until a check shows it did not happen (RS-3).
  const unchecked = editor.status === 'error' && editor.error?.kind === 'unknown' && check?.kind !== 'not-applied';
  const save = () => {
    if (unchecked) return;
    setCheck(null);
    void session.saveEditor(port, key);
  };
  const id = (field: string) => `sw-start-${run.id}-${field}`;
  const brands = snapshot?.brands ?? [];
  return (
    <section className="sw-start sw-start--open" aria-labelledby={id('title-heading')}>
      <div className="sw-panel-head">
        <h4 id={id('title-heading')}>{saved ? 'Draft in library' : 'Unsaved draft'}</h4>
        <SaveIndicator
          state={saveState}
          {...(saveState === 'failed' ? { onRetry: save } : {})}
          onCheck={async () => setCheck(await reconcileUnknownSave(session, port, key))}
        />
      </div>
      <TextField id={id('title')} label="Title" value={editor.fields.title} onChange={(title) => session.editDraft(key, { title })} />
      <TextField id={id('body')} label="Draft" multiline rows={8} value={editor.fields.body} onChange={(body) => session.editDraft(key, { body })} />
      <div className="sw-row-inline">
        <SelectField
          id={id('brand')} label="Brand" value={editor.fields.brand_id} onChange={(brand_id) => session.editDraft(key, { brand_id })}
          options={(brands.length ? brands : [{ id: editor.fields.brand_id, name: editor.fields.brand_id }]).map((brand) => ({ value: brand.id, label: brand.name }))}
        />
        <SelectField<Channel> id={id('channel')} label="Channel" value={editor.fields.channel} onChange={(channel) => session.editDraft(key, { channel })} options={CHANNELS.map((channel) => ({ value: channel, label: channel }))} />
      </div>
      <div className="sw-citation">
        <p className="sw-eyebrow">Citation</p>
        <p><b>{citation.title}</b></p>
        <p className="sw-hint">Run {shortId(run.id)} · {toolName} · data as of {citation.sourceRevision}</p>
        {!savesCitation
          ? <StatusChip className="sw-status-wrap" tone="warning" label="Not saved — needs Social service support" detail="this service can't store links yet (hq-references-v1)" />
          : !saved ? <StatusChip className="sw-status-wrap" tone="info" label="Will be saved with the draft" />
            : saved.links?.some((link) => link.kind === 'run' && link.entityId === run.id)
              ? <StatusChip className="sw-status-wrap" tone="success" label="Saved with the draft" detail={`version ${saved.version}`} />
              : <StatusChip className="sw-status-wrap" tone="unknown" label="Not confirmed" detail="the saved draft did not return this citation" />}
        <details>
          <summary>Citation details</summary>
          <pre className="sw-mono">{JSON.stringify(citation, null, 2)}</pre>
        </details>
      </div>
      {editor.error && 'message' in editor.error && <p className="sw-error" role="alert">{editor.error.message}</p>}
      {editor.error && !('message' in editor.error) && editor.error.kind !== 'unknown' && <p className="sw-error" role="alert">Not saved: the Social service answered {editor.error.kind}. Your text is kept here.</p>}
      {editor.error?.kind === 'unknown' && !check && <p className="sw-error" role="alert">{errorText(editor.error)} Your text is kept here.</p>}
      {check && (
        <p className="sw-hint" role="status">
          {check.kind === 'applied' && 'Checked: your save was stored.'}
          {check.kind === 'not-applied' && 'Checked: the save did not happen. Your text is kept; save again when ready.'}
          {check.kind === 'changed' && 'Checked: a different version is stored now. Open it in the library before saving again.'}
          {check.kind === 'unavailable' && 'Could not check: the Social service is unreachable. Your text is kept.'}
          {check.kind === 'possible-match' && (
            <>
              A draft with exactly this text now exists. It may be your save, but that cannot be proved.{' '}
              <Button size="sm" variant="ghost" onClick={() => navigate(`library/${check.drafts[0]!.id}`)}>Open it</Button>
            </>
          )}
        </p>
      )}
      <div className="sw-actions">
        <Button variant="primary" busy={editor.status === 'saving'} busyLabel="Saving" disabled={unchecked} onClick={save}>
          {saved ? 'Save changes' : 'Save to library'}
        </Button>
        {saved && <Button onClick={() => navigate(`library/${saved.id}`)}>Open in library</Button>}
        {!saved && <Button variant="ghost" disabled={editor.status === 'saving'} onClick={() => { setCheck(null); session.closeEditor(key); }}>Discard</Button>}
      </div>
      <p className="sw-hint">Saving stores a draft only. It never posts, schedules or publishes.</p>
    </section>
  );
}
