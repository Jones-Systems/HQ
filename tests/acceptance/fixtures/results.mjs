export const SCENARIOS = Object.freeze([
  'work-service-replay', 'work-restart-without-intent', 'social-save-and-unknown',
  'reference-round-trips', 'wiki-committed-corpus', 'unavailable-service-ui',
  'import-export', 'capability-closure', 'preview-qualification', 'component-containment',
  'new-thread-qualification', 'integrated-scenario-catalog',
]);
const statuses = new Set(['pass', 'fail', 'gap', 'held', 'unmeasured']);
export function row(id, status, prerequisites, evidence = []) {
  if (!statuses.has(status) || !Array.isArray(prerequisites) || !prerequisites.length) throw new Error('Invalid result row');
  if (status === 'pass' && (!evidence.length || prerequisites.some(p => p.status !== 'pass'))) throw new Error('Pass requires observed evidence and available prerequisites');
  return { id, status, prerequisites, evidence };
}
export function scenarioGaps() {
  return SCENARIOS.map(id => row(id, 'gap', [{ id: 'integrated-scenario-implementation-and-binding', status: 'gap' }],
    ['Not implemented by acceptance-infrastructure; requires separately authorized integrated scenarios.']));
}
export function fullOutcome(rows) {
  return SCENARIOS.every(id => rows.some(r => r.id === id && r.status === 'pass')) && rows.every(r => r.status === 'pass')
    ? 'passed' : rows.some(r => r.status === 'fail') ? 'failed' : 'platform-or-integration-gap';
}
