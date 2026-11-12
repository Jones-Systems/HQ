/**
 * W6: the failure classes of the Design backend, asserted on the REAL errors the real host and file store
 * produce, then classified by `classifyDesignError` (compose/errors.ts). Same harness as the sections matrix.
 *
 * Findings recorded here (see also compose/BACKEND-CONTRACT.md):
 *  - An oversize document, event or cache value is refused by the host as `invalid`; an oversize blob is refused
 *    as `invalid` by the renderer bridge before any send and by the host. No storage path returns `too-large`
 *    today (that kind comes only from preview limits).
 *  - A refusal that needs no storage (key outside the roots, bad shape, cap) never opens the store.
 */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withDesignE2E, type E2EWindow } from '../test-support/design-e2e/harness.ts';
import { PNG, PNG_REF, SHELL_PROJECT, flowRaw } from '../test-support/design-e2e/fixtures.ts';
import { DESIGN_BLOB_CAP, DESIGN_VALUE_CAP } from './design-host.ts';
import {
  attemptDesign, classifyDesignError, designFeedback, isDesignFailure, toDesignOperationError, DesignOperationError, type DesignFailureContext, type DesignSection,
} from '../../../modules/design/app/compose/errors.ts';
import { bridgeResultValue, DesignBridgeConflictError, DesignBridgeError } from '../../../modules/design/app/compose/bridge-documents.ts';
import { createRequestsStoragePort, createCanvasStorage, createFlowsStorage } from '../../../modules/design/app/storage/index.ts';
import { addView, renameView, type ProjectContent } from '../../../modules/design/projects/src/content.ts';
import { projectId, viewId } from '../../../modules/design/projects/src/ids.ts';
import { CONTENT_SCHEMA } from '../../../modules/design/projects/src/content.ts';
import { SYNTHETIC_BUTTON } from '../../../modules/design/components/src/fixtures.ts';
import { addArtboard, emptyArrangement } from '../../../modules/design/canvas/src/arrangement.ts';
import { artboardId } from '../../../modules/design/canvas/src/contract.ts';
import { loadArrangement, saveArrangement } from '../../../modules/design/canvas/src/codec.ts';
import { parseFlow } from '../../../modules/design/flows/src/model.ts';
import type { FlowDocument } from '../../../modules/design/flows/src/contract.ts';
import type { DesignServiceParams, DesignServiceRoute } from '@hq/contracts/services';
import type { BlobDigest } from '@hq/contracts/design-records';
import { PROJECTS_KEY_PREFIX } from '../../../modules/design/projects/src/contract.ts';

