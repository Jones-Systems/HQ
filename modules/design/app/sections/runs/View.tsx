import { Button, StatusChip } from '@hq/ui';
import { useState, useSyncExternalStore } from 'react';
import { ConnectorPanelHost } from '../../../connector/src/ConnectorPanel.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import { RunsView } from '../../../requests/ui/RunsView.tsx';
import '../../../connector/src/connector.css';
import type { RunsEnvironment } from './env.ts';
import { returnCounts } from './pipeline.ts';

export interface RunsSectionProps {
  readonly env: RunsEnvironment;
  readonly session: RequestSession;
  readonly now: string;
}

export function RunsSection({ env, session, now }: RunsSectionProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const view = useSyncExternalStore(env.controller.subscribe, env.controller.view, env.controller.view);
  const counts = returnCounts(state.candidates);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    void action().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return <section className="hqd-request-section" aria-label="Runs">
    <div className="hqd-section-notice" role="note"><StatusChip tone="info" label={env.pipeline.mode === 'example' ? 'Simulation' : 'Dispatch'} /><p>{env.pipeline.connectionLabel}. {env.pipeline.mode === 'example' ? 'Simulation is not native verification.' : 'Returned claims require independent verification.'}</p></div>
    {error && <p role="alert">{error}</p>}
    {state.packets.length === 0 && <div className="hqd-empty-state"><h2>No frozen requests</h2><p>Freeze a request to review its packet here. Opening a packet sends nothing.</p></div>}
    <ul className="hqd-packet-list" aria-label="Frozen requests">{state.packets.map((packet) => <li key={packet.packetId}>
      <Button disabled={busy || view.busy}
        onClick={() => act(() => env.pipeline.selectPacket(session, packet.packetId))}>Open packet #{packet.lineage.sequence}</Button>
    </li>)}</ul>
    <ConnectorPanelHost controller={env.controller} />
    <div className="hqd-compose-tools">
    <Button disabled={busy || view.busy} onClick={() => act(() => env.pipeline.refresh(session))}>
      Refresh saved results
    </Button>
    {env.pipeline.mode === 'example' && <Button disabled={busy || view.busy || view.lifecycle?.stage !== 'queued'}
      onClick={() => act(async () => {
        if (view.status) await env.pipeline.simulateReturn(session, view.status.dispatchId);
      })}>Simulate returned work</Button>}
    </div>
    <p aria-label="Return provenance">{counts.simulated} simulated returns · {counts.agentReported} agent-reported returns · {counts.ownerReported} owner-reported returns · {counts.realVerified} natively verified returns.</p>
    <RunsView statusPort={{ read: (link) => env.pipeline.readStatus(session, link.packetId) }} session={session} now={now} />
  </section>;
}
