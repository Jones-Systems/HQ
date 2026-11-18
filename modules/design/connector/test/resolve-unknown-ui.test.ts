import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { ConnectorPanelHost } from '../src/ConnectorPanel.ts';
import { createConnectorController } from '../src/controller.ts';
import { createConfirmation } from '../src/confirmation.ts';
import { createFakeClock, createFakeReceiver, createMemoryOutboxStore, createMemoryEvidenceStore, syntheticCatalog, syntheticDestination, syntheticIdentity, syntheticPacket, syntheticEvidence } from '../src/fakes.ts';
import { createOutbox } from '../src/outbox.ts';
import { latestAttempt, withLatest } from '../src/dispatch.ts';
import { digestOf } from '../src/canonical.ts';
import * as entry from '../src/index.ts';

async function setup() {
  const clock = createFakeClock();
  const receiver = createFakeReceiver({ clock, identity: syntheticIdentity(), modes: ['new-thread'] });
  receiver.setLookupMode('absence-only');
  const transports = { 'fake-receiver': receiver };
  const store = createMemoryOutboxStore();
  const evidence = createMemoryEvidenceStore();
  const outbox = createOutbox({ store, transports, clock, sessionId: 'synthetic-ui', probeTimeoutMs: 10 });
  const packet = await syntheticPacket();
  const destination = syntheticDestination({ mode: 'new-thread' });
  receiver.failNextSend('throw-before-effect');
  const result = await outbox.submit({ packet, destination, confirmation: createConfirmation({ packet, destination, clock }) });
  assert.equal(result.outcome, 'attempted');
  if (result.outcome !== 'attempted') throw new Error('Expected attempt');
  const controller = createConnectorController({ outbox, transports, clock, evidence, evidenceFeed: evidence,
    getCatalog: () => ({ ...syntheticCatalog(), destinations: [destination] }) });
  await controller.setPacket(packet);
  await controller.select(destination.destinationId);
  return { receiver, outbox, controller, evidence, packet, destination, result, store };
}

test('each read path has zero fence calls, including an evidence-feed refresh', async () => {
  const h = await setup();
  const counters: Record<string, number> = {};
  const stored = (await h.store.get(h.result.dispatchId))!;
  await h.store.put(withLatest(stored.record, { ...latestAttempt(stored.record)!, state: 'submitting' }), stored.revision);
  await h.outbox.recover(); counters.recover = h.receiver.fenceCalls();
  await h.outbox.reconcile(); counters.reconcile = h.receiver.fenceCalls();
  await h.controller.checkStatus(); counters.checkStatus = h.receiver.fenceCalls();
  await h.controller.refresh(); counters.refresh = h.receiver.fenceCalls();
  await h.controller.select(h.destination.destinationId); counters.selection = h.receiver.fenceCalls();
  const refreshed = new Promise<void>((resolve) => {
    const stop = h.controller.subscribe(() => { stop(); resolve(); });
  });
  const attempt = latestAttempt((await h.outbox.get(h.result.dispatchId))!)!;
  const receipt = { receiptId: 'receipt.synthetic' as const, idempotencyKey: attempt.idempotencyKey, status: 'accepted' as const,
    observedHostId: h.destination.identity.hostId, observedReceiverId: h.destination.identity.receiverId,
    observedModel: h.destination.model ?? null, at: attempt.createdAt, provenance: 'fake' as const };
  const document = syntheticEvidence({ dispatchId: h.result.dispatchId, attemptId: attempt.attemptId,
    receipt: receipt as Parameters<typeof syntheticEvidence>[0]['receipt'], packet: h.packet, model: h.destination.model ?? null });
  await h.evidence.append({ evidence: document, digest: await digestOf(document), fake: true, receivedAt: attempt.createdAt });
  await refreshed;
  await h.evidence.list();
  counters.evidenceFeed = h.receiver.fenceCalls();
  assert.deepEqual(counters, { recover: 0, reconcile: 0, checkStatus: 0, refresh: 0, selection: 0, evidenceFeed: 0 });
  assert.equal(h.receiver.calls.send, 1);
});

test('actual ConnectorPanelHost events select, request, cancel and confirm exactly one fence', async () => {
  const h = await setup();
  const window = new Window();
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const prior = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: window }, document: { configurable: true, value: window.document },
    HTMLElement: { configurable: true, value: window.HTMLElement }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
    assert.ok(button, `missing ${text}`);
    assert.equal(button.disabled, false);
    await act(async () => {
      button.click();
      if (h.controller.view().busy) await new Promise<void>((resolve) => {
        const stop = h.controller.subscribe(() => {
          if (!h.controller.view().busy) { stop(); resolve(); }
        });
      });
    });
  };
  try {
    await act(async () => { root.render(createElement(ConnectorPanelHost, { controller: h.controller })); });
    await click('Start a new thread');
    assert.equal(h.controller.view().selectedId, h.destination.destinationId);
    assert.equal(h.receiver.calls.send, 1);
    await click('Resolve unknown…');
    assert.match(container.textContent, /permanently unable to run/);
    assert.match(container.textContent, /If it already ran, HQ records that instead. Nothing is resent/);
    assert.equal(h.receiver.fenceCalls(), 0);
    await click('Cancel');
    assert.equal(h.controller.view().resolveUnknown.confirming, false);
    await click('Resolve unknown…');
    h.receiver.setFenceMode('unavailable');
    await click('Confirm resolve unknown');
    assert.equal(h.receiver.fenceCalls(), 1);
    assert.match(container.textContent, /Still unknown: fake fence unavailable/);
    assert.equal(h.receiver.calls.send, 1);
    assert.equal(await h.controller.confirmResolveUnknown(), null);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    names.forEach((name, i) => { if (prior[i]) Object.defineProperty(globalThis, name, prior[i]!); else Reflect.deleteProperty(globalThis, name); });
  }
});

test('server rendering shows controller-driven card; stale readback and cancel cannot fence', async () => {
  const h = await setup();
  h.controller.requestResolveUnknown();
  const html = renderToStaticMarkup(createElement(ConnectorPanelHost, { controller: h.controller }));
  assert.match(html, /Confirm resolve unknown/);
  await h.controller.checkStatus();
  const result = await h.controller.confirmResolveUnknown();
  assert.equal(result?.outcome, 'refused');
  assert.equal(h.receiver.fenceCalls(), 0);
  h.controller.requestResolveUnknown();
  h.controller.cancel();
  assert.equal(await h.controller.confirmResolveUnknown(), null);
});

test('compatibility entry points remain and fakes remain private', () => {
  for (const name of ['createOutbox', 'createConfirmation', 'createConnectorController', 'ConnectorPanel', 'ConnectorPanelHost',
    'destinationRows', 'newThreadControl', 'dispatchLifecycle', 'createLifecycleReader', 'readbackEvidence', 'intakeEvidence']) {
    assert.equal(typeof (entry as Record<string, unknown>)[name], 'function');
  }
  assert.equal('createFakeReceiver' in entry, false);
  assert.equal(entry.HANDOFF_SCHEMA, 'hq.design.handoff/v1');
  assert.equal(entry.DISPATCH_SCHEMA, 'hq.design.dispatch/v1');
});