const ctx = (section: DesignSection, operation: string, write: boolean): DesignFailureContext => ({ section, operation, action: 'save it', write });
const writing = (section: DesignSection, operation: string) => ctx(section, operation, true);
const reading = (section: DesignSection, operation: string) => ctx(section, operation, false);
/** Runs a call that must reject and returns what it rejected with. */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (error) { return error; }
  throw new Error('Expected the call to reject');
}
const lastReply = (window: E2EWindow) => window.transport.calls.at(-1)?.result;
/** Pins both the classifier and the landed error envelope against each observed rejection. */
function observedFailure(error: unknown, context: DesignFailureContext) {
  const failure = classifyDesignError(error, context);
  const operation = toDesignOperationError(error, context);
  expect(operation).toBeInstanceOf(DesignOperationError);
  expect(operation.name).toBe('DesignOperationError');
  expect(isDesignFailure(operation)).toBe(true);
  expect(classifyDesignError(operation, context)).toEqual(failure);
  expect(classifyDesignError(structuredClone(failure), context)).toEqual(failure);
  if (failure.outcome === 'unknown-effect') {
    expect(failure.kind).toBe('unknown');
    expect(designFeedback(operation).action).toEqual({ kind: 'check', label: 'Check' });
  }
  return failure;
}
const sha = (bytes: Uint8Array): BlobDigest => `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobDigest;

describe('conflict: a lost compare-and-swap is `conflict` for every writer', () => {
  it('create-only and stale numeric revisions on a raw document', async () => {
    await withDesignE2E(async (e2e) => {
      const { records } = e2e.window;
      const key = 'design/projects/cas-demo';
      await records.putDocument(key, { n: 1 }, { expectedRevision: null });
      const createOnly = await rejection(() => records.putDocument(key, { n: 2 }, { expectedRevision: null }));
      expect(lastReply(e2e.window)).toEqual({ ok: false, kind: 'conflict' });
      expect(createOnly).toBeInstanceOf(DesignBridgeConflictError);
      expect(createOnly).toMatchObject({ name: 'StoreError', code: 'conflict' });
      const stale = await rejection(() => records.putDocument(key, { n: 3 }, { expectedRevision: 5 }));
      expect(lastReply(e2e.window)).toEqual({ ok: false, kind: 'conflict' });
      for (const error of [createOnly, stale]) {
        const failure = observedFailure(error, writing('projects', 'projects.rename'));
        expect(failure).toMatchObject({ kind: 'conflict', outcome: 'no-effect', recovery: 'reload', section: 'projects', operation: 'projects.rename' });
        expect(designFeedback(failure)).toMatchObject({ tone: 'danger', action: { kind: 'reload', label: 'Reload' }, persistent: true });
      }
      expect(await records.getDocument(key)).toMatchObject({ revision: 1, value: { n: 1 } });
    });
  });

  it('Projects: a content write that lost the race is StorageConflictError and keeps the winner', async () => {
    await withDesignE2E(async (e2e) => {
      const a = e2e.window, b = e2e.openWindow();
      const project = projectId('project-race');
      const envA = await a.workspace.contentFor({ id: project, name: 'Race' });
      const envB = await b.workspace.contentFor({ id: project, name: 'Race' });
      const view = viewId('view-home');
      await envA.repository.update(project, (content, now) => addView(content, { id: view, title: 'Home', kind: 'screen' }, now));
      // B reads revision 1, then A renames before B's write reaches the host.
      const gate = b.transport.gate('doc.put');
      const racing = rejection(() => envB.repository.update(project, (content, now) => renameView(content, view, 'Home (B)', now)));
      await gate.reached;
      await envA.repository.update(project, (content, now) => renameView(content, view, 'Home (A)', now));
      gate.release();
      const error = await racing;
      expect(error).toMatchObject({ name: 'StorageConflictError' });
      expect(observedFailure(error, writing('projects', 'projects.rename'))).toMatchObject({ kind: 'conflict', outcome: 'no-effect', recovery: 'reload' });
      const stored = await a.records.getDocument(`design/projects/${PROJECTS_KEY_PREFIX}content/${project}`);
      expect(stored).toMatchObject({ revision: 2 });
      expect((stored!.value as unknown as ProjectContent).views.map((item) => item.title)).toEqual(['Home (A)']);
    });
  });

  it('Components: a duplicate revision is IntegrityError (exists) and keeps the first writer', async () => {
    await withDesignE2E(async (e2e) => {
      const a = e2e.window, b = e2e.openWindow();
      const libraryA = await a.workspace.componentsFor(SHELL_PROJECT);
      const libraryB = await b.workspace.componentsFor(SHELL_PROJECT);
      // B lists no revisions, then A saves revision 1 before B checks that revision 1 is free.
      const gate = b.transport.gate((route, params) => route === 'doc.get' && String(params.key).endsWith('/00000001'));
      const racing = rejection(() => libraryB.saveSource(SYNTHETIC_BUTTON));
      await gate.reached;
      const winner = await libraryA.saveSource({ ...SYNTHETIC_BUTTON, name: 'Synthetic Button (A)' });
      gate.release();
      const error = await racing;
      expect(error).toMatchObject({ name: 'IntegrityError', reason: 'exists' });
      expect(observedFailure(error, writing('components', 'components.save'))).toMatchObject({ kind: 'conflict', outcome: 'no-effect', recovery: 'reload' });
      expect(await libraryA.getSource(winner.componentId, 1)).toEqual(winner);
      expect(await libraryA.revisions(winner.componentId)).toEqual([1]);
    });
  });

  it('Canvas: the store refuses a write whose read token is stale (CanvasWriteConflictError), and the advisory check catches the rest', async () => {
    await withDesignE2E(async (e2e) => {
      const a = e2e.window, b = e2e.openWindow();
      const canvasA = (await a.workspace.canvasFor(SHELL_PROJECT))!, canvasB = (await b.workspace.canvasFor(SHELL_PROJECT))!;
      const base = emptyArrangement(canvasA.canvasId, canvasA.projectId);
      expect((await saveArrangement(canvasA.storage, base, null)).status).toBe('saved');
      const loadedA = await loadArrangement(canvasA.storage, canvasA.canvasId), loadedB = await loadArrangement(canvasB.storage, canvasB.canvasId);
      if (loadedA.status !== 'loaded' || loadedB.status !== 'loaded') throw new Error('Expected the saved arrangement');
      const frame = { x: 0, y: 0, width: 100, height: 100 };
      const editedA = addArtboard(base, { id: artboardId('artboard-a'), name: 'A', frame }), editedB = addArtboard(base, { id: artboardId('artboard-b'), name: 'B', frame });
      // B passes the advisory text check, then A saves before B's write reaches the host.
      const gate = b.transport.gate((route, params) => route === 'doc.put' && String(params.key).startsWith('design.canvas.arrangement.v1/'));
      const racing = rejection(() => saveArrangement(canvasB.storage, editedB, loadedB.baseText));
      await gate.reached;
      expect((await saveArrangement(canvasA.storage, editedA, loadedA.baseText)).status).toBe('saved');
      gate.release();
      const error = await racing;
      expect(error).toMatchObject({ name: 'CanvasWriteConflictError', reason: 'revision-changed' });
      expect(observedFailure(error, writing('canvas', 'canvas.save'))).toMatchObject({ kind: 'conflict', outcome: 'no-effect', recovery: 'reload' });
      // Without the interleaving, the advisory check reports the change and writes nothing.
      expect(await saveArrangement(canvasB.storage, editedB, loadedB.baseText)).toMatchObject({ status: 'conflict' });
      const stored = await a.records.getDocument(`design.canvas.arrangement.v1/${canvasA.canvasId}`);
      expect(stored?.revision).toBe(2);
    });
  });

  it('References: a library write that loses the race gets a conflict from the host, reloads and applies on the winner', async () => {
    await withDesignE2E(async (e2e) => {
      const a = e2e.window, b = e2e.openWindow();
      const envA = await a.workspace.closure.references(), envB = await b.workspace.closure.references();
      const candidate = (title: string, seed: string) => ({
        kind: 'screenshot', source: { kind: 'url' as const, url: `https://example.com/${seed}` }, capturedAt: '2026-02-01T10:00:00.000Z',
        capturedBy: 'owner-judged', title, asset: { bytes: new TextEncoder().encode(`synthetic ${seed}`), mediaType: 'image/png', w: 1, h: 1 },
      });
      expect((await envA.library.importReference(candidate('From A', 'a'))).status).toBe('created');
      // B still holds "no library yet", so its create-only write is refused by the store as a conflict...
      expect((await envB.library.importReference(candidate('From B', 'b'))).status).toBe('created');
      expect(b.transport.calls.filter((call) => call.route === 'doc.put').map((call) => call.result)).toEqual([{ ok: false, kind: 'conflict' }, expect.objectContaining({ ok: true })]);
      // ...and the library reloads once and applies B's import on top of A's, so neither import is lost.
      expect((await a.records.getDocument('design/references/library'))?.revision).toBe(2);
      expect(Object.values(envB.library.state.references).map((record) => record.title).sort()).toEqual(['From A', 'From B']);
      const reopened = await (await e2e.reopen()).workspace.closure.references();
      expect(Object.values(reopened.library.state.references).map((record) => record.title).sort()).toEqual(['From A', 'From B']);
    });
  });
});

