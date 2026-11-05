/**
 * spec.hq-expansion#test.connector-lifecycle.001 — pinned route and the
 * manual-route / route-switch fence. Labelled fake receiver only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DestinationId } from '../src/ids.ts';
import type { HostCatalog } from '../src/host-catalog.ts';
import type { RouteSwitchAcknowledgement } from '../src/route-fence.ts';
import { ConnectorPanel } from '../src/ConnectorPanel.ts';
import { createConnectorController } from '../src/controller.ts';
import { createMemoryManualHandoffHistory, syntheticCatalog, syntheticDestination, syntheticManualHandoff } from '../src/fakes.ts';
import { dispatchLifecycle } from '../src/lifecycle.ts';
import { collectRouteSources, createRouteSwitchAcknowledgement, parseManualHandoffRecord, routeDrift } from '../src/route-fence.ts';
import { attempted, otherDestination, refusedWith } from './fixtures.ts';
import { createHarness } from './harness.ts';
import type { Harness } from './harness.ts';

/** A request with an acknowledgement of exactly the sources the owner would be shown now. */
async function acknowledgedRequest(h: Harness, history: ReturnType<typeof createMemoryManualHandoffHistory>, overrides: Parameters<Harness['request']>[0] = {}, adjust: (ack: RouteSwitchAcknowledgement) => RouteSwitchAcknowledgement = (ack) => ack) {
  const request = h.request(overrides);
  const dispatches = await h.outbox.list();
  const sources = collectRouteSources({
    packetId: request.packet.packetId, destinationId: request.destination.destinationId,
    dispatches, manualHandoffs: await history.listForPacket(request.packet.packetId),
  });
  const ack = createRouteSwitchAcknowledgement({ confirmation: request.confirmation, sources, clock: h.clock, newId: () => 'test' });
  return { ...request, routeSwitch: adjust(ack) };
}

describe('manual handoff history fences a send until acknowledged', () => {
  it('refuses with zero probes, sends and writes, then sends once with an exact acknowledgement', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet));
    refusedWith(await h.outbox.submit(h.request()), 'route-switch-unacknowledged');
    assert.equal(h.receiver.calls.identify + h.receiver.calls.send, 0);
    assert.equal(h.store.backing.size, 0, 'nothing was recorded for a refused send');

    const sent = attempted(await h.outbox.submit(await acknowledgedRequest(h, history)));
    assert.equal(sent.attempt.state, 'accepted');
    assert.equal(h.receiver.handoffs.length, 1);
  });

  it('fences every other history shape: wrong confirmation, packet, destination, future time or an unseen source', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet));
    const other = h.request();
    const cases: readonly [string, (ack: RouteSwitchAcknowledgement) => RouteSwitchAcknowledgement][] = [
      ['another confirmation', (ack) => ({ ...ack, confirmationId: other.confirmation.confirmationId })],
      ['another packet digest', (ack) => ({ ...ack, packetDigest: `sha256:${'a'.repeat(64)}` })],
      ['another destination', (ack) => ({ ...ack, destinationId: 'dest.elsewhere' as DestinationId })],
      ['a future time', (ack) => ({ ...ack, acknowledgedAt: '2999-01-01T00:00:00.000Z' })],
      ['no sources', (ack) => ({ ...ack, sources: [] })],
      ['a different source', (ack) => ({ ...ack, sources: ['manual:someone-else'] })],
    ];
    for (const [name, adjust] of cases) {
      const request = await acknowledgedRequest(h, history, {}, adjust);
      refusedWith(await h.outbox.submit(request), 'route-acknowledgement-mismatch');
      assert.equal(h.receiver.calls.send, 0, name);
    }
  });

  it('is not satisfied by an acknowledgement given before a newer record appeared', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet, 'manual.one'));
    const stale = await acknowledgedRequest(h, history);
    history.records.push(syntheticManualHandoff(h.packet, 'manual.two'));
    refusedWith(await h.outbox.submit(stale), 'route-acknowledgement-mismatch');
    assert.equal(h.receiver.calls.send, 0);
  });

  it('ignores history for another packet, and v1 composition without a history port is unchanged', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push({ ...syntheticManualHandoff(h.packet), packetId: 'pkt.unrelated' as typeof h.packet.packetId });
    attempted(await h.outbox.submit(h.request()));
    const v1 = await createHarness();
    attempted(await v1.outbox.submit(v1.request()));
  });

  it('fails closed when the history cannot be read', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.failNextRead();
    refusedWith(await h.outbox.submit(h.request()), 'route-history-unavailable');
    assert.equal(h.receiver.calls.identify + h.receiver.calls.send, 0);
    assert.equal(h.store.backing.size, 0);
  });

  it('never lets history resolve an unknown effect, even with an acknowledgement', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    h.receiver.failNextSend('throw-after-effect');
    const first = attempted(await h.outbox.submit(h.request()));
    assert.equal(first.attempt.state, 'unknown');
    history.records.push(syntheticManualHandoff(h.packet));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(await acknowledgedRequest(h, history)), 'unresolved-attempt');
    // Another destination for the same packet stays fenced too.
    refusedWith(await h.outbox.submit(await acknowledgedRequest(h, history, { destination: otherDestination() })), 'packet-fenced');
    assert.equal(h.receiver.calls.send, 1);
    const record = await h.outbox.get(first.dispatchId);
    assert.ok(record);
    assert.equal(dispatchLifecycle(record, [], { manualHandoffs: history.records }).stage, 'unknown');
  });

  it('does not let an acknowledgement reopen a same-destination handoff the receiver already holds', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet));
    attempted(await h.outbox.submit(await acknowledgedRequest(h, history)));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(await acknowledgedRequest(h, history)), 'already-handed-off');
    assert.equal(h.receiver.handoffs.length, 1);
  });

  it('keeps a consumed confirmation consumed', async () => {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet));
    h.receiver.failNextSend('reject');
    const request = await acknowledgedRequest(h, history);
    attempted(await h.outbox.submit(request));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(request), 'confirmation-consumed');
  });
});

