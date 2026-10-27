export const MiB = 1024 ** 2;
export const GiB = 1024 ** 3;

// Provisional, unmeasured limits. Qualification may revise them; low disk space may not.
export const POLICY = Object.freeze({
  reserveBytes: 30 * GiB,
  peakBytes: 10 * GiB,
  compiledBytes: 256 * MiB,
  generatedBytes: 512 * MiB,
  evidenceRunBytes: 128 * MiB,
  evidenceOrdinaryBytes: 120 * MiB,
  evidenceClosureBytes: 8 * MiB,
  artifactBytes: 32 * MiB,
  evidenceParentBytes: 2 * GiB,
  evidenceRuns: 16,
  evidenceReviewDays: 14,
  generatedReviewDays: 30,
  lockTimeoutMs: 5000,
});

export function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Unknown or invalid ${label}`);
  return value;
}

export function sum(...values) {
  return integer(values.reduce((a, b) => a + integer(b, 'byte count'), 0), 'total');
}

export function validatePolicy(policy) {
  for (const key of Object.keys(POLICY)) integer(policy[key], key);
  if (policy.lockTimeoutMs > 5000 || policy.peakBytes === 0 ||
      policy.compiledBytes > policy.generatedBytes ||
      sum(policy.evidenceOrdinaryBytes, policy.evidenceClosureBytes) !== policy.evidenceRunBytes ||
      policy.artifactBytes > policy.evidenceOrdinaryBytes) throw new Error('Invalid storage policy');
  return policy;
}

// The decision seam accepts observations, never performs cleanup, and can be replaced
// by a fleet decision adapter without turning this helper into a persistent ledger.
export function decideStorage(snapshot, policy = POLICY, { prospective = true } = {}) {
  validatePolicy(policy);
  const reasons = [];
  if (!snapshot.filesystems?.length) throw new Error('Unknown receiving filesystems');
  const seen = new Set();
  for (const fs of snapshot.filesystems) {
    if (typeof fs.id !== 'string' || !fs.id || seen.has(fs.id)) throw new Error('Invalid filesystem grouping');
    seen.add(fs.id);
    const available = integer(fs.availableBytes, 'available capacity');
    const required = sum(policy.reserveBytes, prospective ? policy.peakBytes : 0);
    if (available < required) reasons.push(`filesystem ${fs.id}: ${available} available; ${required} required`);
  }
  if (integer(snapshot.compiledBytes, 'compiled occupancy') > policy.compiledBytes) reasons.push('compiled limit exceeded');
  if (integer(snapshot.generatedBytes, 'generated occupancy') > policy.generatedBytes) reasons.push('combined generated limit exceeded');
  for (const parent of snapshot.evidenceParents) {
    const bytes = sum(integer(parent.bytes, 'evidence occupancy'), prospective ? policy.evidenceRunBytes : 0);
    const runs = sum(integer(parent.runs, 'evidence runs'), prospective ? 1 : 0);
    if (bytes > policy.evidenceParentBytes) reasons.push(`evidence byte limit: ${parent.path}`);
    if (runs > policy.evidenceRuns) reasons.push(`evidence run limit: ${parent.path}`);
  }
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) });
}