describe('invalid: the host refuses oversize values and blobs, and keys outside the roots', () => {
  it('refuses a document value over the cap as invalid and accepts one exactly at it', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      const key = 'design/projects/size-demo';
      // JSON adds two quote characters, so cap - 1 characters is one byte over and cap - 2 is exactly the cap.
      const error = await rejection(() => records.putDocument(key, 'x'.repeat(DESIGN_VALUE_CAP - 1)));
      expect(lastReply(e2e.window)).toEqual({ ok: false, kind: 'invalid' });
      expect(observedFailure(error, writing('projects', 'projects.save'))).toMatchObject({ kind: 'invalid', outcome: 'no-effect', recovery: 'none' });
      expect(existsSync(e2e.storeRoot)).toBe(false);
      expect((await records.putDocument(key, 'x'.repeat(DESIGN_VALUE_CAP - 2))).revision).toBe(1);
      expect(existsSync(e2e.storeRoot)).toBe(true);
      const event = await rejection(() => records.appendEvent('design/requests/size/review', { type: 'requests.event-bytes', payload: 'x'.repeat(DESIGN_VALUE_CAP) }));
      expect(observedFailure(event, writing('requests', 'requests.review'))).toMatchObject({ kind: 'invalid', outcome: 'no-effect' });
      expect(transport.calls.at(-1)?.result).toEqual({ ok: false, kind: 'invalid' });
      const cache = await transport.call('cache.put', { key: 'design.discovery.catalog', value: 'x'.repeat(DESIGN_VALUE_CAP) });
      expect(cache).toEqual({ ok: false, kind: 'invalid' });
    });
  });

  it('refuses a blob over the cap in the bridge and in the host, and accepts one exactly at it', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      const oversize = new Uint8Array(DESIGN_BLOB_CAP + 1);
      const sentBefore = transport.calls.length;
      const refused = await rejection(() => records.putBlob(oversize));
      expect(transport.calls.length).toBe(sentBefore); // the bridge refused before sending anything
      expect(observedFailure(refused, writing('references', 'references.import'))).toMatchObject({ kind: 'invalid', outcome: 'no-effect', recovery: 'none' });
      // A caller that skips the bridge's check is still refused by the host.
      const hostRefusal = await transport.call('blob.put', { bytes: oversize, expectedDigest: sha(oversize) });
      expect(hostRefusal).toEqual({ ok: false, kind: 'invalid' });
      expect(existsSync(e2e.storeRoot)).toBe(false);
      const atCap = new Uint8Array(DESIGN_BLOB_CAP).fill(7);
      expect(await records.putBlob(atCap)).toEqual({ digest: sha(atCap), bytes: DESIGN_BLOB_CAP });
      expect((await records.getBlob(sha(atCap)))?.byteLength).toBe(DESIGN_BLOB_CAP);
    });
  });

  it('refuses keys and prefixes outside the allowed roots as invalid, without opening the store', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      const keys = ['design/connector/x', 'design/storage/x', 'design/imports/x', 'other/x', 'design/projects/../x', 'design/projects/\u0000',
        `design/projects/${'x'.repeat(256)}`, ' design/projects/x', 'design/projects/x ', 'design/projects/\ud800', 'design/projects/', 'design/taste/other', 'design/taste/journal.v1/x'];
      for (const key of keys) {
        const read = await rejection(() => records.getDocument(key));
        expect(observedFailure(read, reading('projects', 'projects.open')), JSON.stringify(key)).toMatchObject({ kind: 'invalid', outcome: 'no-effect', recovery: 'none' });
        const write = await rejection(() => records.putDocument(key, {}));
        expect(observedFailure(write, writing('projects', 'projects.save')), JSON.stringify(key)).toMatchObject({ kind: 'invalid', outcome: 'no-effect' });
      }
      for (const prefix of ['design/', 'design/connector/', 'design/taste/', 'other/']) {
        expect(observedFailure(await rejection(() => records.listDocuments(prefix)), reading('projects', 'projects.list')).kind, prefix).toBe('invalid');
      }
      // Every one of those reached the host and was refused; none opened the store or wrote anything.
      expect(transport.calls.every((call) => call.result && !call.result.ok && call.result.kind === 'invalid')).toBe(true);
      expect(existsSync(e2e.storeRoot)).toBe(false);
      // Event streams are confined to design/requests/ by the bridge itself, before any send.
      const sent = transport.calls.length;
      for (const stream of ['design/imports', 'design/references/x', 'design/requests/', 'design/requests/../x']) {
        expect(observedFailure(await rejection(() => records.readEvents(stream)), reading('requests', 'requests.open')).kind).toBe('invalid');
      }
      expect(transport.calls.length).toBe(sent);
      // Unknown routes are refused too.
      expect(await e2e.host.call('doc.delete', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'invalid' });
      expect(existsSync(e2e.storeRoot)).toBe(false);
    });
  });

  it('refuses out-of-section keys in the section adapters before any send (scope errors are invalid)', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      const flows = createFlowsStorage(records);
      const scope = await rejection(() => flows.putDocument('workspace', '../escape', {}));
      expect(scope).toMatchObject({ name: 'SectionStorageScopeError' });
      expect(observedFailure(scope, writing('flows', 'flows.save'))).toMatchObject({ kind: 'invalid', outcome: 'no-effect', recovery: 'none' });
      const canvas = await rejection(() => createCanvasStorage(records).readDocument('workspace', 'design/projects/x'));
      expect(canvas).toMatchObject({ name: 'CanvasScopeError' });
      expect(observedFailure(canvas, reading('canvas', 'canvas.open')).kind).toBe('invalid');
      const requests = await rejection(() => createRequestsStoragePort({ workspace: records }).readDocument('workspace', 'design/projects/x'));
      expect(requests).toMatchObject({ name: 'RequestsStorageScopeError' });
      expect(observedFailure(requests, reading('requests', 'requests.open')).kind).toBe('invalid');
      expect(transport.calls).toHaveLength(0);
    });
  });
});

