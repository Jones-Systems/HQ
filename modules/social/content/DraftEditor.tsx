import { useId, useState, type KeyboardEvent } from 'react';
import { Button, Dialog, SaveIndicator, StatusChip, type ReferencePort } from '@hq/ui';
import {
  CHANNELS, FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT, LIMITS, MESSAGES, codePoints,
  type Brand, type Channel, type DraftEditor as Editor, type SocialSession, type SocialWorkspacePort,
} from '../core';
import { errorText, invalidField, reconcileUnknownSave, saveStateOf, type Reconciliation } from './actions';
import { DraftLinks } from './DraftLinks';
import { referenceSavePort, UNSAVED_LINKS } from './links';
import { dateLabel } from './model';

export interface DraftEditorProps {
  readonly projectId?: string;
  readonly references?: ReferencePort;
  readonly session: SocialSession;
  readonly port: SocialWorkspacePort;
  readonly editorKey: string;
  readonly editor: Editor;
  readonly brands: readonly Brand[];
  readonly features: readonly string[];
  /** Why saving is paused, for example while the service is unreachable. */
  readonly paused?: string;
  readonly onSaved?: (draftId: string) => void;
  readonly onClose: () => void;
  readonly onOpenDraft: (draftId: string) => void;
}

function savedAtLabel(editor: Editor): string | undefined {
  if (!editor.base) return undefined;
  const time = new Date(editor.base.updated_at);
  const clock = Number.isNaN(time.getTime()) ? '' : ` at ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `· version ${editor.base.version}${clock}`;
}

export function DraftEditor({ session, port, editorKey, editor, brands, features, paused, onSaved, onClose, onOpenDraft, projectId, references }: DraftEditorProps) {
  const id = useId();
  const [linkError, setLinkError] = useState('');
  const brandProject = features.includes(FEATURE_HQ_BRAND_PROJECT) ? brands.find((brand) => brand.id === editor.fields.brand_id)?.project_id : undefined;
  const mismatch = Boolean(references && projectId && brandProject && projectId !== brandProject);
  if (mismatch) paused = 'Another project: this draft is read-only. The project has not changed.';
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'load-theirs' | null>(null);
  const [copied, setCopied] = useState<'copied' | 'select' | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const { fields, status, error } = editor;
  const field = invalidField(error);
  const busy = status === 'saving';
  const isNew = !editor.base;
  const linksUnsupported = (fields.links?.length ?? 0) > 0 && !features.includes(FEATURE_HQ_REFERENCES);

  const edit = (patch: Parameters<SocialSession['editDraft']>[1]) => {
    setReconciliation(null);
    session.editDraft(editorKey, patch);
  };

  async function save() {
    if (busy || paused || (error?.kind === 'unknown' && reconciliation?.kind !== 'not-applied')) return null;
    if (linksUnsupported) { setLinkError(MESSAGES.linksUnsupported); return null; }
    setLinkError('');
    setReconciliation(null);
    const saved = await session.saveEditor(referenceSavePort(port, features), editorKey);
    if (saved) onSaved?.(saved.id);
    return saved;
  }

  /** Archive or restore in one versioned save of the open text; a failed save leaves the flag as it was. */
  async function toggleArchive() {
    if (busy || paused || !editor.base) return;
    const previous = fields.archived;
    edit({ archived: previous === 1 ? 0 : 1 });
    if (!(await save())) session.editDraft(editorKey, { archived: previous });
  }

  async function saveCopy() {
    if (paused || (error?.kind === 'unknown' && reconciliation?.kind !== 'changed' && reconciliation?.kind !== 'not-applied')) return;
    if (linksUnsupported) { setLinkError(MESSAGES.linksUnsupported); return; }
    setReconciliation(null);
    const saved = await session.saveAsCopy(referenceSavePort(port, features), editorKey);
    if (saved) onSaved?.(saved.id);
  }

  async function copyText() {
    const text = `${fields.title}\n\n${fields.body}`;
    try {
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('select');
    }
  }

  /** Replaces the text only with a newer stored version from a fresh read; otherwise the text and conflict stay. */
  async function loadTheirs() {
    setConfirm(null);
    setLoadNote(null);
    if (await session.reopenLatest(port, editorKey)) return;
    const load = session.getState().workspace;
    setLoadNote(`Could not load their version. ${load.status === 'error' ? `${errorText(load.error)} ` : ''}Your text is kept here.`);
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  }

  const describedBy = (name: string) => [`${id}-${name}-hint`, field === name ? `${id}-error` : null].filter(Boolean).join(' ');

  return (
    <section className="soc-editor" aria-labelledby={`${id}-heading`} onKeyDown={onKeyDown}>
      <header className="soc-editor-bar">
        <h2 id={`${id}-heading`}>{isNew ? 'New draft' : 'Edit draft'}</h2>
        <SaveIndicator
          state={saveStateOf(editor)}
          savedAt={savedAtLabel(editor)}
          onRetry={status === 'error' && error?.kind !== 'invalid' && error?.kind !== 'unknown' ? () => void save() : undefined}
          onCheck={async () => setReconciliation(await reconcileUnknownSave(session, port, editorKey))}
        />
        <span className="soc-editor-actions">
          {!isNew && (
            <Button variant="secondary" size="sm" onClick={() => void toggleArchive()} disabled={Boolean(paused)}>
              {fields.archived === 1 ? 'Restore' : 'Archive'}
            </Button>
          )}
          <Button variant="primary" size="sm" busy={busy} busyLabel="Saving…" onClick={() => void save()} disabled={Boolean(paused) || (error?.kind === 'unknown' && reconciliation?.kind !== 'not-applied')} aria-keyshortcuts="Control+S Meta+S">
            Save
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => (status === 'editing' && !isNew && saveStateOf(editor) === 'saved' ? onClose() : setConfirm('discard'))}>
            Close
          </Button>
        </span>
      </header>

      {paused && <p className="soc-note soc-note--warning" role="note">{paused}</p>}

      {(status === 'conflict' || reconciliation?.kind === 'changed') && (
        <div className="soc-banner soc-banner--danger" role="alert">
          <strong>Changed elsewhere.</strong>
          <span> Someone saved this draft in another window. Nothing was overwritten, and your text is kept here.</span>
          <span className="soc-banner-actions">
            <Button size="sm" variant="secondary" onClick={() => setConfirm('load-theirs')}>Load their version</Button>
            <Button size="sm" variant="secondary" onClick={() => void saveCopy()}>Save mine as a copy</Button>
            <Button size="sm" variant="ghost" onClick={() => void copyText()}>Copy my text</Button>
          </span>
          {copied === 'copied' && <span role="status"> Copied.</span>}
          {copied === 'select' && <span role="status"> Copying is unavailable here; select the text below and copy it.</span>}
          {loadNote && <span role="status"> {loadNote}</span>}
        </div>
      )}

      {error && status === 'error' && (
        <p id={`${id}-error`} className="soc-note soc-note--danger" role="alert">
          <strong>Not saved.</strong> {errorText(error)} Your text is kept in this session.
        </p>
      )}

      {reconciliation && (
        <p className="soc-note" role="status">
          {reconciliation.kind === 'applied' && 'Checked: your save was stored.'}
          {reconciliation.kind === 'not-applied' && 'Checked: the save did not happen. Your text is kept; save again when ready.'}
          {reconciliation.kind === 'changed' && 'Checked: a different version is stored now. Load their version or save yours as a copy.'}
          {reconciliation.kind === 'unavailable' && 'Could not check: the Social service is unreachable. Your text is kept.'}
          {reconciliation.kind === 'possible-match' && (
            <>
              A draft with exactly this text now exists. It may be your save, but that cannot be proved.{' '}
              <Button size="sm" variant="ghost" onClick={() => onOpenDraft(reconciliation.drafts[0]!.id)}>Open it</Button>
            </>
          )}
        </p>
      )}

      {linkError && <p role="alert">{linkError}</p>}
      <fieldset className="soc-fields" disabled={mismatch} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="soc-field soc-field--wide">
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`} value={fields.title} onChange={(event) => edit({ title: event.target.value })}
            aria-invalid={field === 'title' || undefined} aria-describedby={describedBy('title')} readOnly={busy}
          />
          <small id={`${id}-title-hint`} className="hq-meta">{codePoints(fields.title)} / {LIMITS.title} characters</small>
        </div>

        <div className="soc-field">
          <label htmlFor={`${id}-brand`}>Brand</label>
          <select id={`${id}-brand`} value={fields.brand_id} onChange={(event) => edit({ brand_id: event.target.value })} aria-invalid={field === 'brand_id' || undefined} aria-describedby={describedBy('brand_id')} disabled={busy}>
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <small id={`${id}-brand_id-hint`} className="hq-meta">Brands come from the Social workspace.</small>
        </div>

        <div className="soc-field">
          <label htmlFor={`${id}-channel`}>Channel</label>
          <select id={`${id}-channel`} value={fields.channel} onChange={(event) => edit({ channel: event.target.value as Channel })} aria-invalid={field === 'channel' || undefined} aria-describedby={describedBy('channel')} disabled={busy}>
            {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>
          <small id={`${id}-channel-hint`} className="hq-meta">Nothing is posted to this channel.</small>
        </div>

        <div className="soc-field">
          <label htmlFor={`${id}-planned`}>Planned date</label>
          <span className="soc-inline">
            <input
              id={`${id}-planned`} type="date" value={fields.planned_date} onChange={(event) => edit({ planned_date: event.target.value })}
              aria-invalid={field === 'planned_date' || undefined} aria-describedby={describedBy('planned_date')} readOnly={busy}
            />
            {fields.planned_date && <Button size="sm" variant="ghost" onClick={() => edit({ planned_date: '' })} disabled={busy}>Clear date</Button>}
          </span>
          <small id={`${id}-planned_date-hint`} className="hq-meta">
            {fields.planned_date ? `Planned for ${dateLabel(fields.planned_date)}. ` : 'No planned date. '}
            An editorial planning label only: it never posts, and it is separate from Work's planning dates.
          </small>
        </div>

        <div className="soc-field soc-field--wide">
          <label htmlFor={`${id}-body`}>Body</label>
          <textarea
            id={`${id}-body`} rows={10} value={fields.body} onChange={(event) => edit({ body: event.target.value })}
            aria-invalid={field === 'body' || undefined} aria-describedby={describedBy('body')} readOnly={busy}
          />
          <small id={`${id}-body-hint`} className="hq-meta">{codePoints(fields.body)} / {LIMITS.body} characters · one body for every channel</small>
        </div>
      </fieldset>

      {references && projectId ? <DraftLinks session={session} port={port} editorKey={editorKey} editor={editor} features={features} projectId={projectId} references={references} paused={paused} /> : (fields.links?.length ?? 0) > 0 && (
        <section className="soc-links" aria-labelledby={`${id}-links`}>
          <h3 id={`${id}-links`}>Linked across HQ</h3>
          <ul>
            {fields.links!.map((link) => (
              <li key={`${link.domain}/${link.kind}/${link.entityId}`}>
                <span>{link.title}</span> <span className="hq-meta">{link.domain} · {link.kind}{link.sourceRevision ? ` · as of ${link.sourceRevision}` : ''}</span>
              </li>
            ))}
          </ul>
          {linksUnsupported && <><StatusChip tone="warning" label="Not saved" /><p>{UNSAVED_LINKS}</p></>}
        </section>
      )}

      <Dialog
        open={confirm === 'discard'} onClose={() => setConfirm(null)} role="alertdialog"
        title="Discard unsaved changes?" description="Your edits to this draft have not been saved. Closing discards them."
        actions={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Keep editing</Button>
          <Button variant="danger" onClick={() => { setConfirm(null); onClose(); }}>Discard</Button>
        </>}
      />
      <Dialog
        open={confirm === 'load-theirs'} onClose={() => setConfirm(null)} role="alertdialog"
        title="Load their version?" description="Your text in this editor will be replaced by the stored version. Copy it or save it as a copy first if you need it."
        actions={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => void loadTheirs()}>Load their version</Button>
        </>}
      />
    </section>
  );
}
