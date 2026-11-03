import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { contains, inspectStorage, requireAdmission, settings } from '../../../tools/storage/admission.mjs';
import { openEvidenceRun, EVIDENCE_COUNTS } from '../evidence.mjs';

export class TraceStorageHeld extends Error {}

/** Cooperating preview writes only; no launcher, native ownership or raw-trace sink. */
export async function openPreviewEvidence({ worktree, parent, scratchParent, report, stopProducer }, options = {}) {
  // Inspect absent destinations before mkdir. Canonical Stage A roots also
  // detect symlinks/custody failures; explicit disjointness survives this first
  // scratch-kind inspection, before the evidence parent's retained scan.
  const snapshot = await inspectStorage({ worktree, roots: [parent, scratchParent].map(path => ({ kind: 'scratch', path })) },
    { testContext: options.testContext });
  const [evidenceRoot, scratchRoot] = snapshot.roots;
  if (!scratchRoot || contains(evidenceRoot.path, scratchRoot.path) || contains(scratchRoot.path, evidenceRoot.path)) {
    throw new Error('Preview evidence and scratch must be disjoint');
  }
  requireAdmission(snapshot, settings(options.testContext).policy);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const writer = await openEvidenceRun({ worktree, parent, runId: `preview-${randomUUID()}` }, options);
  const pending = new Set();
  let failure, stopping, primary, finalized;
  function observeOutcome(outcome) {
    if (outcome.signal || outcome.code) primary ??= outcome;
  }
  function observeChildExit(exit, expected) {
    report.nativeExit = { ...exit, expected };
    if (!expected) {
      report.unexpectedNativeExit = true;
      observeOutcome({ code: exit.error ? 1 : exit.code || (exit.signal ? null : 1), signal: exit.error ? null : exit.signal ?? null });
    }
  }
  function evidenceFailure(error) {
    failure ??= error;
    report.evidenceError ??= String(failure.message).slice(0, 160);
    report.evidenceIncomplete = true;
    report.outcome = 'failed';
    if (!stopping) {
      // The port stops only the runner's already-owned child. Never infer PID
      // ownership here; the existing runtime supplies it. Catch synchronous and
      // asynchronous stop failures without bypassing final cleanup/readbacks.
      stopping = Promise.resolve().then(stopProducer).catch(error => {
        report.evidenceStopError ??= String(error.message).slice(0, 160);
      });
    }
  }
  function submit(filename, bytes, append) {
    if (failure) return Promise.reject(failure);
    // Root enqueue reserves/counts synchronously. In particular, no adapter
    // promise tail can defer submissions past its eight-pending-write bound.
    const operation = append ? writer.append(filename, bytes) : writer.write(filename, bytes);
    if (pending.size >= (options.maxPendingWrites ?? EVIDENCE_COUNTS.pendingWrites)) {
      // The root has already refused this immediate over-limit submission. Do
      // not retain rejected operations in a second, potentially unbounded set.
      evidenceFailure(new Error('Evidence pending-write count exceeded'));
      operation.catch(() => {});
      return operation;
    }
    pending.add(operation);
    operation.then(() => pending.delete(operation), error => { pending.delete(operation); evidenceFailure(error); });
    return operation;
  }
  const write = (filename, bytes) => submit(filename, bytes, false);
  const append = (filename, bytes) => submit(filename, bytes, true).then(() => true, error => { evidenceFailure(error); return false; });
  const drain = async () => { await Promise.allSettled([...pending]); };
  function refuseRawTrace() {
    const reason = 'Q-PV4 storage-held: unbounded raw trace sink unavailable; containment remains unmeasured';
    report.traceStorageHold = reason;
    report.evidenceIncomplete = true;
    throw new TraceStorageHeld(reason);
  }
  function finalize({ cleanup, verify, outcome }) {
    return finalized ??= (async () => {
      const record = async filename => {
        try { await write(filename, JSON.stringify(report, null, 2) + '\n'); }
        catch (error) { evidenceFailure(error); }
      };
      await drain();
      await record('report-before-cleanup.json');
      await stopping;
      try { await cleanup(); }
      catch (error) { report.cleanup = 'failed'; report.cleanupError ??= error.stack; report.outcome = 'failed'; }
      try { await verify(); }
      catch (error) { report.verificationError = error.stack; report.outcome = 'failed'; }
      if (report.cleanup === 'failed' || report.verificationError || report.unexpectedNativeExit) report.outcome = 'failed';
      if (failure) evidenceFailure(failure);
      if (report.traceStorageHold && report.outcome === 'passed') report.outcome = 'partial';
      await record('report.json');
      await drain();
      // A failure discovered while writing the final report can have started a
      // stop port too. Drain it before final closure/unlock, not after return.
      await stopping;
      const desired = primary ?? outcome();
      const result = await writer.close(desired.code === 0 && report.evidenceIncomplete ? { code: 1, signal: null } : desired);
      if (result.incomplete) evidenceFailure(new Error(result.diagnostics.join('; ')));
      await stopping;
      const diagnostics = [...new Set([...result.diagnostics, ...(failure ? [String(failure.message).slice(0, 160)] : [])])];
      return Object.freeze({ ...result, diagnostics, incomplete: result.incomplete || Boolean(report.evidenceIncomplete) });
    })();
  }
  return Object.freeze({ directory: writer.directory, write, append, drain, observeOutcome, observeChildExit, refuseRawTrace, finalize });
}
