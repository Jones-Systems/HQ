import { useEffect, useId, useRef, useState } from 'react';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { Button, LinkPicker, REFERENCE_MAX_AGE_MS, StatusChip, referenceKey,
  type ReferenceEntry, type ReferencePort, type ReferenceStatus, type ReferenceUndo, type StatusTone } from '@hq/ui';
import { FEATURE_HQ_REFERENCES, type DraftEditor, type SocialSession, type SocialWorkspacePort } from '../core';
import { SocialIcon } from '../ui';
import { addDraftLink, saveDraftLinks, UNSAVED_LINKS } from './links';

export interface DraftLinksProps {
  readonly session: SocialSession;
  readonly port: SocialWorkspacePort;
  readonly editorKey: string;
  readonly editor: DraftEditor;
  readonly features: readonly string[];
  readonly projectId: string;
  readonly references: ReferencePort;
  readonly paused?: string;
}

const STATUS_WORDS: { readonly [S in ReferenceStatus]: string } = {
  available: 'Up to date', changed: 'Changed since linked', archived: 'Archived', missing: 'Can’t be found',
  moved: 'In another project', forbidden: 'Not allowed to open', unavailable: 'Can’t be reached right now', unknown: 'Not checked yet',
};
const STATUS_TONES: { readonly [S in ReferenceStatus]: StatusTone } = {
  available: 'success', changed: 'warning', archived: 'neutral', missing: 'danger',
  moved: 'info', forbidden: 'danger', unavailable: 'unavailable', unknown: 'unknown',
};

function words(value: string): string {
  const spaced = value.replace(/[-_]+/gu, ' ').trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value;
}

/** A link's status in plain words. An observation older than the shared freshness limit is not trusted as current. */
function linkStatus(entry: ReferenceEntry, now: number): ReferenceStatus {
  const status = entry.resolution?.status ?? 'unknown';
  const observed = Date.parse(entry.resolution?.observedAt ?? '');
  const fresh = Number.isFinite(observed) && observed <= now && now - observed <= REFERENCE_MAX_AGE_MS && !entry.stale;
  return status === 'available' && !fresh ? 'unknown' : status;
}

function projectContext(entry: ReferenceEntry, projectId: string): boolean {
  return entry.envelope.projectId !== projectId || (entry.resolution?.targetProjectId !== undefined && entry.resolution.targetProjectId !== projectId);
}

interface Notice { readonly message: string; readonly action: ReferenceUndo }

/**
 * Links from a draft to records elsewhere in HQ, shown with a title, where each lives and its status in plain
 * words. Pasting a serialized reference and the raw record of each link are developer tools, kept behind Advanced.
 * Every change is one versioned save of the draft with an Undo; nothing here starts work.
 */
