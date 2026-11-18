import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectStorage, requireAdmission, settings } from '../../tools/storage/admission.mjs';
import { openEvidenceRun } from './evidence.mjs';

/** Admit before creating either parent; runtime.mjs still owns runtime scratch.
 * Only runner-owned disk artifacts pass through this cooperating-writer bound.
 * No launcher nesting, fixture-write quota or CDP in-memory bound is implied.
 */
export async function openRunnerEvidence({ worktree, parent, scratchParent, signal }, options = {}) {
  signal?.throwIfAborted();
  // Scratch-kind inspection permits absent parents while measuring their actual
  // receiving filesystems. openEvidenceRun then accounts retained evidence too.
  const plan = { worktree, roots: [parent, scratchParent].map(path => ({ kind: 'scratch', path })) };
  const snapshot = await inspectStorage(plan, { testContext: options.testContext });
  requireAdmission(snapshot, settings(options.testContext).policy);
  signal?.throwIfAborted();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const writer = await openEvidenceRun({ worktree, parent, runId: `run-${randomUUID()}`, signal }, options);
  let failure;
  let finalized;
  async function write(filename, bytes) {
    try { return await writer.write(filename, bytes); }
    catch (error) { failure ??= error; throw error; }
  }
  function finalize({ report, log, cleanup, verify, primary }) {
    return finalized ??= (async () => {
      const evidenceFailure = error => {
        failure ??= error;
        report.evidenceError ??= String(failure.message);
        report.evidenceIncomplete = true;
        if (report.outcome !== 'cancelled') report.outcome = 'failed';
      };
      const record = async (filename, bytes) => {
        try { await write(filename, bytes()); } catch (error) { evidenceFailure(error); }
      };
      if (failure) evidenceFailure(failure);
      await record('report-before-cleanup.json', () => JSON.stringify(report, null, 2) + '\n');
      await record('runtime-before-cleanup.log', log);
      // Evidence/serialization failure must never bypass either cleanup or the
      // service/build/source oracles that follow it. Their callbacks stay owned
      // by run.mjs and execute even when an earlier callback throws.
      try { await cleanup(); }
      catch (error) { report.cleanup = 'failed'; report.cleanupError = error.message; report.outcome = 'failed'; }
      try { await verify(); }
      catch (error) { report.verificationError = error.message; report.outcome = 'failed'; }
      await record('runtime.log', log);
      await record('report.json', () => JSON.stringify(report, null, 2) + '\n');
      const result = await writer.close(primary());
      if (result.incomplete) evidenceFailure(new Error(result.diagnostics.join('; ')));
      return Object.freeze({ ...result, incomplete: result.incomplete || Boolean(failure) });
    })();
  }
  return Object.freeze({ directory: writer.directory, write, finalize });
}
