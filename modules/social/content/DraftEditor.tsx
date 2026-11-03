import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, Dialog, FieldError, InlineNotice, StatusChip, useToast, type ReferencePort } from '@hq/ui';
import {
  CHANNELS, FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT, LIMITS, MESSAGES, codePoints,
  type Brand, type Channel, type DraftEditor as Editor, type DraftFields, type SocialSession, type SocialWorkspacePort,
} from '../core';
import { SocialIcon, shortTime } from '../ui';
import { errorText, invalidField, reconcileUnknownSave, saveStateOf, type Reconciliation } from './actions';
import { Checks } from './composer/Checks';
import { ChannelPreview } from './composer/ChannelPreview';
import { LimitRing } from './composer/LimitRing';
import { SaveBar, SaveStatus } from './composer/SaveBar';
import { ILLUSTRATIVE_LIMITS, draftChecks, runOrigin } from './composer/channel';
import { DraftLinks } from './DraftLinks';
import { referenceSavePort, UNSAVED_LINKS } from './links';
import { dateLabel } from './model';
import './composer/composer.css';

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
  /** Back to the list without closing the editor; shown where the list and the composer cannot sit side by side. */
  readonly onBack?: () => void;
}

/** What follows "Saved", for example "v4 · 2:31 PM". */
function savedAtLabel(editor: Editor): string | undefined {
  if (!editor.base) return undefined;
  const time = new Date(editor.base.updated_at);
  return Number.isNaN(time.getTime()) ? `v${editor.base.version}` : `v${editor.base.version} · ${shortTime(editor.base.updated_at)}`;
}

/** The control that takes each field's focus when the service rejects it. */
const FIELD_SUFFIX: { readonly [K in keyof DraftFields]?: string } = {
  title: 'title', body: 'body', channel: 'channel', brand_id: 'brand', planned_date: 'planned',
};

function shortcutHint(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.userAgent) ? '⌘ S' : 'Ctrl S';
}

