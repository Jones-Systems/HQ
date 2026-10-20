import { useSyncExternalStore } from 'react';
import type { NavigationPort } from '../../../requests/src/contract.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import { RequestsView } from '../../../requests/ui/RequestsView.tsx';
import { returnCounts, SIMULATED_DESTINATION, SIMULATION_LABEL } from '../runs/pipeline.ts';
import type { RequestsEnvironment } from './env.ts';

export interface RequestsSectionProps {
  readonly env: RequestsEnvironment;
  readonly session: RequestSession;
  readonly navigation?: NavigationPort;
}

export function RequestsSection({ env, session, navigation }: RequestsSectionProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const counts = returnCounts(state.candidates);
  return <section aria-label="Requests">
    <p role="note">{SIMULATION_LABEL}. Frozen packets can be simulated from Runs.</p>
    {state.draft && <button type="button" disabled={!session.editable}
      onClick={() => session.edit({ type: 'set-destination', destination: SIMULATED_DESTINATION })}>
      Choose simulated destination
    </button>}
    <p aria-label="Return provenance">
      {counts.simulated} simulated returns · {counts.ownerReported} owner-reported returns · {counts.realVerified} natively verified returns.
      Owner-reported returns are not native verification.
    </p>
    <RequestsView session={session} CompareSlot={env.compareSlot} newId={env.newId}
      dispatch={null} navigation={navigation} now={env.clock.now()} />
  </section>;
}
