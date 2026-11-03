import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { LocalDirectoryAdapter, LOCAL_HOST_ID, type LocalCatalogPort } from '../src/adapters/local-directory.ts';
import { contentDigest, hostId, isoTime, type CatalogSnapshot, type PreviewRef } from '../src/contract.ts';

const snapshot: CatalogSnapshot = { hostId: LOCAL_HOST_ID, generation: 1, complete: true, observedAt: isoTime('2026-10-20T00:00:00.000Z'), entries: [] };
const ref: PreviewRef = { digest: contentDigest(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 1 };

test('local adapter exposes its label and delegates only the fixed host through a structural port', async () => {
  const signal = new AbortController().signal;
  const bytes = new Uint8Array([1]);
  const calls: string[] = [];
  const port: LocalCatalogPort = {
    async snapshot(s) { assert.equal(s, signal); calls.push('snapshot'); return snapshot; },
    async preview(r, s) { assert.equal(s, signal); assert.equal(r, ref); calls.push('preview'); return bytes; },
  };
  const adapter = new LocalDirectoryAdapter(port);
  assert.equal(adapter.label, 'Local directory');
  assert.equal(adapter.qualification, 'qualified');
  assert.equal(adapter.qualificationRef, 'hq.design.local-directory-adapter/v1');
  assert.equal(await adapter.listSnapshot(LOCAL_HOST_ID, signal), snapshot);
  assert.equal(await adapter.readPreview(ref, signal), bytes);
  await assert.rejects(adapter.listSnapshot(hostId('other'), signal), /not supported/);
  assert.deepEqual(calls, ['snapshot', 'preview']);
  const wrong = new LocalDirectoryAdapter({ ...port, async snapshot() { return { ...snapshot, hostId: hostId('other') }; } });
  await assert.rejects(wrong.listSnapshot(LOCAL_HOST_ID, signal), /mismatch/);
});

test('already aborted local adapter calls never invoke the port', async () => {
  let calls = 0;
  const adapter = new LocalDirectoryAdapter({
    async snapshot() { calls++; return snapshot; }, async preview() { calls++; return new Uint8Array(); },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.listSnapshot(LOCAL_HOST_ID, controller.signal), { name: 'AbortError' });
  await assert.rejects(adapter.readPreview(ref, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('mid-flight abort promptly rejects both methods even if the injected transport ignores cancellation', async () => {
  for (const method of ['snapshot', 'preview'] as const) {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const adapter = new LocalDirectoryAdapter({
      snapshot() { entered(); return new Promise(() => {}); },
      preview() { entered(); return new Promise(() => {}); },
    });
    const pending = method === 'snapshot' ? adapter.listSnapshot(LOCAL_HOST_ID, controller.signal) : adapter.readPreview(ref, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
  }
});

test('renderer adapter dependency graph imports no Node builtins or Node implementation', async () => {
  const visited = new Set<string>();
  async function walk(url: URL): Promise<void> {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const text = await readFile(url, 'utf8');
    assert.doesNotMatch(text, /\brequire\s*\(|\bimport\s*\(/u);
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
      const target = match[1]!;
      assert.ok(!target.startsWith('node:') && !builtinModules.includes(target), target);
      assert.ok(!target.includes('/node/'), target);
      assert.ok(target.startsWith('.'), target);
      await walk(new URL(target, url));
    }
  }
  await walk(new URL('../src/adapters/local-directory.ts', import.meta.url));
  assert.equal(visited.size, 2);
});
