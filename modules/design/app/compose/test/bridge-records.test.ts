import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBridgeWorkspaceDocuments, DesignBridgeError } from '../bridge-documents.ts';
import { createTransportDouble } from './bridge-double.ts';
import { createRequestsStoragePort } from '../../storage/index.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { brandId as requestId } from '../../../requests/src/validate.ts';
import { SIMULATED_DESTINATION } from '../../sections/runs/pipeline.ts';
import { brandId as connectorId } from '../../../connector/src/ids.ts';
import { sha256Hex } from '../canonical.ts';
import type { DesignServiceParams, DesignServiceRoute, JsonValue } from '@hq/contracts/services';

function recordsDouble() {
  const d = createTransportDouble();
  const blobs = new Map<string, Uint8Array>();
  const events = new Map<string, { seq: number; payload: JsonValue }[]>();
  let response: ((route: DesignServiceRoute, params: DesignServiceParams[DesignServiceRoute]) => unknown) | undefined;
  d.failWith((route, params) => {
    const override = response?.(route, params);
    if (override !== undefined) return override;
    if (route === 'blob.put' && 'bytes' in params && 'expectedDigest' in params) {
      blobs.set(params.expectedDigest, new Uint8Array(params.bytes));
      return { ok: true, value: { digest: params.expectedDigest, bytes: params.bytes.byteLength } };
    }
    if (route === 'blob.get' && 'digest' in params) return { ok: true, value: blobs.get(params.digest) ?? null };
    if (route === 'blob.has' && 'digest' in params) return { ok: true, value: blobs.has(params.digest) };
    if (route === 'event.append' && 'stream' in params && 'payload' in params) {
      const stream = events.get(params.stream) ?? [];
      const event = { seq: stream.length + 1, payload: params.payload };
      stream.push(event); events.set(params.stream, stream);
      return { ok: true, value: event };
    }
    if (route === 'event.read' && 'stream' in params) return { ok: true, value: { events: events.get(params.stream) ?? [], status: { state: 'ok' } } };
    return undefined;
  });
  return { ...d, blobs, events, override: (next: typeof response) => { response = next; } };
}
const stream = 'design/requests/request-one/review';
const event = { type: 'requests.event-bytes', payload: { eventId: 'event-one' }, clientEventId: 'event-one' };
const invalid = (error: unknown) => error instanceof DesignBridgeError && error.kind === 'invalid';

