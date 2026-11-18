import { useEffect, useMemo, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { NavigationIntent } from '../src/contract.ts';
import { CrashingStorageFake, LifecycleConnectorFake, SequentialIdsFake } from '../src/fakes.ts';
import { createRequests } from '../src/index.ts';
import { brandId } from '../src/validate.ts';
import { CompareSlotFake, RequestsView } from '../ui/RequestsView.tsx';

// Shell tokens the section stylesheet expects (the real shell supplies these).
const style = document.createElement('style');
style.textContent = `
  :root { --surface:#fff; --background:#f6f6f4; --line:#d9d9d4; --text:#1c1c1a; --muted:#6b6b66; --accent:#2f5bd8; --selected:#e6ecfb; }
  body { margin:0; background:var(--background); color:var(--text); font:14px system-ui, sans-serif; }
  .h-wrap { display:grid; gap:16px; padding:20px; max-width:960px; margin:0 auto; }
  .h-bar { border:1px dashed var(--line); border-radius:8px; padding:10px 12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:#fffbe6; }
  .h-bar button { font:inherit; padding:5px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; }
  .h-log { font:12px ui-monospace, monospace; margin:0; padding-left:18px; color:var(--muted); }
`;
document.head.append(style);

const storage = new CrashingStorageFake();
const connector = new LifecycleConnectorFake();
const ids = new SequentialIdsFake('h');
const requests = createRequests({
  storage, ids, clock: { now: () => new Date().toISOString() },
  scheduler: { setTimeout: (callback, ms) => window.setTimeout(callback, ms), clearTimeout: (handle) => window.clearTimeout(handle as number) },
});

const created = await requests.store.createRequest({
  title: 'Tighten the home heading spacing',
  sources: [{ projectId: brandId('demo-project'), viewId: brandId('demo-home'), versionId: brandId('v-a1'), sourceRevision: 'rev-demo-1' }],
});
const session = await requests.open(created.requestId);
session.edit({ type: 'set-intent', intent: 'Reduce the gap above the second heading. Keep the hero unchanged.' });
session.edit({ type: 'set-destination', destination: { kind: 'existing-thread', destinationId: 'demo-thread', label: 'Demo thread (fake)' } });
await session.flush();

function Harness() {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => { const timer = window.setInterval(tick, 400); return () => window.clearInterval(timer); }, []);
  const navigation = useMemo(() => ({ navigate: (intent: NavigationIntent) => setLog((previous) => [...previous, `navigate ${JSON.stringify(intent)}`]) }), []);
  const packet = session.state.packets.at(-1) ?? null;
  const link = packet ? { packetId: packet.packetId, authoringDigest: packet.authoringDigest } : null;
  const act = (name: string, run: () => void) => <button type="button" disabled={!link} onClick={run}>{name}</button>;
  return <div className="h-wrap">
    <div className="h-bar" data-harness="labelled-fake">
      <strong>Harness — labelled fake connector (no real transport)</strong>
      <span>Transport calls: <strong data-testid="sends">{connector.sends.length}</strong></span>
      <span>Status reads: {connector.statusReads.length}</span>
      {act('Connector: queued', () => connector.set(link!, 'queued'))}
      {act('running (host differs)', () => connector.set(link!, 'running', { actual: { host: 'fixture-host-b' } }))}
      {act('returned + publish', () => {
        connector.set(link!, 'returned');
        connector.publishReturn({
          candidateId: 'demo-cand-1', packet: link, baselineVersionId: 'v-a1', candidateVersionId: null,
          claims: [{ claimId: 'demo-claim-1', text: 'Heading gap is now 24px.', level: 'agent-reported', evidence: [] }],
          observedStatus: 'returned', observedAt: new Date().toISOString(),
          evidence: [{ evidenceId: 'demo-art-1', kind: 'capture', label: 'Heading screenshot (synthetic)', digest: 'sha256:demo' }],
          provenance: { origin: 'connector', host: 'fixture-host-b', model: 'fixture-model-1' },
        });
      })}
      {act('Connector: unknown', () => connector.set(link!, 'unknown', { detail: 'Receipt not confirmed.' }))}
    </div>
    <RequestsView session={session} CompareSlot={CompareSlotFake} dispatch={connector.dispatch} statusPort={connector.status}
      returnsPort={connector.returns} navigation={navigation} newId={(kind) => `h-${kind}-${Math.random().toString(36).slice(2, 8)}`} />
    {log.length > 0 && <ol className="h-log" aria-label="Navigation log">{log.map((entry, index) => <li key={index}>{entry}</li>)}</ol>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
