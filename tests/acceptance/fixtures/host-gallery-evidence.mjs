import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectStorage, requireAdmission, settings } from '../../../tools/storage/admission.mjs';
import { openEvidenceRun } from '../evidence.mjs';

export const worktree = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MiB = 1024 ** 2;

// Closed observations are data, never a transferable writer/lock capability.
export async function inspectReceiver({ worktree, parent, scratchParent }, options = {}) {
  const snapshot = await inspectStorage({ worktree, roots: [
    { kind: 'evidence', path: parent }, { kind: 'scratch', path: scratchParent },
  ] }, { testContext: options.testContext });
  requireAdmission(snapshot, settings(options.testContext).policy);
  return { schema: 'hq-gallery-admission/v1', snapshot, policy: settings(options.testContext).policy };
}

async function closedFile(filename, maximum) {
  const fd = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink === 1n &&
      !(before.mode & 0o077n) && before.size <= BigInt(maximum), 'Private bounded regular evidence required');
    const digest = createHash('sha256');
    const chunks = []; let bytes = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - bytes));
      const read = await fd.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      assert.ok(bytes <= maximum, 'Closed evidence grew beyond bound');
      const chunk = buffer.subarray(0, read.bytesRead); digest.update(chunk); chunks.push(chunk);
    }
    const after = await fd.stat({ bigint: true });
    const entry = await fs.lstat(filename, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      assert.equal(after[key], before[key], 'Closed file changed'); assert.equal(entry[key], before[key], 'Closed path changed');
    }
    return { path: filename, bytes, sha256: digest.digest('hex'), value: JSON.parse(Buffer.concat(chunks).toString()) };
  } finally { await fd.close(); }
}

export async function validateHostBundle(bundle, expected) {
  assert.equal(bundle.schema, 'hq-gallery-closed/v1');
  for (const key of ['runId', 'source', 'parent']) assert.equal(bundle[key], expected[key], `Closed ${key}`);
  assert.equal(await fs.realpath(bundle.parent), bundle.parent);
  const directory = path.join(bundle.parent, bundle.runId);
  assert.equal(await fs.realpath(directory), directory);
  const stat = await fs.lstat(directory);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'Private evidence run required');
  for (const name of ['report', 'closure']) {
    const fact = bundle[name];
    assert.equal(fact.path, path.join(directory, name === 'report' ? 'report.json' : '.closure.json'));
    const actual = await closedFile(fact.path, name === 'report' ? MiB : expected.closureBytes);
    assert.equal(actual.bytes, fact.bytes); assert.equal(actual.sha256, fact.sha256);
    if (name === 'report') {
      assert.equal(actual.value.runId, expected.runId);
      assert.equal(actual.value.source, expected.source);
      bundle = { ...bundle, value: actual.value };
    } else assert.equal(actual.value.format, 'hq.evidence-closure/v1');
  }
  return bundle;
}

export async function openHostEvidence({ parent, scratchParent, source, runId = `host-${randomUUID()}`, worktree: root = worktree }, options = {}) {
  const admission = await inspectReceiver({ worktree: root, parent, scratchParent }, options);
  const writer = await openEvidenceRun({ worktree: root, parent, runId }, options);
  let closed;
  return { runId, source, admission, directory: writer.directory,
    close(report) {
      return closed ??= (async () => {
        let failure;
        try {
          const bytes = Buffer.from(JSON.stringify({ ...report, runId, source }) + '\n');
          if (bytes.length > MiB) throw new Error('Host report document limit exceeded');
          await writer.write('report.json', bytes);
        } catch (error) { failure = error; }
        const result = await writer.close({ code: failure || report.error || report.cleanupError || report.digestError ? 1 : 0, signal: null });
        if (failure) throw failure;
        const reportFact = await closedFile(path.join(writer.directory, 'report.json'), MiB);
        const closureFact = await closedFile(path.join(writer.directory, '.closure.json'), admission.policy.evidenceClosureBytes);
        const fact = ({ path, bytes, sha256 }) => ({ path, bytes, sha256 });
        return { schema: 'hq-gallery-closed/v1', runId, source, parent: admission.snapshot.roots[0].path,
          report: fact(reportFact), closure: fact(closureFact), result };
      })();
    },
  };
}

// The qualifier invokes this read-only admission endpoint before allocating its
// independent Python owner. No Node lock is acquired or exported here.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--inspect') throw new Error('Use --inspect with a bounded JSON plan on stdin');
  let bytes = 0, input = '';
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 65536) throw new Error('Admission request limit exceeded'); input += chunk;
  }
  const plan = JSON.parse(input);
  for (const key of Object.keys(plan)) assert.ok(['worktree', 'parent', 'scratchParent'].includes(key));
  console.log(JSON.stringify(await inspectReceiver(plan)));
}