describe('route-switch fence between destinations', () => {
  it('refuses a second destination once the receiver holds the packet, and sends only with an acknowledgement', async () => {
    for (const fault of [null, 'hold'] as const) {
      const history = createMemoryManualHandoffHistory();
      const h = await createHarness({ manualHandoffs: history });
      if (fault) h.receiver.failNextSend(fault);
      attempted(await h.outbox.submit(h.request()));
      h.clock.advance(1000);
      const second = { destination: otherDestination() };
      refusedWith(await h.outbox.submit(h.request(second)), 'route-switch-unacknowledged');
      assert.equal(h.receiver.handoffs.length, 1);
      const sent = attempted(await h.outbox.submit(await acknowledgedRequest(h, history, second)));
      assert.equal(sent.attempt.state, 'accepted');
      assert.equal(h.receiver.handoffs.length, 2);
    }
  });

  it('applies without a history port: a v1 composition cannot duplicate a held packet to another destination', async () => {
    const h = await createHarness();
    attempted(await h.outbox.submit(h.request()));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request({ destination: otherDestination() })), 'route-switch-unacknowledged');
  });

  it('does not fence a destination whose earlier dispatch had no effect', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('reject');
    attempted(await h.outbox.submit(h.request()));
    h.clock.advance(1000);
    attempted(await h.outbox.submit(h.request({ destination: otherDestination() })));
  });
});

