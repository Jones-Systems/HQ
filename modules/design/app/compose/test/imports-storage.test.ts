import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DesignBridgeError } from '../bridge-documents.ts';
import { classifyDesignError, DesignOperationError } from '../errors.ts';
import {
  commitOperation, createImportsBridgeStorage, exportUnavailable, IMPORTS_CONTEXTS, typeImportsStorage, type ImportsCommitLink,
} from '../imports-storage.ts';
import { StorageConflictError, sha256Digest, type WriteOp } from '../../../imports/src/contract.ts';
import { planImport, type ImportPlan } from '../../../imports/src/importer.ts';
import { importSourceFromFiles } from '../imports-pick.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { createImportsDouble } from './imports-bridge-double.ts';

const DIGEST = sha256Digest(`sha256:${'a'.repeat(64)}`);
const clock = { now: () => '2026-11-03T12:00:00.000Z' };
const doc = (key: string, value: unknown, expectedRevision: string | null = null): WriteOp =>
  ({ op: 'put-document', namespace: 'workspace', key, value: value as never, expectedRevision });
const event = (type: string, expectedSeq = 0): WriteOp => ({ op: 'append-event', namespace: 'workspace', stream: 'imports', payload: { type }, expectedSeq });
function setup(link?: ImportsCommitLink) {
  const double = createImportsDouble();
  const storage = createImportsBridgeStorage({ transport: double.transport, ...(link ? { link } : {}) });
  return { double, storage, typed: typeImportsStorage(storage) };
}
const files = (...names: string[]) => importSourceFromFiles(names.map((name, index) => ({ name, mediaType: 'image/png' as const, bytes: syntheticPng(index + 1, 12 + index, 8) })));