describe('disabled: routes that are off in the default store keep their reason through the bridge', () => {
  const exportedAt = '2026-01-01T00:00:00Z';
  const routes = [
    ['export.preview', { exportedAt }], ['export.save', { exportedAt }], ['import.status', {}], ['storage.diagnostics', {}],
    ['import.repair', { txnId: 'a'.repeat(64) }], ['import.pick', {}],
    ['import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: 'design/projects/x', value: {}, expectedRevision: null }] }],
  ] as const satisfies readonly (readonly [DesignServiceRoute, DesignServiceParams[DesignServiceRoute]])[];

  it.each(routes)('%s answers `disabled`, which classifies as disabled (a definite no-effect, even for a write route)', async (route, params) => {
    await withDesignE2E(async (e2e) => {
      const reply = await e2e.window.transport.call(route, params);
      expect(reply).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
      const error = await rejection(async () => bridgeResultValue(reply, 'unknown'));
      expect(error).toBeInstanceOf(DesignBridgeError);
      expect(error).toMatchObject({ kind: 'unavailable', reason: 'disabled' });
      const failure = observedFailure(error, writing('imports', `imports.${route}`));
      expect(failure).toMatchObject({ kind: 'disabled', outcome: 'no-effect', recovery: 'none', reason: 'disabled' });
      expect(designFeedback(failure)).toMatchObject({ tone: 'info', meta: `imports.${route} · disabled`, inline: 'failed', persistent: false });
      expect(isDesignFailure(failure)).toBe(true);
    });
  });

  it('the ordinary document routes are not disabled in the same store', async () => {
    await withDesignE2E(async (e2e) => {
      expect(await e2e.window.transport.call('doc.put', { key: 'design/projects/x', value: {} })).toMatchObject({ ok: true });
      expect(await e2e.window.transport.call('doc.list', { prefix: 'design/projects/' })).toEqual({ ok: true, value: ['design/projects/x'] });
    });
  });
});

describe('unavailable: a closed host refuses reads and writes without touching storage', () => {
  it('classifies a read after close() as unavailable and a write after close() as unavailable (not unknown), and nothing was written', async () => {
    await withDesignE2E(async (e2e) => {
      const { records } = e2e.window;
      await records.putDocument('design/projects/kept', { n: 1 });
      await e2e.host.close();
      const read = await rejection(() => records.getDocument('design/projects/kept'));
      expect(lastReply(e2e.window)).toEqual({ ok: false, kind: 'unavailable' });
      expect(observedFailure(read, reading('projects', 'projects.open'))).toMatchObject({ kind: 'unavailable', outcome: 'no-effect', recovery: 'retry' });
      const write = await rejection(() => records.putDocument('design/projects/kept', { n: 2 }));
      expect(observedFailure(write, writing('projects', 'projects.save'))).toMatchObject({ kind: 'unavailable', outcome: 'no-effect', recovery: 'retry' });
      expect((await rejection(() => records.putBlob(PNG)))).toBeInstanceOf(DesignBridgeError);
      expect(observedFailure(await rejection(() => records.putBlob(PNG)), writing('references', 'references.import')).kind).toBe('unavailable');
      expect(observedFailure(await rejection(() => records.readEvents('design/requests/a/review')), reading('requests', 'requests.open')).kind).toBe('unavailable');
      const window = await e2e.reopen();
      expect(await window.records.getDocument('design/projects/kept')).toMatchObject({ revision: 1, value: { n: 1 } });
      expect(await window.records.hasBlob(PNG_REF.digest)).toBe(false);
    });
  });

  it('classifies a section read after close() as unavailable through the composed Projects adapter', async () => {
    await withDesignE2E(async (e2e) => {
      const env = await e2e.window.workspace.contentFor({ id: 'project-closed', name: 'Closed' });
      await e2e.host.close();
      const error = await rejection(() => env.repository.load(projectId('project-closed')));
      expect(observedFailure(error, reading('projects', 'projects.open'))).toMatchObject({ kind: 'unavailable', outcome: 'no-effect', recovery: 'retry' });
      // An uncached composition call carries the landed typed envelope itself.
      const composed = await rejection(() => e2e.window.workspace.contentFor({ id: 'project-closed-envelope', name: 'Closed envelope' }));
      expect(composed).toBeInstanceOf(DesignOperationError);
      expect(observedFailure(composed, reading('projects', 'projects.open'))).toMatchObject({
        kind: 'unavailable', outcome: 'no-effect', recovery: 'retry', section: 'projects', operation: 'projects.load',
      });
    });
  });
});

describe('unknown: a write whose reply is lost', () => {
  it('doc.put: the write landed but the reply was lost, so the renderer reports unknown and a read-back finds it', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      transport.loseReply('doc.put');
      const error = await rejection(() => records.putDocument('design/projects/lost', { n: 1 }, { expectedRevision: null }));
      expect(error).toMatchObject({ name: 'DesignBridgeError', kind: 'unknown' });
      expect(transport.calls.at(-1)).toMatchObject({ outcome: 'reply-lost' });
      const failure = observedFailure(error, writing('projects', 'projects.create'));
      expect(failure).toMatchObject({ kind: 'unknown', outcome: 'unknown-effect', recovery: 'check' });
      expect(designFeedback(failure)).toMatchObject({ tone: 'unknown', inline: 'unknown', action: { kind: 'check', label: 'Check' }, persistent: true });
      // "Check": the write did land, and it must not be blindly repeated as a create.
      expect(await records.getDocument('design/projects/lost')).toMatchObject({ revision: 1, value: { n: 1 } });
      expect(observedFailure(await rejection(() => records.putDocument('design/projects/lost', { n: 1 }, { expectedRevision: null })), writing('projects', 'projects.create')).kind).toBe('conflict');
    });
  });

  it('a request that never reached the host is also unknown to the renderer, though nothing was written', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      transport.dropRequest('doc.put');
      const failure = observedFailure(await rejection(() => records.putDocument('design/projects/dropped', {})), writing('projects', 'projects.create'));
      expect(failure).toMatchObject({ kind: 'unknown', outcome: 'unknown-effect', recovery: 'check' });
      expect(await records.getDocument('design/projects/dropped')).toBeNull();
    });
  });

  it('blob.put and event.append lost replies are unknown, and a retry reconciles (same digest, same clientEventId)', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      transport.loseReply('blob.put');
      expect(observedFailure(await rejection(() => records.putBlob(PNG)), writing('references', 'references.import')).kind).toBe('unknown');
      expect(await records.putBlob(PNG)).toEqual({ digest: PNG_REF.digest, bytes: PNG.length }); // content-addressed: the retry is the same blob

      const stream = 'design/requests/request-lost/review';
      const event = { type: 'requests.event-bytes', payload: { eventId: 'event-lost', decision: 'accept' }, clientEventId: 'event-lost' };
      transport.loseReply('event.append');
      expect(observedFailure(await rejection(() => records.appendEvent(stream, event)), writing('requests', 'requests.review')).kind).toBe('unknown');
      expect(await records.appendEvent(stream, event)).toEqual({ seq: 1, payload: event.payload }); // the retry returns the original event
      expect((await records.readEvents(stream)).events).toHaveLength(1);
    });
  });

  it('Requests: a create-only draft lost in flight reconciles as exists-identical on retry', async () => {
    await withDesignE2E(async (e2e) => {
      const storage = createRequestsStoragePort({ workspace: e2e.window.records });
      const bytes = new TextEncoder().encode('{"requestId":"request-lost","title":"Synthetic"}');
      const key = 'design/requests/request-lost/draft';
      e2e.window.transport.loseReply('doc.put');
      expect(observedFailure(await rejection(() => storage.createDocument('workspace', key, bytes)), writing('requests', 'requests.create')).kind).toBe('unknown');
      expect(await storage.createDocument('workspace', key, bytes)).toBe('exists-identical');
      expect(await storage.createDocument('workspace', key, new TextEncoder().encode('{"requestId":"request-lost","title":"Other"}'))).toBe('exists-different');
    });
  });

  it('an unrecognised failure is unknown during a write and unavailable during a read', async () => {
    await withDesignE2E(async (e2e) => {
      const { records, transport } = e2e.window;
      transport.loseReply('doc.get');
      expect(observedFailure(await rejection(() => records.getDocument('design/projects/x')), reading('projects', 'projects.open'))).toMatchObject({ kind: 'unavailable', outcome: 'no-effect', recovery: 'retry' });
      const result = await attemptDesign(async () => { transport.loseReply('doc.put'); return records.putDocument('design/projects/x', {}); }, writing('projects', 'projects.save'));
      expect(result).toMatchObject({ ok: false, failure: { kind: 'unknown' } });
    });
  });
});

