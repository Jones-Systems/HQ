import { Button, StatusChip, useToast } from '@hq/ui';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ConnectorPanelHost } from '../../../connector/src/ConnectorPanel.ts';
import type { DecisionPacket, PacketId } from '../../../requests/src/contract.ts';
import type { HandoffView } from '../../../requests/src/handoff.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import { GuardedButton } from '../../../requests/ui/GuardedButton.tsx';
import { RunsView } from '../../../requests/ui/RunsView.tsx';
import '../../../connector/src/connector.css';
import { ReturnChips } from '../requests/ReturnChips.tsx';
import '../requests/request-page.css';
import type { RunsEnvironment } from './env.ts';
import { SIMULATION_LABEL } from './pipeline.ts';

export interface RunsSectionProps {
  readonly env: RunsEnvironment;
  readonly session: RequestSession;
  readonly now: string;
  /** Takes the owner to Requests: the empty state's action, and where a simulated return is reviewed. */
  readonly onOpenRequests?: () => void;
}

export function RunsSection({ env, session, now, onOpenRequests }: RunsSectionProps) {
  const toast = useToast();
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const connector = useSyncExternalStore(env.controller.subscribe, env.controller.view, env.controller.view);
  const example = env.pipeline.mode === 'example';
  const [busy, setBusy] = useState(false);
  const [openedId, setOpenedId] = useState<PacketId | null>(null);
  const running = useRef(false);
  const waiting = busy || connector.busy;

  /** One action at a time. A failure says what it was and that nothing was sent: none of these actions can send. */
  const act = async (failure: string, action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await action(); } catch (reason) {
      toast.error(failure, { description: `${reason instanceof Error ? reason.message : String(reason)} Nothing was sent.` });
    } finally { running.current = false; setBusy(false); }
  };

  const openPacket = (packet: DecisionPacket) => act("Couldn't open the packet", async () => {
    await env.pipeline.selectPacket(session, packet.packetId);
    setOpenedId(packet.packetId);
  });

  const simulate = () => act("Couldn't simulate returned work", async () => {
    const dispatchId = connector.status?.dispatchId;
    if (!dispatchId) return;
    const id = toast.loading('Simulating returned work…', { description: 'Simulation only. Nothing is sent or run.' });
    try {
      const returned = await env.pipeline.simulateReturn(session, dispatchId);
      if (returned) {
        toast.show({
          id, tone: 'success', title: 'Simulated return recorded',
          description: 'Simulation only: nothing was sent or run, and it is not native verification. Review it in Requests, under Returned.',
          ...(onOpenRequests ? { action: { label: 'Open Requests', onAction: onOpenRequests } } : {}),
        });
      } else {
        toast.show({
          id, tone: 'warning', title: 'No simulated return was added',
          description: 'A simulated return needs an accepted simulated send whose host and model match the pin. Nothing was sent.',
        });
      }
    } catch (reason) {
      toast.dismiss(id);
      throw reason;
    }
  });

  const simulateReason = (packet: DecisionPacket): string | null => {
    if (openedId !== packet.packetId) return 'Open this packet first. Simulation works on the packet open in the connector.';
    if (waiting) return 'Wait for the current action to finish.';
    const stage = connector.lifecycle?.stage;
    if (stage === 'queued' && connector.status) return null;
    if (!connector.lifecycle || stage === 'not-sent') return 'Send the packet to the simulated destination first, and confirm it in the connector below.';
    return `Simulation needs a queued simulated send. This one is ${connector.lifecycle.stageLabel.toLowerCase()}.`;
  };

  const actions = (packet: DecisionPacket, _view: HandoffView) => <>
    <GuardedButton variant={openedId === packet.packetId ? 'secondary' : 'primary'} unavailable={waiting ? 'Wait for the current action to finish.' : null}
      onClick={() => { void openPacket(packet); }}>Open packet #{packet.lineage.sequence}</GuardedButton>
    {example && <GuardedButton variant="primary" unavailable={simulateReason(packet)} onClick={() => { void simulate(); }}>Simulate returned work</GuardedButton>}
    {openedId === packet.packetId && <span className="hqr-hint">Open in the connector below.</span>}
  </>;

  return <section className="hqd-request-section" aria-label="Runs">
    <div className="hqd-section-notice" role="note"><StatusChip tone="info" label={example ? 'Simulation' : 'Dispatch'} /><p>{env.pipeline.connectionLabel}. {example ? 'Simulation is not native verification.' : 'Returned claims require independent verification.'}</p></div>
    {state.candidates.length > 0 && <ReturnChips candidates={state.candidates} />}
    {state.packets.length === 0
      ? <div className="hqd-empty-state"><h2>No frozen requests</h2><p>Freeze a request to review its packet here. Opening a packet sends nothing.</p>
        {onOpenRequests && <Button variant="primary" onClick={onOpenRequests}>Open Requests</Button>}</div>
      : <RunsView statusPort={{ read: (link) => env.pipeline.readStatus(session, link.packetId) }} session={session} now={now}
        simulationLabel={SIMULATION_LABEL} openedPacketId={openedId} packetActions={actions} />}
    <ConnectorPanelHost controller={env.controller} />
    <div className="hqd-runs-tools">
      <GuardedButton unavailable={waiting ? 'Wait for the current action to finish.' : null}
        onClick={() => { void act("Couldn't refresh the saved results", () => env.pipeline.refresh(session)); }}>Refresh saved results</GuardedButton>
    </div>
  </section>;
}
