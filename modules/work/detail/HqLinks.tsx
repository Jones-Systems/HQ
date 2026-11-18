import { useEffect, useRef, useState } from 'react';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { Button, LinkList, LinkPicker, referenceKey, type ReferenceEntry, type ReferencePort, type ReferenceUndo, type ReturnContext } from '@hq/ui';
import { HQ_REFERENCES_FEATURE, LIMITS, type Item, type ReferenceInput, type WorkState, type WorkStore } from '../core';
import type { Editor } from './edits';

export interface HqLinksProps {
  item: Item;
  projectId: string;
  port?: ReferencePort;
  returnTo: ReturnContext;
  state: WorkState;
  store: WorkStore;
  editor: Editor;
  now?: () => Date;
}

/** Source-owned mutations reuse the detail editor and the Planner's revision/Undo machinery. */
export function HqLinks({ item, projectId, port, returnTo, state, store, editor, now }: HqLinksProps) {
  const [picker, setPicker] = useState(false);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [observations, setObservations] = useState<{ port: ReferencePort; key: string; entries: ReferenceEntry[] }>();
  const targets = item.references.flatMap((ref) => ref.kind === 'hq' ? [ref.target] : []);
  const key = JSON.stringify(targets);
  const enabled = !!state.confirmed?.features.includes(HQ_REFERENCES_FEATURE);
  const blocked = busy || state.pending.some((p) => 'id' in p.write && p.write.id === item.id)
    || state.unconfirmed.some((p) => 'id' in p.write && p.write.id === item.id) || !!state.held;
  useEffect(() => {
    if (!port) return;
    let current = true;
    const envelopes = JSON.parse(key) as ReferenceEnvelope[];
    void Promise.all(envelopes.map(async (envelope): Promise<ReferenceEntry> => {
      try { return { envelope, resolution: await port.resolve(envelope) }; }
      catch { return { envelope, resolution: { status: 'unavailable', observedAt: new Date().toISOString() } }; }
    })).then((entries) => { if (current) setObservations({ port, key, entries }); });
    return () => { current = false; };
  }, [port, key]);
  const entries = observations?.port === port && observations?.key === key ? observations.entries : targets.map((envelope) => ({ envelope }));

  async function save(next: ReferenceInput[]): Promise<ReferenceUndo> {
    if (!enabled || blocked || lock.current) throw new Error('Links are read-only or a write is pending.');
    lock.current = true;
    setBusy(true);
    try {
      const outcome = await editor.save({ references: next }, { base: { references: item.references }, toast: 'Saved links' });
      if (outcome.status !== 'saved' || !outcome.undoId) throw new Error('Change was not confirmed. Check the card conflict or recovery controls.');
      const undoId = outcome.undoId;
      return { undo: async () => {
        const result = await store.undoEntry(undoId);
        if (result.status !== 'undone') throw new Error('Undo was not confirmed.');
      } };
    } finally { lock.current = false; setBusy(false); }
  }
  async function add(value: unknown) {
    setError('');
    const envelope = parseReference(value);
    if (!envelope || envelope.projectId !== projectId) { setError('Choose a valid reference in this project.'); return; }
    if (item.references.length >= LIMITS.references) { setError('Limited to 30 links.'); return; }
    if (targets.some((target) => referenceKey(target) === referenceKey(envelope))) { setError('This reference is already linked.'); return; }
    try {
      await save([...item.references, { kind: 'hq', label: envelope.title.slice(0, LIMITS.referenceLabel), target: envelope }]);
      setPicker(false); setPaste('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change was not confirmed.'); }
  }
  const writable = enabled && !blocked;
  const mismatch = (entry: ReferenceEntry) => entry.envelope.projectId !== projectId
    || (!!entry.resolution?.targetProjectId && entry.resolution.targetProjectId !== projectId)
    || entry.resolution?.status === 'moved';
  const readOnlyEntries = entries.filter(mismatch);
  const localEntries = entries.filter((entry) => !mismatch(entry));
  return <div onDragOver={(event) => { if (writable) event.preventDefault(); }} onDrop={(event) => {
    event.preventDefault(); event.stopPropagation();
    if (!writable) return;
    try { void add(JSON.parse(event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain'))); }
    catch { setError('Invalid reference JSON.'); }
  }}>
    <LinkList entries={localEntries} projectId={projectId} {...(now ? { now: now().getTime() } : {})}
      {...(port ? { onOpen: (envelope: ReferenceEnvelope) => port.open(envelope, returnTo) } : {})}
      {...(writable ? {
        onUnlink: (envelope: ReferenceEnvelope) => save(item.references.filter((ref) => ref.kind !== 'hq' || referenceKey(ref.target) !== referenceKey(envelope))),
        onUpdateSnapshot: (envelope: ReferenceEnvelope, update: { title: string; sourceRevision: string }) => save(item.references.map((ref) =>
          ref.kind === 'hq' && referenceKey(ref.target) === referenceKey(envelope)
            ? { ...ref, target: { ...ref.target, ...update } } : ref)),
      } : {})} />
    {readOnlyEntries.length > 0 && <LinkList entries={readOnlyEntries} projectId={projectId} {...(now ? { now: now().getTime() } : {})} />}
    {!enabled && <p className="hq-meta">HQ links are read-only: Planner does not advertise hq-references-v1.</p>}
    {enabled && <>
      <Button size="sm" disabled={!writable || !port || item.references.length >= LIMITS.references} onClick={() => setPicker(true)}>Link to…</Button>
      <label className="work-field"><span>Paste reference JSON</span><textarea className="work-input" value={paste} disabled={!writable} onChange={(event) => setPaste(event.target.value)} /></label>
      <Button size="sm" disabled={!writable || !paste || item.references.length >= LIMITS.references} onClick={() => {
        try { void add(JSON.parse(paste)); } catch { setError('Invalid reference JSON.'); }
      }}>Add reference</Button>
    </>}
    {port && <LinkPicker open={picker && writable} projectId={projectId} port={port} existing={targets} onClose={() => setPicker(false)} onSelect={(envelope) => void add(envelope)} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
