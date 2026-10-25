export const SCENARIOS = Object.freeze([
  'work-service-replay', 'work-restart-without-intent', 'social-save-and-unknown',
  'reference-round-trips', 'wiki-committed-corpus', 'unavailable-service-ui',
  'import-export', 'capability-closure', 'preview-qualification', 'component-containment',
  'new-thread-qualification', 'integrated-scenario-catalog',
  'local-folder-source', 'remote-gallery-source', 'remote-gallery-distinct-host',
]);
export const SELECTED_SCENARIOS = Object.freeze(['work-service-replay', 'work-restart-without-intent', 'local-folder-source', 'remote-gallery-source']);
const statuses = new Set(['pass', 'fail', 'gap', 'held', 'unmeasured']);
export function row(id, status, prerequisites, evidence = []) {
  if (!statuses.has(status) || !Array.isArray(prerequisites) || !prerequisites.length) throw new Error('Invalid result row');
  if (status === 'pass' && (!evidence.length || prerequisites.some(p => p.status !== 'pass'))) throw new Error('Pass requires observed evidence and available prerequisites');
  return { id, status, prerequisites, evidence };
}
export function scenarioGaps() {
  return SCENARIOS.map(id => id === 'remote-gallery-distinct-host'
    ? row(id, 'held', [{ id: 'actual-distinct-host-process-and-forward', status: 'held' }], ['HQ-09H: no distinct-host binding supplied for this invocation.'])
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
export function selectedOutcome(rows, { distinctHost = false } = {}) {
  const required = ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart', ...SELECTED_SCENARIOS, ...(distinctHost ? ['remote-gallery-distinct-host'] : [])];
  if (rows.some(r => r.status === 'fail')) return 'failed';
  if (rows.some(r => r.id.startsWith('domain-') && r.status !== 'pass')) return 'platform-or-integration-gap';
  return required.every(id => rows.filter(r => r.id === id).length === 1 && rows.find(r => r.id === id).status === 'pass')
    ? 'selected-passed' : 'platform-or-integration-gap';
}
export function fullOutcome(rows) {
  return new Set(rows.map(r => r.id)).size === rows.length && SCENARIOS.every(id => rows.some(r => r.id === id && r.status === 'pass')) && rows.every(r => r.status === 'pass')
    ? 'passed' : rows.some(r => r.status === 'fail') ? 'failed' : 'platform-or-integration-gap';
}
