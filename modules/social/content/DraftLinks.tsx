import { useEffect, useId, useRef, useState } from 'react';
import type { ReferenceEnvelope } from '@hq/contracts';
import { Button, LinkList, LinkPicker, REFERENCE_MAX_AGE_MS, referenceKey,
  type ReferenceEntry, type ReferencePort, type ReferenceUndo } from '@hq/ui';
import { FEATURE_HQ_REFERENCES, type DraftEditor, type SocialSession, type SocialWorkspacePort } from '../core';
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

export function DraftLinks({ session, port, editorKey, editor, features, projectId, references, paused }: DraftLinksProps) {
  const id = useId();
  const [picker, setPicker] = useState(false);
  const [serialized, setSerialized] = useState('');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<ReferenceUndo>();
  const [entries, setEntries] = useState<readonly ReferenceEntry[]>([]);
  const [check, setCheck] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    })).then((next) => { if (current) setEntries(next); });
    return () => { current = false; };
  }, [links, references, projectId, check]);

  const visible = (links ?? []).map((envelope) => entries.find((entry) => entry.envelope === envelope) ?? { envelope });
  async function mutate(next: ReferenceEnvelope[]) {
    if (!editable) throw new Error(supported ? 'References are read-only until the draft and project context are resolved.' : UNSAVED_LINKS);
    return saveDraftLinks(session, port, editorKey, next);
  }
  async function add(value: unknown) {
    setError('');
    try {
      if (!editable) throw new Error(supported ? 'References are read-only until the draft and project context are resolved.' : UNSAVED_LINKS);
      const envelope = addDraftLink(editor.fields.links ?? [], value, projectId).at(-1)!;
      const resolution = await references.resolve(envelope);
      if (!mounted.current) return;
      if (resolution.status === 'moved' || (resolution.targetProjectId && resolution.targetProjectId !== projectId)) {
        throw new Error('Another project: this reference is read-only.');
      }
      const current = session.getState().editors[editorKey];
      if (!current) return;
      const next = addDraftLink(current.fields.links ?? [], envelope, projectId);
      setUndo(await mutate(next));
      setPicker(false);
      setSerialized('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Link change was not confirmed.'); }
  }
  const importText = (text: string) => {
    try { void add(JSON.parse(text)); }
    catch { setError('Paste or drop a valid serialized HQ reference.'); }
  };
  function open(envelope: ReferenceEnvelope) {
    const entry = visible.find((item) => item.envelope === envelope);
    const resolution = entry?.resolution;
    const age = Date.now() - Date.parse(resolution?.observedAt ?? '');
    if (envelope.projectId !== projectId || !resolution || (resolution.targetProjectId && resolution.targetProjectId !== projectId)
      || !Number.isFinite(age) || age < 0 || age > REFERENCE_MAX_AGE_MS || !['available', 'changed', 'archived'].includes(resolution.status)) return;
    references.open(envelope, { label: editor.fields.title || 'draft',
      to: { domain: 'social', destination: `library/${editorKey}` } });
  }
  return <section className="soc-links" aria-label="Draft links"
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); importText(event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain')); }}>
    <h3>Linked across HQ</h3>
    {!supported && <p role="status">{UNSAVED_LINKS}</p>}
    {mismatched && <p role="note">Another project: links are read-only. The project has not changed.</p>}
    <Button disabled={!editable} onClick={() => setPicker(true)}>Link to…</Button>
    <Button onClick={() => setCheck(check + 1)}>Check references</Button>
    <LinkPicker open={picker && editable} projectId={projectId} port={references} existing={links} onClose={() => setPicker(false)} onSelect={(envelope) => void add(envelope)} />
    <label htmlFor={`${id}-paste`}>Serialized HQ reference</label>
    <textarea id={`${id}-paste`} value={serialized} disabled={!editable} onChange={(event) => setSerialized(event.target.value)} />
    <Button disabled={!editable || !serialized} onClick={() => importText(serialized)}>Add reference</Button>
    <LinkList entries={visible} projectId={projectId} onOpen={open}
      onUnlink={editable ? (envelope) => mutate((links ?? []).filter((link) => referenceKey(link) !== referenceKey(envelope))) : undefined}
      onUpdateSnapshot={editable ? (envelope, update) => mutate((links ?? []).map((link) => referenceKey(link) === referenceKey(envelope) ? { ...link, title: update.title, sourceRevision: update.sourceRevision } : link)) : undefined} />
    {undo && <Button onClick={async () => {
      try { await undo.undo(); setUndo(undefined); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Undo was not confirmed.'); }
    }}>Undo link</Button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
