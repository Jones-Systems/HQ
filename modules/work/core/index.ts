// Work core public surface for the sibling Work lanes (board, detail, capture,
// views). Consumers import from here, not from the upstream copies directly.

export * from './types';
export * from './port';
export * from './validation';
export * from './planning';
export * from './store';
export { useWorkState, VERSION_POLL_MS } from './hook';
export { createFixturePlanner, MAX_REMEMBERED_REQUESTS, POSITION_STEP, withDerived, type FixtureControl, type FixtureOptions } from './fixtures/adapter';
export { withFaults, type FaultControl, type WriteFault } from './fixtures/faults';
export { EXAMPLE_SETTINGS, exampleItems } from './fixtures/examples';
export {
  HORIZONS, KINDS, MOTIVATIONS, PRIORITIES, REFERENCE_KINDS, STATUSES,
  HORIZON_LABEL, KIND_META, MOTIVATION_LABEL, PRIORITY_LABEL, REFERENCE_LABEL,
} from './upstream/manual-planner/model.js';
export { DATE_KINDS, KIND_LABEL as DATE_KIND_LABEL, PRECISION_LABEL, PRECISIONS } from './upstream/manual-planner/dates.js';
