export const SCENARIOS = Object.freeze([
  'work-service-replay', 'work-restart-without-intent', 'social-save-and-unknown',
  'reference-round-trips', 'wiki-committed-corpus', 'unavailable-service-ui',
  'import-export', 'capability-closure', 'preview-qualification', 'component-containment',
  'new-thread-qualification', 'integrated-scenario-catalog',
  'local-folder-source', 'remote-gallery-source', 'remote-gallery-distinct-host',
]);
export const SELECTED_SCENARIOS = Object.freeze(['work-service-replay', 'work-restart-without-intent', 'local-folder-source', 'remote-gallery-source']);
// Four routine journeys: shell launch/domain/restart plus these three stateful rows.
export const ROUTINE_SCENARIOS = Object.freeze(['work-service-replay', 'work-restart-without-intent', 'remote-gallery-source']);
const SHELL_ROWS = ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart'];
const statuses = new Set(['pass', 'fail', 'gap', 'held', 'unmeasured']);
export function row(id, status, prerequisites, evidence = []) {
  if (!statuses.has(status) || !Array.isArray(prerequisites) || !prerequisites.length) throw new Error('Invalid result row');
  if (status === 'pass' && (!evidence.length || prerequisites.some(p => p.status !== 'pass'))) throw new Error('Pass requires observed evidence and available prerequisites');
  return { id, status, prerequisites, evidence };
}
export function scenarioGaps() {
  return SCENARIOS.map(id => id === 'remote-gallery-distinct-host'
    ? row(id, 'held', [{ id: 'actual-distinct-host-process-and-forward', status: 'held' }], ['HQ-09H: no distinct-host binding supplied for this invocation.'])
    : id === 'local-folder-source'
      ? row(id, 'held', [{ id: 'rendered-thumbnail-binding', status: 'held' }], ['HQ-07: displayed image and native chooser remain release obligations; catalog.preview bytes alone cannot pass this row.'])
    : SELECTED_SCENARIOS.includes(id)
      ? row(id, 'unmeasured', [{ id: 'selected-native-execution', status: 'unmeasured' }], ['Scenario source exists; this invocation has not measured it.'])
      : row(id, 'gap', [{ id: 'integrated-scenario-implementation-and-binding', status: 'gap' }],
        ['Outside the selected HQ-02/03/07/09 catalog; integrated acceptance remains open.']));
}
export function replaceRow(rows, result) {
  const indexes = rows.flatMap((value, index) => value.id === result.id ? [index] : []);
  if (indexes.length > 1) throw new Error(`Duplicate result row: ${result.id}`);
  if (indexes.length) rows[indexes[0]] = result;
  else rows.push(result);
}
function subsetOutcome(rows, required, success) {
  if (rows.some(r => r.status === 'fail') || new Set(rows.map(r => r.id)).size !== rows.length) return 'failed';
  if (rows.some(r => r.id.startsWith('domain-') && r.status !== 'pass')) return 'platform-or-integration-gap';
  return required.every(id => rows.some(r => r.id === id && r.status === 'pass'))
    ? success : 'platform-or-integration-gap';
}
export function routineOutcome(rows) {
  return subsetOutcome(rows, [...SHELL_ROWS, ...ROUTINE_SCENARIOS], 'routine-passed');
}
export function selectedOutcome(rows, { distinctHost = false } = {}) {
  return subsetOutcome(rows, [...SHELL_ROWS, ...SELECTED_SCENARIOS, ...(distinctHost ? ['remote-gallery-distinct-host'] : [])], 'selected-passed');
}
export function fullOutcome(rows) {
  return new Set(rows.map(r => r.id)).size === rows.length && SCENARIOS.every(id => rows.some(r => r.id === id && r.status === 'pass')) && rows.every(r => r.status === 'pass')
    ? 'passed' : rows.some(r => r.status === 'fail') ? 'failed' : 'platform-or-integration-gap';
}
