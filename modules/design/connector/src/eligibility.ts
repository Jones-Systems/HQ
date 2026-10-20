/**
 * Execution eligibility for one destination. Reachability in the host catalog
 * and source discovery share only HostId; neither makes a destination eligible.
 * There is no fallback: an ineligible destination is reported, never replaced.
 */

import type { TransportPort, TransportRegistry } from './contract.ts';
import type { Destination } from './host-catalog.ts';

export type IneligibleCode =
  | 'new-thread-unavailable'
  | 'transport-not-qualified'
  | 'identity-conflict'
  | 'not-fresh'
  | 'not-reachable';

export type Eligibility =
  | { readonly eligible: true; readonly transport: TransportPort; readonly fake: boolean }
  | { readonly eligible: false; readonly code: IneligibleCode; readonly reason: string };

export const FAKE_RECEIVER_LABEL = 'Labelled fake receiver — not Jones';

export const NEW_THREAD_REASON =
  'New threads are unavailable: launching one needs an idempotent external launch and lookup contract (U1), which is not qualified yet.';

export const REAL_JONES_NOT_QUALIFIED_REASON =
  'Not qualified: the real Jones receiver needs S1 qualification and a public wire contract (HQD-11b) before HQ can send to it.';

/** A transport may carry sends only as a labelled fake or with recorded qualification evidence. */
export function transportQualifies(transport: TransportPort | undefined, kind: Destination['endpoint']['transport']): transport is TransportPort {
  if (!transport || transport.descriptor.kind !== kind) return false;
  const qualification = transport.descriptor.qualification;
  if (qualification.level === 'labelled-fake') return kind === 'fake-receiver' && transport.descriptor.provenance === 'fake';
  if (qualification.level === 'qualified') return qualification.evidenceRef.trim().length > 0;
  return false;
}

export function evaluateDestination(destination: Destination, transports: TransportRegistry): Eligibility {
  if (destination.mode === 'new-thread') {
    return { eligible: false, code: 'new-thread-unavailable', reason: NEW_THREAD_REASON };
  }
  const transport = transports[destination.endpoint.transport];
  if (!transportQualifies(transport, destination.endpoint.transport)) {
    return {
      eligible: false,
      code: 'transport-not-qualified',
      reason: destination.endpoint.transport === 'jones-code'
        ? REAL_JONES_NOT_QUALIFIED_REASON
        : 'Not qualified: no labelled receiver is registered for this destination.',
    };
  }
  if (destination.identityConflict) {
    return {
      eligible: false,
      code: 'identity-conflict',
      reason: 'Blocked: this destination reported a different identity. Review and acknowledge it before sending.',
    };
  }
  if (destination.freshness.status !== 'fresh') {
    return { eligible: false, code: 'not-fresh', reason: `Blocked: destination information is ${destination.freshness.status}.` };
  }
  if (destination.status !== 'reachable') {
    return { eligible: false, code: 'not-reachable', reason: `Blocked: destination is ${destination.status}.` };
  }
  return { eligible: true, transport, fake: transport.descriptor.qualification.level === 'labelled-fake' };
}