describe('imports storage over the bridge: mapping', () => {
  it('maps imports keys and the imports stream to the Design host and back, with decimal string revisions', async () => {
    const { double, storage } = setup();
    assert.deepEqual(await storage.namespaces(), [{ name: 'workspace', class: 'workspace' }]);
    assert.equal(await storage.getDocument('workspace', 'imports/records/rec_a'), null);
    await storage.commit([doc('imports/records/rec_a', { n: 1 }), doc('imports/manifests/imp_a', { m: 1 }), event('import.applied')]);
    assert.deepEqual(double.commits[0]!.ops.map((op) => op.op === 'put-document' ? op.key : op.op === 'append-event' ? op.stream : op.op),
      ['design/imports/records/rec_a', 'design/imports/manifests/imp_a', 'design/imports']);
    const stored = await storage.getDocument('workspace', 'imports/records/rec_a');
    assert.deepEqual(stored, { key: 'imports/records/rec_a', value: { n: 1 }, revision: '1' });
    assert.equal(typeof stored!.revision, 'string');
    assert.deepEqual(double.calls.find((call) => call.route === 'doc.get')!.params, { key: 'design/imports/records/rec_a' });
    await storage.commit([doc('imports/records/rec_a', { n: 2 }, '1'), event('import.undone', 1)]);
    assert.equal((await storage.getDocument('workspace', 'imports/records/rec_a'))!.revision, '2');
  });

  it('lists a prefix sorted by key with the imports key names, and reads the journal in order', async () => {
    const { double, storage } = setup();
    await storage.commit([doc('imports/manifests/imp_b', { b: 1 }), doc('imports/manifests/imp_a', { a: 1 }), doc('imports/undo/imp_a', { u: 1 }), event('import.applied')]);
    await storage.commit([event('import.undone', 1)]);
    assert.deepEqual((await storage.listDocuments('workspace', 'imports/manifests/')).map((item) => [item.key, item.revision]),
      [['imports/manifests/imp_a', '1'], ['imports/manifests/imp_b', '1']]);
    assert.deepEqual(double.calls.find((call) => call.route === 'doc.list')!.params, { prefix: 'design/imports/manifests/' });
    assert.deepEqual(await storage.readEvents('workspace', 'imports'), [{ seq: 1, payload: { type: 'import.applied' } }, { seq: 2, payload: { type: 'import.undone' } }]);
    assert.deepEqual(double.calls.find((call) => call.route === 'event.read')!.params, { stream: 'design/imports' });
    assert.deepEqual(await storage.readEvents('workspace', 'imports').then((events) => events.map((item) => item.seq)), [1, 2]);
  });

  it('refuses other namespaces, keys outside imports, other streams and a non-decimal revision before any call', async () => {
    const { double, storage } = setup();
    const refused: (() => Promise<unknown>)[] = [
      () => storage.getDocument('draft', 'imports/records/x'), () => storage.getDocument('workspace', 'design/projects/x'),
      () => storage.readEvents('workspace', 'requests'), () => storage.hasBlob!('draft', DIGEST),
      () => storage.commit([{ ...doc('imports/records/x', {}), namespace: 'draft' }]),
      () => storage.commit([doc('imports/records/x', {}, '01')]), () => storage.commit([doc('imports/records/x', {}, 'abc')]),
      () => storage.commit([doc('design/projects/x', {})]), () => storage.commit([]),
      () => storage.commit([{ op: 'append-event', namespace: 'workspace', stream: 'other', payload: {}, expectedSeq: 0 }]),
      () => storage.commit([{ op: 'append-event', namespace: 'workspace', stream: 'imports', payload: {}, expectedSeq: -1 }]),
    ];
    for (const run of refused) await assert.rejects(run, (error) => error instanceof DesignBridgeError && error.kind === 'invalid');
    assert.equal(double.calls.length, 0, 'nothing reached the transport');
  });

  it('puts blobs through the batch as copies and answers hasBlob and getBlob from the host, verifying the digest', async () => {
    const { double, storage } = setup();
    const source = files('home.png');
    const png = (source.items[0]!.payload as { bytes: Uint8Array }).bytes;
    const plan = await planImport({ storage, clock }, { projectId: 'proj-a' as never, source }) as ImportPlan;
    assert.equal(plan.ok, true);
    const blob = plan.ops.find((op) => op.op === 'put-blob') as Extract<WriteOp, { op: 'put-blob' }>;
    await storage.commit(plan.ops);
    const sent = double.commits[0]!.ops.find((op) => op.op === 'put-blob') as Extract<typeof double.commits[0]['ops'][number], { op: 'put-blob' }>;
    assert.deepEqual(sent.bytes, png);
    assert.equal(await storage.hasBlob!('workspace', blob.digest), true);
    assert.equal(await storage.hasBlob!('workspace', DIGEST), false);
    assert.deepEqual(await storage.getBlob('workspace', blob.digest), png);
    assert.equal(await storage.getBlob('workspace', DIGEST), null);
    double.blobs.set(blob.digest, new Uint8Array([1, 2, 3]));
    await assert.rejects(() => storage.getBlob('workspace', blob.digest), (error) => error instanceof DesignBridgeError && error.kind === 'unavailable');
  });

  it('plans against the bridge with point lookups: blob.has per blob, never a listing', async () => {
    const { double, storage } = setup();
    const plan = await planImport({ storage, clock }, { projectId: 'proj-a' as never, source: files('a.png', 'b.png') }) as ImportPlan;
    assert.equal(plan.ok, true);
    assert.equal(double.count('blob.has'), 2);
    assert.equal(plan.ops.filter((op) => op.op === 'put-blob').length, 2);
    assert.equal(double.calls.some((call) => call.route === 'import.commit'), false, 'planning wrote nothing');
  });
});

