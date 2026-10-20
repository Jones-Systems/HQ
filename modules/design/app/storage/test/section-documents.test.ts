import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ProjectStoragePort } from '../../../projects/src/contract.ts';
import { StorageConflictError } from '../../../projects/src/contract.ts';
import type { ComponentStoragePort } from '../../../components/src/contract.ts';
import type { FlowStoragePort } from '../../../flows/src/contract.ts';
import type { CompareStoragePort } from '../../../compare/src/contract.ts';
import type { AnnotationStorePort, AnnotationDocument, VersionId } from '../../../annotations/src/contract.ts';
import { documentKey } from '../../../../../packages/design-store/src/ids.ts';
import {
  bindWorkspace, createProjectsStorage, createComponentsStorage, createFlowsStorage, createCompareStorage,
  createAnnotationsStorage, PROJECTS_KEY_ROOT, COMPONENTS_KEY_ROOT, FLOWS_KEY_ROOT, COMPARE_KEY_ROOT,
  ANNOTATIONS_KEY_ROOT, CANVAS_KEY_ROOT, DEVICE_STORAGE_LABEL, TEXT_FORMAT, SectionStorageScopeError,
} from '../index.ts';
import type {
  WorkspaceDocuments, ProjectDocumentPort, ComponentDocumentPort, FlowDocumentPort, CompareDocumentPort, AnnotationDocumentPort,
} from '../index.ts';
import { makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type ProjectsAligned = Assert<Mutual<ProjectDocumentPort, ProjectStoragePort>>;
export type ComponentsAligned = Assert<Mutual<ComponentDocumentPort, ComponentStoragePort>>;
export type FlowsAligned = Assert<Mutual<FlowDocumentPort, FlowStoragePort>>;
export type CompareAligned = Assert<Mutual<CompareDocumentPort, CompareStoragePort>>;
export type AnnotationsAligned = Assert<Mutual<AnnotationDocumentPort, AnnotationStorePort>>;

async function withWorkspace(run: (workspace: WorkspaceDocuments) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const opened = await openAt(join(dir, 'store'));
    try { await run(await bindWorkspace(opened.store)); }
    finally { await opened.storage.close(); }
  } finally {
    removeDir(dir);
    assert.equal(existsSync(dir), false);
  }
}
const annotation = (versionId: string, nextLetterIndex = 0): AnnotationDocument => ({
  schema: 'hq.design.annotations/v1', versionId: versionId as VersionId, nextLetterIndex, annotations: [], revisit: [],
});
interface Harness {
  readonly surface: object;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<unknown>;
  list?(prefix: string): Promise<readonly string[]>;
}
const lanes = [
  { name: 'projects', root: PROJECTS_KEY_ROOT, absent: null, members: ['readDocument', 'writeDocument'],
    make: createProjectsStorage,
    harness: (w: WorkspaceDocuments): Harness => { const p = createProjectsStorage(w); return {
      surface: p, read: async (k) => { const d = await p.readDocument('workspace', k); return d ? d.value : null; },
      write: async (k, v) => p.writeDocument('workspace', k, v, { expectedRevision: (await p.readDocument('workspace', k))?.revision ?? null }),
    }; } },
  { name: 'components', root: COMPONENTS_KEY_ROOT, absent: undefined, members: ['readDocument', 'writeDocument', 'listKeys'],
    make: createComponentsStorage,
    harness: (w: WorkspaceDocuments): Harness => { const p = createComponentsStorage(w); return {
      surface: p, read: (k) => p.readDocument('workspace', k), write: (k, v) => p.writeDocument('workspace', k, v), list: (s) => p.listKeys('workspace', s),
    }; } },
  { name: 'flows', root: FLOWS_KEY_ROOT, absent: undefined, members: ['label', 'getDocument', 'putDocument', 'listKeys'],
    make: createFlowsStorage,
    harness: (w: WorkspaceDocuments): Harness => { const p = createFlowsStorage(w); return {
      surface: p, read: (k) => p.getDocument('workspace', k), write: (k, v) => p.putDocument('workspace', k, v), list: (s) => p.listKeys('workspace', s),
    }; } },
  { name: 'compare', root: COMPARE_KEY_ROOT, absent: null, members: ['read', 'write'], make: createCompareStorage,
    harness: (w: WorkspaceDocuments): Harness => { const p = createCompareStorage(w); return { surface: p, read: p.read, write: (k, v) => p.write(k, v as string) }; } },
  { name: 'annotations', root: ANNOTATIONS_KEY_ROOT, absent: null, members: ['adapter', 'load', 'save'], make: createAnnotationsStorage,
    harness: (w: WorkspaceDocuments): Harness => { const p = createAnnotationsStorage(w); return {
      surface: p, read: (k) => p.load(k as VersionId), write: (k, v) => p.save({ ...annotation(k), annotations: v } as AnnotationDocument),
    }; } },
] as const;