describe('production record bridge', () => {
  it('forwards a requests event with exact params and unchanged clientEventId', async () => {
    const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
    assert.deepEqual(await bridge.appendEvent(stream, event), { seq: 1, payload: event.payload });
    assert.deepEqual(d.calls, [{ route: 'event.append', params: { stream, payload: event.payload, clientEventId: event.clientEventId } }]);
  });
  it('rejects wrong or missing event type and unsupported or invalid streams before any send', async () => {
    const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
    await assert.rejects(bridge.appendEvent(stream, { ...event, type: 'imports.event' }), invalid);
    const missing = new Proxy(event, { get(target, key) { return key === 'type' ? undefined : Reflect.get(target, key); } });
    await assert.rejects(bridge.appendEvent(stream, missing), invalid);
    for (const key of ['design/imports', 'design/references/x', 'design/requests/', 'design/requests/../x', 'design/requests/\n', 'design/requests/\ud800']) {
      await assert.rejects(bridge.appendEvent(key, event), invalid);
    }
    assert.equal(d.calls.length, 0);
  });
  it('propagates all known read statuses and requests fails closed on non-ok', async () => {
    const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
    const requests = createRequestsStoragePort({ workspace: bridge });
    for (const status of [{ state: 'ok' }, { state: 'torn-tail', validBytes: 10, tailBytes: 2 }, { state: 'corrupt', atSeq: 1, reason: 'broken chain' }]) {
      d.override(() => ({ ok: true, value: { events: [], status } }));
      assert.deepEqual((await bridge.readEvents(stream)).status, status);
      if (status.state === 'ok') assert.deepEqual(await requests.readEvents('workspace', stream), []);
      else await assert.rejects(requests.readEvents('workspace', stream), /fails closed/u);
    }
  });
  it('rejects malformed reads instead of returning an empty ok', async () => {
    const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
    for (const value of [null, {}, { events: [], status: { state: 'new' } },
      { events: [{ seq: 1.5, payload: {} }], status: { state: 'ok' } },
      { events: [{ seq: 1, payload: undefined }], status: { state: 'ok' } },
      { events: [{ seq: 1, payload: {}, extra: true }], status: { state: 'ok' } },
      { events: [], status: { state: 'ok', extra: true } },
      { events: new Array(1), status: { state: 'ok' } }]) {
      d.override(() => ({ ok: true, value }));
      await assert.rejects(bridge.readEvents(stream), (error) => error instanceof DesignBridgeError && error.kind === 'unavailable');
    }
  });
  it('round-trips blobs and refuses digest mismatches on write and read', async () => {
    const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
    const bytes = new Uint8Array([1, 2, 3]); const blob = await bridge.putBlob(bytes);
    assert.equal(blob.digest, `sha256:${await sha256Hex(bytes)}`);
    assert.equal(await bridge.hasBlob(blob.digest), true);
    assert.deepEqual(await bridge.getBlob(blob.digest), bytes);
    const count = d.calls.length;
    await assert.rejects(bridge.putBlob(new Uint8Array([9]), { expectedDigest: blob.digest }), invalid);
    assert.equal(d.calls.length, count);
    d.blobs.set(blob.digest, new Uint8Array([9]));
    await assert.rejects(bridge.getBlob(blob.digest), /unavailable/u);
  });
  it('never retries an unknown blob or event mutation', async () => {
    for (const thrown of [false, true]) {
      const d = recordsDouble(); const bridge = createBridgeWorkspaceDocuments(d.transport);
      d.override(() => { if (thrown) throw new Error('lost acknowledgement'); return { ok: false, kind: 'unknown' }; });
      await assert.rejects(bridge.putBlob(new Uint8Array([1])), /unknown/u);
      await assert.rejects(bridge.appendEvent(stream, event), /unknown/u);
      assert.deepEqual(d.calls.map((call) => call.route), ['blob.put', 'event.append']);
    }
  });
  it('persists the simulated send and evidence through the bridge without dispatch on navigation', async () => {
    const d = recordsDouble(); const workspace = createDesignWorkspace(createBridgeWorkspaceDocuments(d.transport));
    const requests = workspace.closure.requests;
    const runs = await workspace.closure.runs();
    assert.equal(d.calls.some((call) => ['doc.put', 'blob.put', 'event.append'].includes(call.route)), false);
    const session = await requests.create({ title: 'Synthetic closure', sources: [{ projectId: requestId('synthetic-project'),
      viewId: requestId('synthetic-view'), versionId: requestId('synthetic-version'), sourceRevision: 'synthetic-revision' }] });
    session.edit({ type: 'set-intent', intent: 'Adjust synthetic spacing' });
    session.edit({ type: 'set-destination', destination: SIMULATED_DESTINATION });
    const packet = await runs.pipeline.freeze(session); assert.ok(packet);
    await runs.pipeline.selectPacket(session, packet.packetId);
    runs.controller.requestSend();
    const result = await runs.controller.confirm();
    assert.equal(result?.outcome, 'attempted');
    if (result?.outcome !== 'attempted') throw new Error('Expected simulated attempt');
    assert.equal(result.attempt.state, 'accepted');
    await runs.pipeline.simulateReturn(session, result.dispatchId);
    assert.equal((await workspace.closure.outboxStore.list()).length, 1);
    assert.equal((await workspace.closure.evidenceStore.listByDispatch(result.dispatchId)).length, 1);
    assert.equal(session.state.candidates.length, 1);
    assert.equal(await requests.open(session.state.requestId), session, 'navigation shares the live session');
    const writes = d.calls.filter((call) => call.route === 'doc.put');
    const send = writes.findIndex((call) => 'key' in call.params && call.params.key.includes('/sends/'));
    const outbox = writes.findIndex((call) => 'key' in call.params && call.params.key.startsWith('design/connector/outbox/'));
    assert.ok(send >= 0 && outbox > send, 'send record precedes outbox write');
  });
  it('binds all four adapters to the real bridge and reopens persisted requests', async () => {
    const d = recordsDouble(); const workspace = createDesignWorkspace(createBridgeWorkspaceDocuments(d.transport));
    assert.equal(workspace.bridged, true);
    assert.equal(workspace.storageTag.status, 'workspace');
    const session = await workspace.closure.requests.create({ title: 'Synthetic bridge request' });
    await workspace.closure.outboxStore.list();
    await workspace.closure.evidenceStore.listByDispatch(connectorId('DispatchId', 'synthetic-dispatch'));
    await workspace.closure.referenceStorage.readDocument('workspace', 'design/references/library');
    assert.ok(d.calls.some((call) => call.route === 'doc.put'));
    for (const prefix of ['design/requests/', 'design/connector/outbox/', 'design/connector/evidence/']) {
      assert.ok(d.calls.some((call) => call.route === 'doc.list' && 'prefix' in call.params && call.params.prefix.startsWith(prefix)), prefix);
    }
    assert.ok(d.calls.some((call) => call.route === 'doc.get' && 'key' in call.params && call.params.key === 'design/references/library'));
    const reopened = createDesignWorkspace(createBridgeWorkspaceDocuments(d.transport));
    assert.equal((await reopened.closure.requests.open(session.state.requestId)).state.draft?.title, 'Synthetic bridge request');
    assert.equal(createDesignWorkspace(null).storageTag.status, 'fake');
    assert.match(createDesignWorkspace(null).closure.label, /FAKE.*in-memory/u);
  });
});
