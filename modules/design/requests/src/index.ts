/** Public entry for the HQ Design requests section (T6 / HQD-05). */
export type * from './contract.ts';
export {
  ANNOTATION_KINDS, CLAIM_LEVELS, DRAFT_PRIVACY, DRAFT_SCHEMA, EXPORT_SCHEMA, FREEZE_SCHEMA, HANDOFF_STATES, HANDOFF_STATUS_SCHEMA,
  OWNER_REPORTED_EVIDENCE_KINDS, OWNER_REPORTED_STATUS, PACKET_SCHEMA, RETURN_ORIGINS, REVIEW_DECISIONS, REVIEW_EVENT_SCHEMA, SEND_SCHEMA,
} from './contract.ts';
export {
  HANDOFF_LABELS, STALE_AFTER_MS, TERMINAL_STATES, acceptStatus, freshnessOf, handoffView, hostModelVariance,
  type Freshness, type HandoffView, type HandoffViewInput, type HostModelVariance,
} from './handoff.ts';
export { inboxOf, unreviewedCount, type InboxItem } from './inbox.ts';
export { navigate } from './intents.ts';
export { applyEdit, contentOf, continuationOf, freezeBlockers, linkOf, newDraft, openClarifications, revisionOf, type DraftEdit } from './draft.ts';
export { buildPacket, verifyPacket } from './packet.ts';
export { canonicalBytes, canonicalize, digestOf, sha256 } from './jcs.ts';
export { reviewCandidate, CLAIM_LEVEL_LABELS, type CandidateReview, type ReviewedClaim } from './review.ts';
export { exportRequests, type OmittedStore, type RequestsExport } from './export.ts';
export {
  FreezeBlockedError, FreezeConflictError, OutcomeUnknownError, ReadOnlyRequestError, RequestStore, SendBlockedError, StaleDraftError,
  type FreezeResult, type RequestSnapshot, type RequestStorePorts, type ReviewResult,
} from './store.ts';
export { RequestSession, type SaveStatus, type SessionOptions, type SessionState } from './session.ts';
export {
  UnsupportedSchemaError, ValidationError, brandId, parseHandoffStatus, parseNavigationIntent, parsePacket, parseReturnedCandidate,
  parseSendRecord,
} from './validate.ts';

import type { RequestId, SchedulerPort } from './contract.ts';
import { RequestSession as Session } from './session.ts';
import { RequestStore as Store, type RequestStorePorts as StorePorts } from './store.ts';

/** Composition entry for root: one store over injected ports, sessions opened per request. */
export function createRequests(ports: StorePorts & { readonly scheduler: SchedulerPort; readonly debounceMs?: number }) {
  const store = new Store(ports);
  return {
    store,
    open: (requestId: RequestId) => Session.open(store, ports.scheduler, requestId, {
      now: () => ports.clock.now(), ...(ports.debounceMs === undefined ? {} : { debounceMs: ports.debounceMs }),
    }),
  };
}