for (const lane of lanes) describe(`${lane.name} document adapter`, () => {
  it('round trips, matches absent semantics, overwrites and confines the stored key', async () => {
    await withWorkspace(async (workspace) => {
      const p = lane.harness(workspace);
      assert.equal(await p.read('absent'), lane.absent);
      for (const value of lane.name === 'compare' ? ['first', 'second'] : [[{ text: 'first' }], [{ text: 'second' }]]) {
        await p.write('items/a', value);
        assert.deepEqual(await p.read('items/a'), lane.name === 'annotations' ? { ...annotation('items/a'), annotations: value } : value);
      }
      assert.deepEqual(await workspace.listDocuments(), [lane.root + 'items/a']);
      assert.equal((await workspace.getDocument(lane.root + 'items/a'))?.revision, 2);
      if (p.list) {
        await p.write('other/b', null);
        await workspace.putDocument('design/requests/elsewhere', {});
        assert.deepEqual(await p.list('items/'), ['items/a']);
        assert.deepEqual(await p.list(''), ['items/a', 'other/b']);
      }
    });
  });
  it('rejects traversal, reserved and cross-section keys before calling the backing', async () => {
    await withWorkspace(async (workspace) => {
      let calls = 0;
      const spy: WorkspaceDocuments = { ...workspace,
        getDocument: (...args) => { calls++; return workspace.getDocument(...args); },
        putDocument: (...args) => { calls++; return workspace.putDocument(...args); },
        listDocuments: (...args) => { calls++; return workspace.listDocuments(...args); },
      };
      const p = lane.harness(spy);
      const forbidden = ['', '/a', '..', '../a', 'a/../b', 'a\u0000', 'a\u0085', '\ud800', 'x'.repeat(257 - lane.root.length), 'x ',
        ...[...lanes.map((l) => l.root), CANVAS_KEY_ROOT, 'design/requests/', 'design/connector/', 'design/storage/']
          .filter((root) => root !== lane.root).flatMap((root) => [root + 'foreign', root.slice(0, -1)])];
      for (const key of forbidden) {
        await assert.rejects(p.read(key), SectionStorageScopeError, key);
        await assert.rejects(p.write(key, lane.name === 'compare' ? 'x' : []), SectionStorageScopeError, key);
        if (p.list && key !== '') await assert.rejects(p.list(key), SectionStorageScopeError, key);
      }
      assert.equal(calls, 0, 'invalid scope never reaches T9');
      assert.deepEqual(await workspace.listDocuments(), []);
      const max = 'x'.repeat(256 - lane.root.length);
      assert.equal(documentKey(lane.root + max), lane.root + max);
      await p.write(max, lane.name === 'compare' ? '' : []);
      assert.ok(await workspace.getDocument(lane.root + max));
    });
  });
  it('rejects non-JSON without creating or replacing a document', async () => {
    await withWorkspace(async (workspace) => {
      const p = lane.harness(workspace);
      const cycle: unknown[] = []; cycle.push(cycle);
      await p.write('existing', lane.name === 'compare' ? 'original' : []);
      const before = await workspace.getDocument(lane.root + 'existing');
      for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol('x'), new Date(0), { bad: undefined }, [undefined], new Array(1), cycle, '\ud800']) {
        await assert.rejects(p.write('new', value));
        await assert.rejects(p.write('existing', value));
        assert.equal(await workspace.getDocument(lane.root + 'new'), null);
        assert.deepEqual(await workspace.getDocument(lane.root + 'existing'), before);
      }
    });
  });
  it('rejects wrong views and namespace bindings and exposes exactly its frozen port', async () => {
    await withWorkspace(async (workspace) => {
      assert.throws(() => lane.make({ ...workspace, kind: 'cache' } as never), SectionStorageScopeError);
      assert.throws(() => lane.make({ ...workspace, namespace: 'cache' }), SectionStorageScopeError);
      const p = lane.harness(workspace);
      assert.deepEqual(Object.keys(p.surface).sort(), [...lane.members].sort());
      assert.equal(Object.getPrototypeOf(p.surface), Object.prototype);
      assert.ok(Object.isFrozen(p.surface));
    });
  });
});