describe('read-only and damaged data', () => {
  it('a read-only store refuses every write as read-only and still reads', async () => {
    await withDesignE2E(async (e2e) => {
      await e2e.window.records.putDocument('design/projects/kept', { n: 1 });
      await e2e.window.records.putBlob(PNG);
      const window = await e2e.reopen({ readOnly: true });
      expect(await window.records.getDocument('design/projects/kept')).toMatchObject({ value: { n: 1 } });
      for (const write of [() => window.records.putDocument('design/projects/kept', { n: 2 }), () => window.records.putBlob(new Uint8Array([1, 2, 3])),
        () => window.records.appendEvent('design/requests/r/review', { type: 'requests.event-bytes', payload: {} })]) {
        const error = await rejection(write);
        expect(error).toMatchObject({ name: 'DesignBridgeError', kind: 'read-only' });
        expect(observedFailure(error, writing('projects', 'projects.save'))).toMatchObject({ kind: 'read-only', outcome: 'no-effect', recovery: 'none' });
      }
      expect(await window.records.getDocument('design/projects/kept')).toMatchObject({ revision: 1, value: { n: 1 } });
    });
  });

  it('a project saved by a newer HQ opens read-only, is never rewritten, and classifies as read-only', async () => {
    await withDesignE2E(async (e2e) => {
      const id = 'project-future';
      const key = `design/projects/${PROJECTS_KEY_PREFIX}content/${id}`;
      const future = { schema: `${CONTENT_SCHEMA.replace('/v1', '/v9')}`, projectId: id, views: [], versions: [], links: [], updatedAt: '2026-01-01T00:00:00.000Z' };
      await e2e.window.records.putDocument(key, future);
      const env = await e2e.window.workspace.contentFor({ id: 'project-other', name: 'Other' });
      const error = await rejection(() => env.repository.update(projectId(id), (content, now) => addView(content, { id: viewId('view-x'), title: 'X', kind: 'page' }, now)));
      expect(error).toMatchObject({ name: 'ReadOnlyContentError' });
      expect(observedFailure(error, writing('projects', 'projects.addView'))).toMatchObject({ kind: 'read-only', outcome: 'no-effect', recovery: 'none' });
      expect(await e2e.window.records.getDocument(key)).toMatchObject({ revision: 1, value: future });
    });
  });

  it('a flow that fails validation is refused before any write (a built-in TypeError, so it cannot be told from a bug by name)', async () => {
    await withDesignE2E(async (e2e) => {
      const { repository } = await e2e.window.workspace.flowsFor(SHELL_PROJECT);
      const parsed = parseFlow(flowRaw());
      if (!parsed.ok) throw new Error(parsed.errors.join('; '));
      // Deliberately cross the typed boundary to exercise runtime validation.
      const invalid = { ...parsed.flow, platform: 'toaster' } as unknown as FlowDocument;
      const error = await rejection(() => repository.save(invalid));
      expect(error).toBeInstanceOf(TypeError);
      expect(String((error as Error).message)).toMatch(/Refusing to save invalid flow/u);
      expect(e2e.window.transport.calls.filter((call) => call.route === 'doc.put')).toEqual([]);
      expect(await e2e.window.records.listDocuments('design/flows/')).toEqual([]);
      // A well-formed failure either way: validation errors from Components, Flows and Discovery are built-ins, so a
      // write that fails this way is reported as not confirmed (`unknown`) rather than guessed to be `invalid`.
      expect(observedFailure(error, writing('flows', 'flows.save'))).toMatchObject({ kind: 'unknown', outcome: 'unknown-effect', recovery: 'check' });
    });
  });
});
