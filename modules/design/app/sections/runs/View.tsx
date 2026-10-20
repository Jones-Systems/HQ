import { useState, useSyncExternalStore } from 'react';
import { ConnectorPanelHost } from '../../../connector/src/ConnectorPanel.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import { RunsView } from '../../../requests/ui/RunsView.tsx';
import '../../../connector/src/connector.css';
import type { RunsEnvironment } from './env.ts';
import { SIMULATION_LABEL } from './pipeline.ts';

export interface RunsSectionProps {
  readonly env: RunsEnvironment;
  readonly session: RequestSession;
  readonly now: string;
}

export function RunsSection({ env, session, now }: RunsSectionProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const view = useSyncExternalStore(env.controller.subscribe, env.controller.view, env.controller.view);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    void action().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return <section aria-label="Runs">
    <p role="note">{SIMULATION_LABEL}. No real destination is connected. Simulation is not native verification.</p>
    {error && <p role="alert">{error}</p>}
    <ul aria-label="Frozen requests">{state.packets.map((packet) => <li key={packet.packetId}>
      <button type="button" disabled={busy || view.busy}
        onClick={() => act(() => env.pipeline.selectPacket(session, packet.packetId))}>Open packet #{packet.lineage.sequence}</button>
    </li>)}</ul>
    <ConnectorPanelHost controller={env.controller} />
    <button type="button" disabled={busy || view.busy} onClick={() => act(() => env.pipeline.refresh(session))}>
      Refresh saved results
    </button>
    <button type="button" disabled={busy || view.busy || view.lifecycle?.stage !== 'queued'}
      onClick={() => act(async () => {
        if (view.status) await env.pipeline.simulateReturn(session, view.status.dispatchId);
      })}>Simulate returned work</button>
    <RunsView session={session} now={now} />
  </section>;
}