describe('pinned route and parsing', () => {
  it('detects each kind of drift against the pin', async () => {
    const h = await createHarness();
    attempted(await h.outbox.submit(h.request()));
    const record = (await h.outbox.list())[0];
    assert.ok(record);
    const same = syntheticDestination();
    assert.deepEqual(routeDrift(record.destination, same), []);
    assert.deepEqual(routeDrift(record.destination, null), ['destination-missing']);
    assert.deepEqual(routeDrift(record.destination, { ...same, destinationId: 'dest.x' as DestinationId, mode: 'new-thread', endpoint: { transport: 'jones-code', locator: 'x' } }), ['destination', 'mode', 'endpoint']);
    const { model: _model, threadRef: _thread, ...bare } = same;
    assert.deepEqual(routeDrift(record.destination, bare), ['thread', 'model']);
  });

  it('parses a manual handoff record strictly', () => {
    const good = { recordId: 'manual.1', packetId: 'pkt.p1', packetDigest: `sha256:${'0'.repeat(64)}`, recordedAt: '2026-01-01T00:00:00.000Z' };
    assert.deepEqual(parseManualHandoffRecord(good), good);
    assert.equal(parseManualHandoffRecord({ ...good, extra: 1 }), null);
    assert.equal(parseManualHandoffRecord({ ...good, packetDigest: 'nope' }), null);
    assert.equal(parseManualHandoffRecord({ ...good, recordedAt: 'yesterday' }), null);
    assert.equal(parseManualHandoffRecord('x'), null);
  });
});

describe('controller and panel acknowledge route history explicitly', () => {
  async function setup() {
    const history = createMemoryManualHandoffHistory();
    const h = await createHarness({ manualHandoffs: history });
    history.records.push(syntheticManualHandoff(h.packet));
    const catalog: HostCatalog = syntheticCatalog();
    const controller = createConnectorController({
      outbox: h.outbox, transports: h.transports, clock: h.clock, getCatalog: () => catalog, manualHandoffs: history,
    });
    await controller.setPacket(h.packet);
    await controller.select('dest.fake-existing' as DestinationId);
    return { h, history, controller };
  }
  const render = (controller: ReturnType<typeof createConnectorController>) => renderToStaticMarkup(createElement(ConnectorPanel, {
    view: controller.view(), onSelect: () => {}, onRequestSend: () => {}, onConfirm: () => {}, onCancel: () => {}, onCheckStatus: () => {}, onAcknowledgeRouteHistory: () => {},
  }));

  it('requires the acknowledgement before Confirm is enabled, and sends nothing without it', async () => {
    const { h, controller } = await setup();
    assert.equal(controller.view().routeHistory.required, true);
    controller.requestSend();
    const html = render(controller);
    assert.ok(html.includes('already handed off another way'));
    assert.equal(controller.view().lifecycle?.routeAcknowledgementLabel !== null, true, 'the lifecycle view also shows it before sending');
    assert.match(html, /<button type="button" disabled="">Confirm send<\/button>/u);
    const refused = await controller.confirm();
    assert.equal(refused?.outcome, 'refused');
    assert.equal(h.receiver.calls.send + h.receiver.calls.identify, 0);
  });

  it('sends exactly once after the owner acknowledges, and clears the acknowledgement on cancel or reselect', async () => {
    const { h, controller } = await setup();
    controller.requestSend();
    controller.acknowledgeRouteHistory(true);
    assert.equal(controller.view().routeHistory.acknowledged, true);
    assert.doesNotMatch(render(controller), /<button type="button" disabled="">Confirm send/u);
    controller.cancel();
    assert.equal(controller.view().routeHistory.acknowledged, false);
    controller.requestSend();
    controller.acknowledgeRouteHistory(true);
    const result = await controller.confirm();
    assert.equal(result?.outcome, 'attempted');
    assert.equal(h.receiver.handoffs.length, 1);
  });

  it('pauses sending when the history cannot be read', async () => {
    const { history, controller } = await setup();
    history.failNextRead();
    await controller.refresh();
    assert.equal(controller.view().sendEnabled, false);
    assert.match(controller.view().sendDisabledReason ?? '', /could not be read/u);
  });

  it('drops the acknowledgement on refresh so a record that appeared later must be seen again', async () => {
    const { h, history, controller } = await setup();
    controller.requestSend();
    controller.acknowledgeRouteHistory(true);
    history.records.push(syntheticManualHandoff(h.packet, 'manual.later'));
    await controller.refresh();
    assert.equal(controller.view().routeHistory.acknowledged, false);
  });
});
