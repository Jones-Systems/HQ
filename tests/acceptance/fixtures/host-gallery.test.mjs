import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, until } from '../runtime.mjs';
import { bindHostGallery } from './host-gallery.mjs';
import { startGallery } from './remote-gallery.mjs';
import { validateHostBundle } from './host-gallery-evidence.mjs';
import { POLICY } from '../../../tools/storage/policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const outcome of ['success', 'failure', 'SIGTERM']) {
  test(`host fixture preserves ledger/digests and closes exact scratch after ${outcome}`, async () => {
    const available = await statfs(resolve(here, '../../..'), { bigint: true });
    assert.ok(available.bavail * available.bsize > 16n * 1024n * 1024n, 'Known capacity before synthetic fixture allocation');
    const runtime = await createRuntime(resolve(here, '../../../.t3/acceptance-self-test'));
    let evidenceParent;
    try {
      evidenceParent = await mkdtemp(join(await realpath(resolve(here, '../../../.t3')), 'host-evidence-test-'));
      const peer = await startGallery(runtime);
      const evidence = evidenceParent;
      const child = runtime.spawn(process.execPath, [join(here, 'host-gallery.mjs'), '--serve', runtime.root, evidence], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { errors += data; });
      const ready = await until(() => {
        if (child.exitCode !== null || child.launchError) throw new Error(`Host fixture exited: ${errors}`);
        return output.includes('\n') && JSON.parse(output.split('\n')[0]);
      }, 'host ready');
      assert.equal(ready.event, 'ready');
      assert.equal(ready.pid, child.pid);
      assert.equal(ready.pgid, child.pid, 'runtime.spawn owns a detached process group');
      const get = async route => (await fetch(new URL(route, ready.controlOrigin))).json();
      assert.equal((await fetch(ready.origin + 'registry-export-manifest.json')).status, 200);
      const before = await get('/snapshot');
      assert.equal(before.ledger.length, 1);
      assert.equal(before.ledger[0].sha256, before.digests['registry-export-manifest.json']);
      await fetch(new URL('/mode?value=unavailable', ready.controlOrigin), { method: 'POST' });
      await assert.rejects(fetch(ready.origin + 'registry-export-manifest.json', { signal: AbortSignal.timeout(1000) }));
      assert.deepEqual((await get('/snapshot')).digests, before.digests);
      const binding = join(runtime.root, 'binding.json');
      await writeFile(binding, JSON.stringify({ schema: 'hq-gallery-forward/v1', host: hostname() }));
      await assert.rejects(bindHostGallery(binding), /distinct host/);
      if (outcome === 'SIGTERM') child.kill('SIGTERM');
      else {
        const operation = async () => {
          try { if (outcome === 'failure') throw new Error('deliberate first failure'); }
          finally { child.stdin.end(); }
        };
        if (outcome === 'failure') await assert.rejects(operation, /deliberate first failure/);
        else await operation();
      }
      await child.done;
      assert.equal(child.exitCode, 0, errors);
      const closed = JSON.parse(output.trim().split('\n').at(-1));
      assert.equal(closed.event, 'closed');
      const bundle = await validateHostBundle(closed, { parent: evidenceParent, runId: ready.runId, source: ready.source, closureBytes: POLICY.evidenceClosureBytes });
      const report = bundle.value;
      for (const key of ['runId', 'host', 'pid', 'pgid']) assert.equal(report[key], ready[key], `report identity ${key}`);
      assert.equal(report.cleanup.rootAbsent, true);
      assert.equal(report.cleanup.remainingChildren, 0);
      assert.deepEqual(report.finalDigests, before.digests);
      assert.equal(report.ledger[0].sha256, before.ledger[0].sha256);
      await assert.rejects(access(ready.root), { code: 'ENOENT' });
      assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
      assert.equal((await fetch(peer.origin + 'registry-export-manifest.json')).status, 200);
    } finally {
      try { await runtime.close(); }
      finally { if (evidenceParent) { await rm(evidenceParent, { recursive: true, force: true }); await assert.rejects(access(evidenceParent), { code: 'ENOENT' }); } }
    }
  });
}