it('rejects wrong namespace arguments on every namespaced method', async () => {
  await withWorkspace(async (w) => {
    const p = createProjectsStorage(w), c = createComponentsStorage(w), f = createFlowsStorage(w);
    for (const ns of ['cache', '', 'Workspace', 'elsewhere']) {
      await assert.rejects(p.readDocument(ns, 'key'), SectionStorageScopeError);
      await assert.rejects(p.writeDocument(ns, 'key', {}, { expectedRevision: null }), SectionStorageScopeError);
      await assert.rejects(c.readDocument(ns as never, 'key'), SectionStorageScopeError);
      await assert.rejects(c.writeDocument(ns as never, 'key', {}), SectionStorageScopeError);
      await assert.rejects(c.listKeys(ns as never, ''), SectionStorageScopeError);
      await assert.rejects(f.getDocument(ns as never, 'key'), SectionStorageScopeError);
      await assert.rejects(f.putDocument(ns as never, 'key', {}), SectionStorageScopeError);
      await assert.rejects(f.listKeys(ns as never, ''), SectionStorageScopeError);
    }
    assert.deepEqual(await w.listDocuments(), []);
  });
});

it('projects maps create-only, CAS and malformed revisions to the actual lane conflict class', async () => {
  await withWorkspace(async (w) => {
    const a = createProjectsStorage(w), b = createProjectsStorage(w);
    assert.deepEqual(await a.writeDocument('workspace', 'k', { n: 1 }, { expectedRevision: null }), { revision: '1' });
    await assert.rejects(b.writeDocument('workspace', 'k', { n: 2 }, { expectedRevision: null }), StorageConflictError);
    assert.deepEqual(await a.readDocument('workspace', 'k'), { revision: '1', value: { n: 1 } });
    assert.deepEqual(await a.writeDocument('workspace', 'k', { n: 2 }, { expectedRevision: '1' }), { revision: '2' });
    const before = await w.getDocument(PROJECTS_KEY_ROOT + 'k');
    for (const revision of ['1', '', '0', '-1', '01', '+1', '1.0', '1e0', ' 1', '1\n', 'Infinity', '9007199254740992', undefined, 2]) {
      await assert.rejects(b.writeDocument('workspace', 'k', { n: 3 }, { expectedRevision: revision as never }), StorageConflictError);
      assert.deepEqual(await w.getDocument(PROJECTS_KEY_ROOT + 'k'), before);
    }
    await assert.rejects(a.writeDocument('workspace', 'absent', {}, { expectedRevision: '1' }), StorageConflictError);
    assert.equal(await a.readDocument('workspace', 'absent'), null);
  });
});

it('revision-free ports use unconditional puts even after another adapter writes', async () => {
  await withWorkspace(async (w) => {
    const options: unknown[] = [];
    const spy: WorkspaceDocuments = { ...w, putDocument: (...args) => { options.push(args[2]); return w.putDocument(...args); } };
    for (const lane of lanes.filter((l) => l.name !== 'projects')) {
      const a = lane.harness(spy), b = lane.harness(spy);
      await a.read('race'); await b.read('race');
      await a.write('race', lane.name === 'compare' ? 'a' : []);
      await b.write('race', lane.name === 'compare' ? 'b' : []);
      await b.write('race', lane.name === 'compare' ? 'c' : []);
      assert.equal((await w.getDocument(lane.root + 'race'))?.revision, 3);
    }
    assert.ok(options.length > 0 && options.every((value) => value === undefined));
  });
});

it('compare preserves exact text and rejects malformed envelopes', async () => {
  await withWorkspace(async (w) => {
    const p = createCompareStorage(w);
    for (const text of ['é🎯漢字', '', '\u0000\u0001\n\r\t\u0085', ' { "a": 1 }\n']) {
      await p.write('k', text);
      assert.equal(await p.read('k'), text);
      assert.deepEqual((await w.getDocument(COMPARE_KEY_ROOT + 'k'))?.value, { format: TEXT_FORMAT, text });
    }
    for (const value of [null, [], 'x', {}, { text: 'x' }, { format: TEXT_FORMAT, text: 1 }, { format: 'wrong', text: '' }, { format: TEXT_FORMAT, text: '', extra: true }]) {
      await w.putDocument(COMPARE_KEY_ROOT + 'bad', value);
      await assert.rejects(p.read('bad'), SectionStorageScopeError);
    }
  });
});

it('annotations keys exactly by document.versionId and exports only the requested labels', async () => {
  await withWorkspace(async (w) => {
    const p = createAnnotationsStorage(w);
    await p.save(annotation('v1'));
    await p.save(annotation('v2', 3));
    await p.save(annotation('v1', 2));
    assert.deepEqual(await p.load('v1' as VersionId), annotation('v1', 2));
    assert.deepEqual(await p.load('v2' as VersionId), annotation('v2', 3));
    assert.deepEqual(await w.listDocuments(), [ANNOTATIONS_KEY_ROOT + 'v1', ANNOTATIONS_KEY_ROOT + 'v2']);
    assert.equal(p.adapter, 'real');
    assert.equal(createFlowsStorage(w).label, DEVICE_STORAGE_LABEL);
    assert.equal(DEVICE_STORAGE_LABEL, 'Saved on this device');
  });
});