export function DraftLinks({ session, port, editorKey, editor, features, projectId, references, paused }: DraftLinksProps) {
  const id = useId();
  const [picker, setPicker] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [serialized, setSerialized] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [pending, setPending] = useState(false);
  const [entries, setEntries] = useState<readonly ReferenceEntry[]>([]);
  const [check, setCheck] = useState(0);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(true);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const links = editor.fields.links;
  const supported = features.includes(FEATURE_HQ_REFERENCES);
  const mismatched = (links ?? []).some((link) => link.projectId !== projectId)
    || entries.some((entry) => entry.resolution?.targetProjectId && entry.resolution.targetProjectId !== projectId);
  const editable = supported && !paused && !mismatched && editor.status === 'editing';
  useEffect(() => {
    let current = true;
    setEntries((links ?? []).map((envelope) => ({ envelope })));
    void Promise.all((links ?? []).map(async (envelope): Promise<ReferenceEntry> => {
      try { return { envelope, resolution: await references.resolve(envelope) }; }
      catch { return { envelope, resolution: { status: 'unavailable', observedAt: new Date().toISOString() } }; }
    })).then((next) => { if (current) { setEntries(next); setNow(Date.now()); } });
    return () => { current = false; };
  }, [links, references, projectId, check]);

  const visible = (links ?? []).map((envelope) => entries.find((entry) => entry.envelope === envelope) ?? { envelope });
  const readOnly = supported ? 'References are read-only until the draft and project context are resolved.' : UNSAVED_LINKS;

  async function mutate(next: ReferenceEnvelope[]) {
    if (!editable) throw new Error(readOnly);
    return saveDraftLinks(session, port, editorKey, next);
  }
  /** One change at a time: the buttons are disabled while it runs, and a second activation is ignored. */
  async function perform(message: string, action: () => Promise<ReferenceUndo>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try { setNotice({ message, action: await action() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Link change was not confirmed.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function add(value: unknown) {
    setError('');
    try {
      if (!editable) throw new Error(readOnly);
      const envelope = addDraftLink(editor.fields.links ?? [], value, projectId).at(-1)!;
      const resolution = await references.resolve(envelope);
      if (!mounted.current) return;
      if (resolution.status === 'moved' || (resolution.targetProjectId && resolution.targetProjectId !== projectId)) {
        throw new Error('Another project: this reference is read-only.');
      }
      const current = session.getState().editors[editorKey];
      if (!current) return;
      const next = addDraftLink(current.fields.links ?? [], envelope, projectId);
      await perform(`Linked “${envelope.title}”.`, () => mutate(next));
      setPicker(false);
      setSerialized('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Link change was not confirmed.'); }
  }
  const importText = (text: string) => {
    try { void add(JSON.parse(text)); }
    catch { setError('Paste or drop a valid serialized HQ reference.'); }
  };
  async function undo() {
    if (!notice || busy.current) return;
    busy.current = true;
    setPending(true);
    try { await notice.action.undo(); setNotice(undefined); heading.current?.focus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Undo was not confirmed.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  function open(envelope: ReferenceEnvelope) {
    const entry = visible.find((item) => item.envelope === envelope);
    const resolution = entry?.resolution;
    const age = Date.now() - Date.parse(resolution?.observedAt ?? '');
    if (envelope.projectId !== projectId || !resolution || (resolution.targetProjectId && resolution.targetProjectId !== projectId)
      || !Number.isFinite(age) || age < 0 || age > REFERENCE_MAX_AGE_MS || !['available', 'changed', 'archived'].includes(resolution.status)) return;
    references.open(envelope, { label: editor.fields.title || 'draft',
      to: { domain: 'social', destination: `library/${editorKey}` } });
  }

  return <section className="soc-links" aria-label="Draft links" aria-busy={pending || undefined}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); importText(event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain')); }}>
    <div className="soc-links-head">
      <h3 ref={heading} tabIndex={-1}>Linked across HQ</h3>
      <span className="soc-links-actions">
        <Button size="sm" disabled={!editable || pending} onClick={() => setPicker(true)}><SocialIcon name="link" />Link to…</Button>
        <Button size="sm" variant="ghost" onClick={() => setCheck(check + 1)}>Check references</Button>
      </span>
    </div>
    {!supported && <p className="soc-note soc-note--warning" role="status">{UNSAVED_LINKS}</p>}
    {mismatched && <p className="soc-note" role="note">Another project: links are read-only. The project has not changed.</p>}
    <LinkPicker open={picker && editable} projectId={projectId} port={references} existing={links} onClose={() => setPicker(false)} onSelect={(envelope) => void add(envelope)} />

    {visible.length === 0
      ? <p className="soc-links-empty">Nothing linked yet. Link a research run, a design asset or a work card so its source stays with this draft.</p>
      : (
        <ul className="soc-link-list">
          {visible.map((entry) => {
            const { envelope, resolution } = entry;
            const status = linkStatus(entry, now);
            const foreign = projectContext(entry, projectId);
            const openable = !foreign && ['available', 'changed', 'archived'].includes(status);
            const latest = resolution?.latestTitle && resolution.latestTitle !== envelope.title ? resolution.latestTitle : undefined;
            // A snapshot update needs a current, same-project observation whose latest title and revision form a valid reference.
            const canUpdate = editable && !pending && !foreign && (status === 'available' || status === 'changed')
              && Boolean(resolution?.latestTitle) && Boolean(resolution?.latestRevision)
              && parseReference({ ...envelope, title: resolution!.latestTitle, sourceRevision: resolution!.latestRevision }) !== null
              && (resolution!.latestTitle !== envelope.title || resolution!.latestRevision !== envelope.sourceRevision);
            return (
              <li key={referenceKey(envelope)} className="soc-link" data-status={status}>
                <span className="soc-link-icon" aria-hidden="true"><SocialIcon name="link" /></span>
                <div className="soc-link-body">
                  <span className="soc-link-title">{envelope.title}</span>
                  <span className="soc-link-meta">{words(envelope.kind)} in {words(envelope.domain)}</span>
                  {latest && <p className="soc-link-note">Latest title: {latest}. This link keeps the old title until you update it.</p>}
                  {foreign && <p className="soc-link-note">This is in another project, so it is read-only here.</p>}
                </div>
                <StatusChip tone={STATUS_TONES[status]} label={STATUS_WORDS[status]} />
                <span className="soc-link-actions">
                  <Button size="sm" variant="ghost" disabled={!openable} onClick={() => open(envelope)} aria-label={`Open ${envelope.title}`}>Open</Button>
                  {editable && <Button size="sm" variant="ghost" disabled={pending} onClick={() => void perform(`Unlinked “${envelope.title}”.`, () => mutate((links ?? []).filter((link) => referenceKey(link) !== referenceKey(envelope))))} aria-label={`Unlink ${envelope.title}`}>Unlink</Button>}
                  {editable && <Button size="sm" variant="ghost" disabled={!canUpdate} aria-label={`Update title ${envelope.title}`}
                    onClick={() => {
                      if (!canUpdate || !resolution?.latestTitle || !resolution.latestRevision) return;
                      const update = { title: resolution.latestTitle, sourceRevision: resolution.latestRevision };
                      void perform(`Updated the title of “${envelope.title}”.`, () => mutate((links ?? []).map((link) => referenceKey(link) === referenceKey(envelope) ? { ...link, ...update } : link)));
                    }}>Update title</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

    <div className="soc-links-notice" role="status" aria-live="polite">
      {notice && <><span>{notice.message}</span><Button size="sm" variant="secondary" disabled={pending} onClick={() => void undo()}>Undo</Button></>}
    </div>
    {error && <p className="soc-note soc-note--danger" role="alert">{error}</p>}

    <div className="soc-advanced" data-open={advanced || undefined}>
      <button type="button" className="soc-advanced-toggle" aria-expanded={advanced} aria-controls={`${id}-advanced`} onClick={() => setAdvanced(!advanced)}>
        <SocialIcon name={advanced ? 'chevron-down' : 'chevron-right'} />Advanced
      </button>
      <div id={`${id}-advanced`} className="soc-advanced-body" hidden={!advanced}>
        <p className="hq-meta">For developers: add a link by pasting a serialized reference, or read each link’s raw record.</p>
        <label htmlFor={`${id}-paste`}>Serialized HQ reference</label>
        <textarea id={`${id}-paste`} value={serialized} disabled={!editable} rows={3} onChange={(event) => setSerialized(event.target.value)} />
        <span><Button size="sm" disabled={!editable || !serialized || pending} onClick={() => importText(serialized)}>Add reference</Button></span>
        {visible.length > 0 && (
          <ul className="soc-link-raw" aria-label="Raw link records">
            {visible.map(({ envelope, resolution }) => (
              <li key={referenceKey(envelope)} className="sx-mono">
                {envelope.domain} · {envelope.kind} · {envelope.entityId} · project {envelope.projectId}
                {' · '}{envelope.sourceRevision ? `snapshot ${envelope.sourceRevision}` : 'snapshot revision unknown'}
                {' · '}{resolution ? `${resolution.status}, observed ${resolution.observedAt}` : 'not resolved'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  </section>;
}