describe('imports storage over the bridge: outcomes', () => {
  it('maps a host revision conflict to the imports StorageConflictError and classifies it as a conflict', async () => {
    const changed: string[] = [];
    const { double, storage, typed } = setup({ plan: async () => ({ ops: [], projects: ['p'] }), changed: (project) => changed.push(project) });
    await storage.commit([doc('imports/records/r', { v: 1 }), event('import.applied')]);
    changed.length = 0;
    await assert.rejects(() => storage.commit([doc('imports/records/r', { v: 2 }, null), event('import.applied', 1)]),
      (error) => error instanceof StorageConflictError && classifyDesignError(error, IMPORTS_CONTEXTS.apply).kind === 'conflict');
    await assert.rejects(() => typed.commit([doc('imports/records/r', { v: 3 }, '9'), event('import.applied', 1)]), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.recovery, error.operation, error.section], ['conflict', 'no-effect', 'reload', 'imports.apply', 'imports']);
      assert.ok(error.cause instanceof StorageConflictError);
      return true;
    });
    assert.deepEqual(changed, [], 'a conflict changed nothing, so nothing is notified');
    assert.equal(double.commits.length, 3);
  });

  it('keeps the disabled reason, as a definite no-effect that classifies as disabled', async () => {
    const changed: string[] = [];
    const { double, storage, typed } = setup({ plan: async () => ({ ops: [], projects: ['p'] }), changed: (project) => changed.push(project) });
    double.failWith((route) => route === 'import.commit' ? { ok: false, kind: 'unavailable', reason: 'disabled' } : undefined);
    await assert.rejects(() => storage.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => {
      assert.ok(error instanceof DesignBridgeError);
      assert.deepEqual([error.kind, error.reason], ['unavailable', 'disabled']);
      return true;
    });
    await assert.rejects(() => typed.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.reason, error.operation], ['disabled', 'no-effect', 'disabled', 'imports.apply']);
      return true;
    });
    assert.deepEqual(changed, []);
  });

  it('treats a lost transport on commit as an unknown outcome and tells project readers to re-read', async () => {
    const changed: string[] = [];
    const { double, storage, typed } = setup({ plan: async () => ({ ops: [], projects: ['p1', 'p2'] }), changed: (project) => changed.push(project) });
    double.failWith((route) => { if (route === 'import.commit') throw new Error('IPC channel closed'); });
    await assert.rejects(() => storage.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => error instanceof DesignBridgeError && error.kind === 'unknown');
    assert.deepEqual(changed, ['p1', 'p2']);
    changed.length = 0;
    await assert.rejects(() => typed.commit([doc('imports/records/r', {}), event('import.undone')]), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.recovery, error.operation], ['unknown', 'unknown-effect', 'check', 'imports.undo']);
      return true;
    });
    assert.deepEqual(changed, ['p1', 'p2']);
  });

  it('treats a malformed success reply as unknown, and a host refusal that touched nothing as no-effect', async () => {
    const changed: string[] = [];
    const { double, storage } = setup({ plan: async () => ({ ops: [], projects: ['p'] }), changed: (project) => changed.push(project) });
    double.failWith((route) => route === 'import.commit' ? { ok: true, value: { somethingElse: true } } : undefined);
    await assert.rejects(() => storage.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => error instanceof DesignBridgeError && error.kind === 'unknown');
    assert.deepEqual(changed, ['p']);
    changed.length = 0;
    for (const kind of ['unavailable', 'invalid', 'read-only'] as const) {
      double.failWith((route) => route === 'import.commit' ? { ok: false, kind } : undefined);
      await assert.rejects(() => storage.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => error instanceof DesignBridgeError && error.kind === kind);
    }
    double.failWith((route) => route === 'import.commit' ? { ok: false, kind: 'unknown' } : undefined);
    await assert.rejects(() => storage.commit([doc('imports/records/r', {}), event('import.applied')]), (error) => error instanceof DesignBridgeError && error.kind === 'unknown');
    assert.deepEqual(changed, ['p'], 'only the unknown outcome notified');
  });

  it('notifies the linked projects after a successful batch, and appends the link operations last, keyed as host documents', async () => {
    const changed: string[] = [];
    const link: ImportsCommitLink = {
      plan: async (ops) => ({ ops: [doc('design/projects/design.projects/content/p', { linked: ops.length })], projects: ['p'] }),
      changed: (project) => changed.push(project),
    };
    const { double, storage } = setup(link);
    await storage.commit([doc('imports/records/r', {}), event('import.applied')]);
    assert.deepEqual(double.commits[0]!.ops.map((op) => op.op === 'put-document' ? op.key : op.op), ['design/imports/records/r', 'append-event', 'design/projects/design.projects/content/p']);
    assert.deepEqual(changed, ['p']);
    assert.deepEqual(double.documents.get('design/projects/design.projects/content/p')!.value, { linked: 2 });
  });

  it('refuses a batch over the canonical size cap with a typed too-large failure before any call', async () => {
    const { double, storage } = setup();
    const big = new Uint8Array(16 * 1024 * 1024);
    const blobs = ['a', 'b', 'c'].map((letter): WriteOp => ({ op: 'put-blob', namespace: 'workspace', digest: sha256Digest(`sha256:${letter.repeat(64)}`), mediaType: 'image/png', bytes: big }));
    await assert.rejects(() => storage.commit([...blobs, event('import.applied')]), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.operation, error.reason, error.outcome], ['too-large', 'imports.apply', 'import-total', 'no-effect']);
      return true;
    });
    assert.equal(double.calls.length, 0);
  });
});

