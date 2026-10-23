import { Button, SaveIndicator, StatusChip } from '@hq/ui';
import { CHANNELS, isDirty, workspaceSnapshot, type Channel, type RunRecord } from '../core';
import { canSaveCitation, draftFromResult, runCitation } from './citation';
import { useWorkbench } from './env';
import { SelectField, TextField } from './fields';
import { shortId } from './format';
import type { ResultSummary } from './results';

export function startDraftKey(runId: string): string {
  return `workbench-run:${runId}`;
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

  if (!editor) {
    return (
      <div className="sw-start">
        <Button variant="secondary" onClick={() => session.openEditor(key, null, draftFromResult(run, toolName, summary, citation, features))}>Start draft</Button>
        <p className="sw-hint">Opens an unsaved draft with a citation of this run. Nothing is saved until you choose Save to library.</p>
      </div>
    );
  }

  const saved = editor.base;
  const saveState = editor.status === 'saving' ? 'saving' : editor.status === 'error' || editor.status === 'conflict' ? 'failed' : saved && !isDirty(editor) ? 'saved' : 'unsaved';
  const id = (field: string) => `sw-start-${run.id}-${field}`;
  const brands = snapshot?.brands ?? [];
  return (
    <section className="sw-start sw-start--open" aria-labelledby={id('title-heading')}>
      <div className="sw-panel-head">
        <h4 id={id('title-heading')}>{saved ? 'Draft in library' : 'Unsaved draft'}</h4>
        <SaveIndicator state={saveState} {...(saveState === 'failed' ? { onRetry: () => void session.saveEditor(port, key) } : {})} />
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
      {editor.error && !('message' in editor.error) && <p className="sw-error" role="alert">Not saved: the Social service answered {editor.error.kind}. Your text is kept here.</p>}
      <div className="sw-actions">
        <Button variant="primary" busy={editor.status === 'saving'} busyLabel="Saving" onClick={() => void session.saveEditor(port, key)}>
          {saved ? 'Save changes' : 'Save to library'}
        </Button>
        {saved && <Button onClick={() => navigate(`library/${saved.id}`)}>Open in library</Button>}
        {!saved && <Button variant="ghost" onClick={() => session.closeEditor(key)}>Discard</Button>}
      </div>
      <p className="sw-hint">Saving stores a draft only. It never posts, schedules or publishes.</p>
    </section>
  );
}
