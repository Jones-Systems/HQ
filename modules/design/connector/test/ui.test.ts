/**
 * Controller behaviour and a React server render of the panel.
 *
 * The render uses the real react-dom/server runtime, so it proves markup,
 * labels and disabled state. It does not prove browser layout, focus order in
 * a live window or Electron integration.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DestinationId } from '../src/ids.ts';
import type { HostCatalog } from '../src/host-catalog.ts';
import { ConnectorPanel } from '../src/ConnectorPanel.ts';
import { createConnectorController } from '../src/controller.ts';
import { NEW_THREAD_REASON, REAL_JONES_NOT_QUALIFIED_REASON } from '../src/eligibility.ts';
import { createMemoryEvidenceStore, syntheticCatalog, syntheticEvidence } from '../src/fakes.ts';
import { intakeEvidence } from '../src/evidence.ts';
import { createHarness } from './harness.ts';

async function setup() {
  const h = await createHarness();
  let catalog: HostCatalog = syntheticCatalog();
  const evidence = createMemoryEvidenceStore();
  const controller = createConnectorController({
    outbox: h.outbox, transports: h.transports, clock: h.clock, evidence,
    getCatalog: () => catalog,
  });
  await controller.setPacket(h.packet);
  return { h, controller, evidence, setCatalog: (next: HostCatalog) => { catalog = next; } };
}

const render = (view: ReturnType<ReturnType<typeof createConnectorController>['view']>) => renderToStaticMarkup(createElement(ConnectorPanel, {
  view, onSelect: () => {}, onRequestSend: () => {}, onConfirm: () => {}, onCancel: () => {}, onCheckStatus: () => {},
}));

describe('connector controller', () => {
  it('selecting and opening the confirmation never sends', async () => {
    const { h, controller } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    controller.requestSend();
    assert.ok(controller.view().confirmation);
    controller.cancel();
    assert.equal(h.receiver.calls.send + h.receiver.calls.identify + h.receiver.calls.lookup, 0);
  });

  it('a double confirm sends once and locks further sends', async () => {
    const { h, controller } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    controller.requestSend();
    const [a, b] = await Promise.all([controller.confirm(), controller.confirm()]);
    assert.equal(a?.outcome, 'attempted');
    assert.equal(b, null);
    assert.equal(h.receiver.handoffs.length, 1);
    const view = controller.view();
    assert.equal(view.status?.state, 'accepted');
    assert.equal(view.sendEnabled, false);
    assert.match(view.status?.explanation ?? '', /does not mean the work is complete/u);
  });

  it('refuses when the identity changed between showing and confirming', async () => {
    const { h, controller, setCatalog } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    controller.requestSend();
    const base = syntheticCatalog();
    setCatalog({
      ...base,
      destinations: base.destinations.map((entry) => entry.destinationId === 'dest.fake-existing'
        ? { ...entry, identity: { ...entry.identity, fingerprint: 'fp.rotated' } } : entry),
    });
    const result = await controller.confirm();
    assert.equal(result?.outcome === 'refused' ? result.code : null, 'identity-mismatch');
    assert.equal(h.receiver.calls.send, 0);
    assert.match(controller.view().message ?? '', /identity changed/u);
  });

  it('check status reads back without sending', async () => {
    const { h, controller } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    h.receiver.failNextSend('throw-after-effect');
    controller.requestSend();
    await controller.confirm();
    assert.equal(controller.view().status?.state, 'unknown');
    assert.equal(controller.view().status?.canCheckStatus, true);
    await controller.checkStatus();
    assert.equal(controller.view().status?.state, 'accepted');
    assert.equal(h.receiver.calls.send, 1);
  });

  it('returns a stable snapshot until something changes', async () => {
    const { controller } = await setup();
    assert.equal(controller.view(), controller.view());
    const before = controller.view();
    await controller.select('dest.fake-existing' as DestinationId);
    assert.notEqual(controller.view(), before);
  });
});

describe('connector panel render (react-dom/server)', () => {
  it('shows real Jones as not qualified and disables it with the reason', async () => {
    const { controller } = await setup();
    const html = render(controller.view());
    assert.match(html, /data-qualification="not-qualified"[^>]*data-selectable="false"/u);
    assert.ok(html.includes('Not qualified'));
    assert.ok(html.includes(REAL_JONES_NOT_QUALIFIED_REASON.replace(/'/gu, '&#x27;')));
    assert.match(html, /<input[^>]*value="dest\.jones-existing"[^>]*disabled=""[^>]*aria-describedby="hq-connector-reason-dest_jones-existing"|<input[^>]*disabled=""[^>]*value="dest\.jones-existing"/u);
  });

  it('renders the new-thread control disabled with its reason', async () => {
    const { controller } = await setup();
    const html = render(controller.view());
    assert.match(html, /<button type="button" disabled="" aria-describedby="hq-connector-new-thread-reason">Start a new thread<\/button>/u);
    assert.ok(html.includes(`id="hq-connector-new-thread-reason" class="hq-connector__reason">${NEW_THREAD_REASON}`));
  });

  it('labels the fake receiver and fake evidence as fake', async () => {
    const { h, controller, evidence } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    controller.requestSend();
    const confirmHtml = render(controller.view());
    assert.ok(confirmHtml.includes('This is the labelled fake receiver.'));
    const result = await controller.confirm();
    assert.equal(result?.outcome, 'attempted');
    if (result?.outcome !== 'attempted') return;
    const receipt = h.receiver.receiptFor(result.attempt.idempotencyKey);
    assert.ok(receipt);
    const intake = await intakeEvidence({ outbox: h.store, evidence, clock: h.clock },
      JSON.parse(JSON.stringify(syntheticEvidence({ dispatchId: result.dispatchId, attemptId: result.attempt.attemptId, receipt, packet: h.packet, model: h.destination.model ?? null }))));
    assert.ok(intake.ok);
    await controller.refresh();
    const html = render(controller.view());
    assert.ok(html.includes('Labelled fake receiver — not Jones. Nothing is sent to a real Jones receiver.'));
    assert.ok(html.includes('Fake evidence — from the labelled fake receiver'));
    assert.ok(!html.includes('From Jones'));
    assert.match(html, /data-state="accepted"/u);
  });

  it('offers a read-only status check for an unknown effect and no send', async () => {
    const { h, controller } = await setup();
    await controller.select('dest.fake-existing' as DestinationId);
    h.receiver.failNextSend('throw-before-effect');
    controller.requestSend();
    await controller.confirm();
    const html = render(controller.view());
    assert.ok(html.includes('Effect unknown'));
    assert.ok(html.includes('Check status (read-only)'));
    assert.match(html, /<button type="button" disabled="" aria-describedby="hq-connector-send-reason">Send…<\/button>/u);
  });
});