describe('imports storage: typed failures', () => {
  it('names the operation from the event a batch appends', () => {
    assert.equal(commitOperation([doc('imports/records/r', {}), event('import.applied')]), 'apply');
    assert.equal(commitOperation([event('import.undone')]), 'undo');
    assert.equal(commitOperation([event('conflict.resolved')]), 'resolve');
    assert.equal(commitOperation([doc('imports/records/r', {})]), 'edit');
    assert.deepEqual(Object.values(IMPORTS_CONTEXTS).map((context) => context.operation).sort(),
      ['imports.apply', 'imports.edit', 'imports.export', 'imports.pick', 'imports.read', 'imports.resolve', 'imports.undo']);
  });

  it('types every read rejection as unavailable (nothing changed), and every bridge write kind by its meaning', async () => {
    const { double, typed } = setup();
    double.failWith(() => ({ ok: false, kind: 'unavailable' }));
    const reads: (() => Promise<unknown>)[] = [
      () => typed.getDocument('workspace', 'imports/records/r'), () => typed.listDocuments('workspace', 'imports/records/'),
      () => typed.readEvents('workspace', 'imports'), () => typed.hasBlob!('workspace', DIGEST), () => typed.getBlob('workspace', DIGEST),
    ];
    for (const run of reads) {
      await assert.rejects(run, (error) => {
        assert.ok(error instanceof DesignOperationError);
        assert.deepEqual([error.kind, error.outcome, error.recovery, error.operation], ['unavailable', 'no-effect', 'retry', 'imports.read']);
        return true;
      });
    }
    double.failWith(() => { throw new Error('IPC channel closed'); });
    await assert.rejects(() => typed.getDocument('workspace', 'imports/records/r'), (error) => error instanceof DesignOperationError && error.kind === 'unavailable');
  });

  it('refuses a torn or non-contiguous journal instead of planning against a wrong sequence', async () => {
    const { double, typed } = setup();
    double.failWith((route) => route === 'event.read' ? { ok: true, value: { events: [{ seq: 1, payload: {} }], status: { state: 'torn-tail', validBytes: 1, tailBytes: 1 } } } : undefined);
    await assert.rejects(() => typed.readEvents('workspace', 'imports'), (error) => error instanceof DesignOperationError && error.kind === 'unavailable');
    double.failWith((route) => route === 'event.read' ? { ok: true, value: { events: [{ seq: 2, payload: {} }], status: { state: 'ok' } } } : undefined);
    await assert.rejects(() => typed.readEvents('workspace', 'imports'), (error) => error instanceof DesignOperationError && error.kind === 'unavailable');
  });

  it('cannot build a bundle: whole-namespace reads fail as a definite disabled before any call, so export writes nothing', async () => {
    const { double, storage, typed } = setup();
    for (const port of [storage, typed]) {
      for (const run of [() => port.listDocuments('workspace'), () => port.listBlobs('workspace'), () => port.listStreams('workspace')]) {
        await assert.rejects(run, (error) => {
          assert.ok(error instanceof DesignOperationError);
          assert.deepEqual([error.kind, error.outcome, error.reason, error.operation, error.section], ['disabled', 'no-effect', 'disabled', 'imports.export', 'imports']);
          assert.equal(error.message, 'Backup and export are not available in this build');
          return true;
        });
      }
    }
    assert.equal(exportUnavailable().recovery, 'none');
    assert.equal(double.calls.length, 0);
  });
});
