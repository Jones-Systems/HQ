import { StatusChip } from '@hq/ui';
import { useSyncExternalStore } from 'react';
import type { NavigationPort } from '../../../requests/src/contract.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import type { DestinationOffer } from '../../../requests/ui/DraftEditor.tsx';
import { RequestsView } from '../../../requests/ui/RequestsView.tsx';
import { SIMULATED_DESTINATION, SIMULATION_LABEL } from '../runs/pipeline.ts';
import type { RequestsEnvironment } from './env.ts';
import { ReturnChips } from './ReturnChips.tsx';
import './request-page.css';

export interface RequestsSectionProps {
  readonly env: RequestsEnvironment;
  readonly session: RequestSession;
  readonly navigation?: NavigationPort;
  /** The unbridged example workspace: the labelled simulated destination is offered, and nothing else is. */
  readonly example?: boolean;
  /** A readable name for a source version, from the project's saved versions. */
  readonly sourceLabel?: (versionId: string) => string | null;
  /** Put the cursor in the title, for a request that was just created. */
  readonly focusTitle?: boolean;
  /** Takes the owner to the Returned tab. */
  readonly onOpenReturned?: () => void;
}

const SIMULATION_OFFER: DestinationOffer = {
  destination: SIMULATED_DESTINATION,
  buttonLabel: 'Choose simulated destination',
  note: 'Simulation only: nothing is sent or run. Runs can then simulate returned work for this request.',
};

export function RequestsSection({ env, session, navigation, example = false, sourceLabel, focusTitle = false, onOpenReturned }: RequestsSectionProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  return <section className="hqd-request-section" aria-label="Requests">
    <div className="hqd-section-notice" role="note"><StatusChip tone="info" label={example ? 'Simulation' : 'Connection'} /><p>{example
      ? `${SIMULATION_LABEL}. Frozen packets can be simulated from Runs.`
      : 'Prepare a request here. Runs shows the connected destination and requires an explicit confirmation to send.'}</p></div>
    {state.candidates.length > 0 && <ReturnChips candidates={state.candidates} />}
    <RequestsView session={session} CompareSlot={env.compareSlot} newId={env.newId}
      dispatch={null} navigation={navigation} now={env.clock.now()}
      showReturns={onOpenReturned === undefined} showRuns={false} onOpenReturned={onOpenReturned}
      destinationOffer={example ? SIMULATION_OFFER : null} simulationLabel={SIMULATION_LABEL}
      sourceLabel={sourceLabel} focusTitle={focusTitle} />
  </section>;
}
