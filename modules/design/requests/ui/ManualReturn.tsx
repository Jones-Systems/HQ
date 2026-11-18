import { Button, Presence, useToast } from '@hq/ui';
import { useId, useState, useSyncExternalStore } from 'react';
import type { RequestSession } from '../src/session.ts';
import { GuardedButton } from './GuardedButton.tsx';
import { holdReason, requestTitle } from './model.ts';

export interface ManualReturnTarget {
  readonly id: string;
  readonly session: RequestSession;
}

export interface ManualReturnProps {
  /** Requests that can receive a manual return, which are the ones with a frozen packet. */
  readonly targets: readonly ManualReturnTarget[];
  /** The request to answer first. */
  readonly preferredId?: string | null;
  /** Called once a manual return has been saved. */
  readonly onRecorded?: (target: ManualReturnTarget) => void;
}

/**
 * Work that came back outside HQ. It sits behind one button so the page stays about returned work, saves once,
 * is labelled owner-reported, and never counts as observed or verified.
 */
export function ManualReturn({ targets, preferredId = null, onRecorded }: ManualReturnProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [claims, setClaims] = useState('');
  const [artifact, setArtifact] = useState('');
  const bodyId = useId();
  const target = targets.find((item) => item.id === chosenId) ?? targets.find((item) => item.id === preferredId) ?? targets[0] ?? null;
  const subscribe = (listener: () => void) => target ? target.session.subscribe(listener) : () => undefined;
  const state = useSyncExternalStore(subscribe, () => target?.session.state ?? null, () => target?.session.state ?? null);
  const head = state?.packets.at(-1) ?? null;
  const lines = claims.split('\n').map((entry) => entry.trim()).filter(Boolean);
  const hold = state ? holdReason(state) : null;
  const submitReason = hold ?? (lines.length === 0 ? 'Write what came back first.' : null);

  const submit = async () => {
    if (!target || !head || submitReason) return;
    const done = await target.session.reportReturn({
      packetId: head.packetId, claims: lines,
      ...(artifact.trim() ? { artifacts: [{ kind: 'note' as const, label: artifact.trim() }] } : {}),
    });
    if (done) {
      setClaims(''); setArtifact(''); setOpen(false);
      toast.success('Manual return recorded', {
        description: `Saved for packet #${head.lineage.sequence} of “${requestTitle(target.session.state)}”. It is labelled owner-reported and is not verified.`,
      });
      onRecorded?.(target);
      return;
    }
    const after = target.session.state;
    if (after.unknown) {
      toast.unknown('Manual return result unknown', {
        description: `${after.error ?? 'The result was not confirmed.'} Reconcile to read what was saved.`,
        action: { label: 'Reconcile', onAction: () => { void target.session.reconcile(); } },
      });
    } else {
      toast.error("Couldn't record the manual return", { description: `${after.error ?? 'It was not saved.'} What you typed is still in the form.` });
    }
  };

  return <div className="hqr-manual">
    <div className="hqr-manual-bar">
      {target
        ? <Button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((previous) => !previous)}>Record a manual return</Button>
        : <GuardedButton unavailable="Freeze a request first. A manual return answers a frozen packet.">Record a manual return</GuardedButton>}
      <p className="hqr-hint">For work that came back outside HQ. It is saved once, labelled owner-reported, and never counts as observed or verified.</p>
    </div>
    <Presence show={open && target !== null} motion="collapse">
      <form id={bodyId} className="hqr-manual-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {targets.length > 1 && <label className="hqr-field">Request
          <select value={target?.id ?? ''} onChange={(event) => setChosenId(event.target.value)}>
            {targets.map((item) => <option key={item.id} value={item.id}>{requestTitle(item.session.state)}</option>)}
          </select>
        </label>}
        <label className="hqr-field">What came back (one statement per line)
          <textarea rows={3} value={claims} disabled={hold !== null} onChange={(event) => setClaims(event.target.value)} />
        </label>
        <label className="hqr-field">Artifact note (optional)
          <input value={artifact} disabled={hold !== null} maxLength={300} onChange={(event) => setArtifact(event.target.value)} />
        </label>
        <div className="hqr-inline">
          <GuardedButton type="submit" variant="primary" unavailable={submitReason}>
            {head ? `Record manual return for packet #${head.lineage.sequence}` : 'Record manual return'}
          </GuardedButton>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Presence>
  </div>;
}