export function DraftEditor({ session, port, editorKey, editor, brands, features, paused, onSaved, onClose, onOpenDraft, onBack, projectId, references }: DraftEditorProps) {
  const id = useId();
  const toast = useToast();
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
  const fieldSuffix = field ? FIELD_SUFFIX[field] : undefined;
  const busy = status === 'saving';
  const isNew = !editor.base;
  const linksUnsupported = (fields.links?.length ?? 0) > 0 && !features.includes(FEATURE_HQ_REFERENCES);
  const brandName = brands.find((brand) => brand.id === fields.brand_id)?.name ?? 'Unknown brand';
  const { title, body, channel } = fields;
  const checks = useMemo(() => draftChecks({ title, body, channel }), [title, body, channel]);
  const origin = runOrigin(fields.links);
  const limit = ILLUSTRATIVE_LIMITS[fields.channel];

  // A rejected field takes focus, so the person lands on what needs fixing with their text kept.
  useEffect(() => {
    if (status === 'error' && error?.kind === 'invalid' && fieldSuffix) document.getElementById(`${id}-${fieldSuffix}`)?.focus();
  }, [status, error, fieldSuffix, id]);

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
    if (saved) {
      // The bar already says Saved; the toast is for the outcome that outlives a glance away, and it never says posted.
      toast.show({ id: `social-draft-saved:${saved.id}`, tone: 'success', title: `Saved “${saved.title}”`, meta: `Version ${saved.version} · nothing was posted`, duration: 8000 });
      onSaved?.(saved.id);
    }
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

  const describedBy = (name: string) => [`${id}-${name}-hint`, field && FIELD_SUFFIX[field] === name ? `${id}-error` : null].filter(Boolean).join(' ');
  const fieldMessage = error?.kind === 'invalid' && fieldSuffix ? errorText(error) : undefined;
  const conflicted = status === 'conflict' || reconciliation?.kind === 'changed';
  const unsaveable = !paused && (error?.kind === 'unknown' && reconciliation?.kind !== 'not-applied');
  const saveDisabled = Boolean(paused) || unsaveable;

  const notices = (
    <>
      {paused && <p className="soc-note soc-note--warning" role="note">{paused}</p>}
      {linkError && <p className="soc-note soc-note--danger" role="alert">{linkError}</p>}
      {conflicted && (
        <InlineNotice
          tone="danger" title="Changed elsewhere."
          actions={[
            { label: 'Load their version', onAction: () => setConfirm('load-theirs') },
            { label: 'Save mine as a copy', onAction: () => void saveCopy() },
            { label: 'Copy my text', onAction: () => void copyText() },
          ]}
        >
          Someone saved this draft in another window. Nothing was overwritten, and your text is kept here.
          {copied === 'copied' && <span role="status"> Copied.</span>}
          {copied === 'select' && <span role="status"> Copying is unavailable here; select the text above and copy it.</span>}
          {loadNote && <span role="status"> {loadNote}</span>}
        </InlineNotice>
      )}
      {error && status === 'error' && error.kind !== 'unknown' && !fieldMessage && (
        <InlineNotice tone="danger" title="Not saved.">{errorText(error)} Your text is kept in this session.</InlineNotice>
      )}
      {error && status === 'error' && fieldMessage && <p className="soc-note soc-note--danger">Fix the highlighted field. Your text is kept in this session.</p>}
      {error && status === 'error' && error.kind === 'unknown' && (
        <InlineNotice tone="unknown" title="Not confirmed.">{errorText(error)} Your text is kept in this session.</InlineNotice>
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
    </>
  );

  return (
    <section className="soc-cmp" aria-labelledby={`${id}-heading`} onKeyDown={onKeyDown}>
      <header className="soc-cmp-head">
        {onBack && (
          <Button className="soc-cmp-back" size="sm" variant="ghost" aria-label="Back to all drafts" onClick={onBack}><SocialIcon name="chevron-left" />All drafts</Button>
        )}
        <h2 id={`${id}-heading`}>{isNew ? 'New draft' : 'Edit draft'}</h2>
        <span className="soc-cmp-where">{brandName} · {fields.channel}</span>
      </header>

      {origin && (
        <div className="soc-origin" role="group" aria-label="Where this draft came from">
          <span className="soc-origin-icon" aria-hidden="true"><SocialIcon name="sparkle" /></span>
          <div className="soc-origin-text">
            <strong>From run · {origin.tool}{origin.asOf ? ` · ${origin.asOf}` : ''}</strong>
            <span>
              {origin.example ? 'Built from example data. ' : ''}
              {linksUnsupported ? 'The link to the run stays in this draft but cannot be stored yet.'
                : isNew ? 'The link to the run is saved with the draft when you save.' : 'The link to the run is saved with the draft.'}
            </span>
          </div>
          {origin.example && <span className="sx-tag sx-tag--example">Example data</span>}
        </div>
      )}

      <fieldset className="soc-cmp-compose" disabled={mismatch}>
        <div className="soc-field soc-field--title">
          <div className="soc-field-line">
            <label htmlFor={`${id}-title`}>Title</label>
            <small id={`${id}-title-hint`} className="soc-field-count">{codePoints(fields.title)} / {LIMITS.title} characters</small>
          </div>
          <input
            id={`${id}-title`} value={fields.title} onChange={(event) => edit({ title: event.target.value })} placeholder="A short title for finding this draft"
            aria-invalid={field === 'title' || undefined} aria-describedby={describedBy('title')} readOnly={busy}
          />
          {field === 'title' && <FieldError id={`${id}-error`} announce>{fieldMessage}</FieldError>}
        </div>

        <div className="soc-field soc-field--body">
          <label htmlFor={`${id}-body`}>Body</label>
          <textarea
            id={`${id}-body`} rows={5} value={fields.body} onChange={(event) => edit({ body: event.target.value })} placeholder="Write the post…"
            aria-invalid={field === 'body' || undefined} aria-describedby={describedBy('body')} readOnly={busy}
          />
          {field === 'body' && <FieldError id={`${id}-error`} announce>{fieldMessage}</FieldError>}
          <LimitRing id={`${id}-body-hint`} count={codePoints(fields.body)} limit={limit} channel={fields.channel} />
        </div>

        <div className="soc-cmp-details">
          <div className="soc-field">
            <label htmlFor={`${id}-brand`}>Brand</label>
            <select id={`${id}-brand`} value={fields.brand_id} onChange={(event) => edit({ brand_id: event.target.value })} aria-invalid={field === 'brand_id' || undefined} aria-describedby={describedBy('brand')} disabled={busy}>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
            {field === 'brand_id' && <FieldError id={`${id}-error`} announce>{fieldMessage}</FieldError>}
            <small id={`${id}-brand-hint`} className="hq-sr-only">Brands come from the Social workspace.</small>
          </div>

          <div className="soc-field">
            <label htmlFor={`${id}-channel`}>Channel</label>
            <select id={`${id}-channel`} value={fields.channel} onChange={(event) => edit({ channel: event.target.value as Channel })} aria-invalid={field === 'channel' || undefined} aria-describedby={describedBy('channel')} disabled={busy}>
              {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
            </select>
            {field === 'channel' && <FieldError id={`${id}-error`} announce>{fieldMessage}</FieldError>}
            <small id={`${id}-channel-hint`} className="soc-hint">Nothing is posted to this channel.</small>
          </div>

          <div className="soc-field soc-field--date">
            <label htmlFor={`${id}-planned`}>Planned date</label>
            <span className="soc-inline">
              <input
                id={`${id}-planned`} type="date" value={fields.planned_date} onChange={(event) => edit({ planned_date: event.target.value })}
                aria-invalid={field === 'planned_date' || undefined} aria-describedby={describedBy('planned')} readOnly={busy}
              />
              {fields.planned_date && <Button size="sm" variant="ghost" onClick={() => edit({ planned_date: '' })} disabled={busy}>Clear date</Button>}
            </span>
            {field === 'planned_date' && <FieldError id={`${id}-error`} announce>{fieldMessage}</FieldError>}
            <small id={`${id}-planned-hint`} className="soc-hint">
              {fields.planned_date ? `Planned for ${dateLabel(fields.planned_date)}. ` : 'No planned date. '}
              An editorial planning label only: it never posts, and it is separate from Work's planning dates.
            </small>
          </div>
        </div>
        <div className="soc-cmp-preview">
          <h3 className="soc-side-title">Channel preview</h3>
          <ChannelPreview fields={fields} brandName={brandName} />
        </div>
        <Checks checks={checks} headingId={`${id}-checks`} />
      </fieldset>

      {references && projectId ? <DraftLinks session={session} port={port} editorKey={editorKey} editor={editor} features={features} projectId={projectId} references={references} paused={paused} /> : (fields.links?.length ?? 0) > 0 && (
        <section className="soc-links" aria-labelledby={`${id}-links`}>
          <div className="soc-links-head"><h3 id={`${id}-links`}>Linked across HQ</h3></div>
          <ul className="soc-link-list">
            {fields.links!.map((link) => (
              <li key={`${link.domain}/${link.kind}/${link.entityId}`} className="soc-link">
                <span className="soc-link-icon" aria-hidden="true"><SocialIcon name="link" /></span>
                <div className="soc-link-body">
                  <span className="soc-link-title">{link.title}</span>
                  <span className="soc-link-meta">{link.kind} in {link.domain}</span>
                </div>
              </li>
            ))}
          </ul>
          {linksUnsupported && <div className="soc-links-unsupported"><StatusChip tone="warning" label="Not saved" /><p>{UNSAVED_LINKS}</p></div>}
        </section>
      )}

      <SaveBar
        notices={notices}
        hint={shortcutHint()}
        status={(
          <SaveStatus
            state={saveStateOf(editor)}
            savedAt={savedAtLabel(editor)}
            onRetry={status === 'error' && error?.kind !== 'invalid' && error?.kind !== 'unknown' ? () => void save() : undefined}
            onCheck={async () => setReconciliation(await reconcileUnknownSave(session, port, editorKey))}
          />
        )}
        actions={(
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => (status === 'editing' && !isNew && saveStateOf(editor) === 'saved' ? onClose() : setConfirm('discard'))}>
              Close
            </Button>
            {!isNew && (
              <Button variant="secondary" size="sm" onClick={() => void toggleArchive()} disabled={Boolean(paused)}>
                {fields.archived === 1 ? 'Restore' : 'Archive'}
              </Button>
            )}
            <Button variant="primary" size="sm" busy={busy} busyLabel="Saving…" onClick={() => void save()} disabled={saveDisabled} aria-keyshortcuts="Control+S Meta+S" title="Save the draft to the library. It is never posted.">
              Save
            </Button>
          </>
        )}
      />

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
