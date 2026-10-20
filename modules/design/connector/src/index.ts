/**
 * Design connector public entry. Root composes it through injected ports:
 * an OutboxStorePort/EvidenceStorePort (StoragePort `workspace` documents),
 * a TransportRegistry (only the labelled fake today), a Clock and the host
 * catalog. The labelled fakes live in fakes.ts and are never
 * re-exported here, so production composition cannot pick them up by accident.
 */

export type { Digest } from './canonical.ts';
export { canonicalJson, digestOf, isDigest } from './canonical.ts';
export type * from './ids.ts';
export { brandId, parseId } from './ids.ts';
export type * from './contract.ts';
export { HANDOFF_SCHEMA } from './contract.ts';
export type * from './route-fence.ts';
export { bindingVariances, collectRouteSources, createRouteSwitchAcknowledgement, evaluateRouteFence, parseManualHandoffRecord, pinnedRouteOf, routeDrift, routeSourceKey, selectedRouteOf, ROUTE_SWITCH_REASON } from './route-fence.ts';
export type * from './lifecycle.ts';
export { LIFECYCLE_STAGES, dispatchLifecycle } from './lifecycle.ts';
export type * from './evidence-feed.ts';
export { createLifecycleReader, readbackEvidence } from './evidence-feed.ts';
export type * from './host-catalog.ts';
export { HOST_CATALOG_SCHEMA, acknowledgeIdentity, findDestination, mergeHostCatalog, parseHostCatalog } from './host-catalog.ts';
export type * from './dispatch.ts';
export { DISPATCH_SCHEMA, canTransition, hasEffect, isNoEffect, isUnresolved, latestAttempt } from './dispatch.ts';
export type * from './eligibility.ts';
export { FAKE_RECEIVER_LABEL, NEW_THREAD_REASON, REAL_JONES_NOT_QUALIFIED_REASON, evaluateDestination } from './eligibility.ts';
export type * from './confirmation.ts';
export { createConfirmation } from './confirmation.ts';
export type * from './outbox.ts';
export { createOutbox } from './outbox.ts';
export type * from './evidence.ts';
export { RESULT_EVIDENCE_SCHEMA, intakeEvidence, parseResultEvidence } from './evidence.ts';
export type * from './view-model.ts';
export { destinationRows, dispatchStatus, evidenceRow, lifecycleView, newThreadControl, routeView } from './view-model.ts';
export type * from './controller.ts';
export { createConnectorController } from './controller.ts';
export type { ConnectorPanelProps } from './ConnectorPanel.ts';
export { ConnectorPanel, ConnectorPanelHost } from './ConnectorPanel.ts';
