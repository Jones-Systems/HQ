/**
 * spec.hq-design#test.connector.001 — dispatch/v1 outbox behavioral checks.
 * All transports are the labelled fake receiver; no real dispatch occurs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Handoff } from '../src/contract.ts';
import type { SubmitResult } from '../src/outbox.ts';
import type { DestinationId } from '../src/ids.ts';
import { syntheticDestination } from '../src/fakes.ts';
import { createHarness } from './harness.ts';

function attempted(result: SubmitResult) {
  assert.equal(result.outcome, 'attempted', `expected an attempt, got ${JSON.stringify(result)}`);
  return result as Extract<SubmitResult, { outcome: 'attempted' }>;
}

function refusedWith(result: SubmitResult, code: string) {
  assert.equal(result.outcome, 'refused', `expected refusal ${code}, got ${JSON.stringify(result)}`);
  assert.equal((result as Extract<SubmitResult, { outcome: 'refused' }>).code, code);
}

describe('submitting is durable before transport', () => {
  it('persists submitting before identify and send', async () => {
    const h = await createHarness();
    const result = attempted(await h.outbox.submit(h.request()));
    assert.equal(result.attempt.state, 'accepted');
    const ops = h.trace.events.map((event) => `${event.actor}:${event.op}`);
    assert.deepEqual(ops, ['store:put:submitting', 'transport:identify', 'transport:send', 'store:put:accepted']);
  });

  it('makes no transport call when persisting submitting fails', async () => {
    const h = await createHarness();
    h.store.failNextPut('throw-before-write', 'submitting');
    const result = await h.outbox.submit(h.request());
    assert.equal(result.outcome, 'persist-failed');
    assert.deepEqual(h.receiver.calls, { identify: 0, send: 0, lookup: 0 });
    assert.equal(h.store.backing.size, 0);
  });

  it('makes no transport call when the submitting write lands but its acknowledgement is lost', async () => {
    const h = await createHarness();
    h.store.failNextPut('throw-after-write', 'submitting');
    const result = await h.outbox.submit(h.request());
    assert.equal(result.outcome, 'persist-failed');
    assert.equal(h.receiver.calls.send, 0);
    assert.equal(h.receiver.calls.identify, 0);
    // The stray record is treated conservatively as unknown and needs readback, never a resend.
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'unresolved-attempt');
    assert.equal(h.receiver.calls.send, 0);
  });
});

describe('exactly one handoff', () => {
  it('a double click produces one handoff', async () => {
    const h = await createHarness();
    const first = h.outbox.submit(h.request());
    const second = h.outbox.submit(h.request());
    const [a, b] = await Promise.all([first, second]);
    assert.equal(attempted(a).attempt.state, 'accepted');
    refusedWith(b, 'in-flight');
    assert.equal(h.receiver.handoffs.length, 1);
    assert.equal(h.receiver.calls.send, 1);
  });

  it('a click after acceptance never starts another attempt', async () => {
    const h = await createHarness();
    attempted(await h.outbox.submit(h.request()));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'already-handed-off');
    assert.equal(h.receiver.handoffs.length, 1);
  });

  it('concurrent submits from two processes on one store still produce one handoff', async () => {
    const h = await createHarness();
    const first = h.outbox;
    const second = h.restart();
    const [a, b] = await Promise.all([first.submit(h.request()), second.submit(h.request())]);
    const outcomes = [a, b].map((r) => r.outcome === 'attempted' ? 'attempted' : (r as Extract<SubmitResult, { outcome: 'refused' }>).code);
    assert.deepEqual(outcomes.sort(), ['attempted', 'in-flight']);
    assert.equal(h.receiver.handoffs.length, 1);
    assert.equal(h.receiver.calls.send, 1);
  });

  it('a restart after the effect but before the receipt was saved produces exactly one handoff', async () => {
    const h = await createHarness();
    h.store.failNextPut('throw-before-write', 'accepted'); // crash window: receiver accepted, receipt not durable
    const first = attempted(await h.outbox.submit(h.request()));
    assert.equal(first.persisted, false);
    assert.equal(h.receiver.handoffs.length, 1);

    const restarted = h.restart();
    const recovered = await restarted.recover();
    assert.deepEqual(recovered.map((r) => [r.before, r.after]), [['submitting', 'unknown']]);
    assert.equal(h.receiver.calls.lookup, 0, 'recovery does not even read back');

    h.clock.advance(1000);
    refusedWith(await restarted.submit(h.request()), 'unresolved-attempt');
    assert.equal(h.receiver.calls.send, 1);

    const [report] = await restarted.reconcile(first.dispatchId);
    assert.equal(report?.after, 'accepted');
    assert.equal(h.receiver.calls.send, 1);
    assert.equal(h.receiver.handoffs.length, 1);
    h.clock.advance(1000);
    refusedWith(await restarted.submit(h.request()), 'already-handed-off');
  });

  it('a restart while a send is in flight leaves the attempt unknown and never resends', async () => {
    const h = await createHarness({ sendTimeoutMs: 30 });
    h.receiver.failNextSend('hang-before-effect');
    const crashed = h.outbox.submit(h.request());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const restarted = h.restart();
    const recovered = await restarted.recover();
    assert.deepEqual(recovered.map((r) => r.after), ['unknown']);
    h.clock.advance(1000);
    refusedWith(await restarted.submit(h.request()), 'unresolved-attempt');
    const late = attempted(await crashed);
    assert.equal(late.persisted, false, 'the dead process cannot overwrite the recovered record');
    assert.equal(h.receiver.calls.send, 1);
    const record = await restarted.get(late.dispatchId);
    assert.equal(record?.attempts.at(-1)?.state, 'unknown');
    assert.equal(record?.attempts.at(-1)?.basis, 'interrupted');
  });
});

describe('unknown effects are fenced', () => {
  for (const fault of ['throw-after-effect', 'throw-before-effect', 'hang-after-effect', 'hang-before-effect', 'malformed'] as const) {
    it(`fault ${fault} becomes unknown and is never resent`, async () => {
      const h = await createHarness({ sendTimeoutMs: 20 });
      h.receiver.failNextSend(fault);
      const result = attempted(await h.outbox.submit(h.request()));
      assert.equal(result.attempt.state, 'unknown');
      assert.equal(h.receiver.calls.send, 1);

      for (let i = 0; i < 3; i += 1) {
        h.clock.advance(1000);
        refusedWith(await h.outbox.submit(h.request()), 'unresolved-attempt');
      }
      const restarted = h.restart();
      await restarted.recover();
      h.clock.advance(1000);
      refusedWith(await restarted.submit(h.request()), 'unresolved-attempt');
      assert.equal(h.receiver.calls.send, 1, 'no resend and no new attempt');
      const record = await restarted.get(result.dispatchId);
      assert.equal(record?.attempts.length, 1);
    });
  }

  it('a non-authoritative absence keeps the attempt unknown', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('throw-before-effect');
    const { dispatchId } = attempted(await h.outbox.submit(h.request()));
    h.receiver.setLookupMode('absence-only');
    const [report] = await h.outbox.reconcile(dispatchId);
    assert.equal(report?.after, 'unknown');
    h.receiver.setLookupMode('unavailable');
    const [again] = await h.outbox.reconcile(dispatchId);
    assert.equal(again?.after, 'unknown');
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'unresolved-attempt');
    const record = await h.outbox.get(dispatchId);
    assert.equal(record?.attempts[0]?.readbacks, 2);
  });

  it('fences other destinations for the same packet while an effect is unknown', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('throw-after-effect');
    attempted(await h.outbox.submit(h.request()));
    const other = syntheticDestination({ destinationId: 'dest.fake-other' as DestinationId, label: 'Other fake' });
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request({ destination: other })), 'packet-fenced');
    assert.equal(h.receiver.calls.send, 1);
  });
});

describe('reconciliation never sends', () => {
  it('reads back unknown, held and interrupted attempts with zero sends', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('throw-after-effect');
    const unknown = attempted(await h.outbox.submit(h.request()));
    const sendsBefore = h.receiver.calls.send;
    const identifiesBefore = h.receiver.calls.identify;

    const reports = await h.outbox.reconcile();
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.after, 'accepted');
    await h.outbox.reconcile();
    await h.restart().reconcile();
    assert.equal(h.receiver.calls.send, sendsBefore, 'zero transport sends');
    assert.equal(h.receiver.calls.identify, identifiesBefore, 'reconciliation does not probe either');
    assert.ok(h.receiver.calls.lookup >= 1);
    assert.equal((await h.outbox.get(unknown.dispatchId))?.attempts.length, 1);
  });

  it('follows a held handoff to accepted by readback only', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('hold');
    const held = attempted(await h.outbox.submit(h.request()));
    assert.equal(held.attempt.state, 'held');
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'already-handed-off');
    h.receiver.promoteHeld(held.attempt.idempotencyKey);
    const [report] = await h.outbox.reconcile(held.dispatchId);
    assert.equal(report?.after, 'accepted');
    assert.equal(h.receiver.calls.send, 1);
  });
});

describe('new attempts need authoritative no-effect plus fresh confirmation', () => {
  it('allows a new attempt only after no-effect and a confirmation made afterwards', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('throw-before-effect');
    const first = attempted(await h.outbox.submit(h.request()));
    assert.equal(first.attempt.state, 'unknown');

    // A confirmation made before the no-effect result is not fresh.
    h.clock.advance(500);
    const early = h.request();
    h.clock.advance(500);
    const [report] = await h.outbox.reconcile(first.dispatchId);
    assert.equal(report?.after, 'no-effect');
    h.clock.advance(500);
    refusedWith(await h.outbox.submit(early), 'confirmation-not-fresh');
    assert.equal(h.receiver.calls.send, 1);

    h.clock.advance(500);
    const fresh = h.request();
    const second = attempted(await h.outbox.submit(fresh));
    assert.equal(second.attempt.state, 'accepted');
    assert.equal(second.attempt.ordinal, 2);
    assert.notEqual(second.attempt.idempotencyKey, first.attempt.idempotencyKey);
    assert.equal(h.receiver.handoffs.length, 1);

    const record = await h.outbox.get(first.dispatchId);
    assert.deepEqual(record?.attempts.map((a) => a.state), ['no-effect', 'accepted'], 'earlier attempt kept intact');
  });

  it('refuses to reuse a consumed confirmation', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('reject');
    const request = h.request();
    const first = attempted(await h.outbox.submit(request));
    assert.equal(first.attempt.state, 'rejected');
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(request), 'confirmation-consumed');
    h.clock.advance(1000);
    assert.equal(attempted(await h.outbox.submit(h.request())).attempt.state, 'accepted');
  });

  it('refuses an expired confirmation', async () => {
    const h = await createHarness();
    const request = h.request();
    h.clock.advance(10 * 60_000);
    refusedWith(await h.outbox.submit(request), 'confirmation-expired');
    assert.equal(h.receiver.calls.send, 0);
  });

  it('a late delivery after an authoritative no-effect cannot take effect', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('throw-before-effect');
    const first = attempted(await h.outbox.submit(h.request()));
    await h.outbox.reconcile(first.dispatchId);
    const replay = { idempotencyKey: first.attempt.idempotencyKey, destination: { model: null } } as unknown as Handoff;
    const outcome = await h.receiver.send(replay, h.destination.endpoint, new AbortController().signal);
    assert.equal(outcome.kind, 'rejected');
    assert.equal(h.receiver.receiptFor(first.attempt.idempotencyKey), null);
    assert.equal(h.receiver.handoffs.length, 0);
  });
});

describe('identity and fallback', () => {
  it('blocks when the destination identity changed after confirmation', async () => {
    const h = await createHarness();
    const changed = syntheticDestination({
      identity: { ...h.destination.identity, fingerprint: 'fp.synthetic-changed' },
    });
    refusedWith(await h.outbox.submit(h.request({ destination: changed, shown: h.destination })), 'identity-mismatch');
    assert.deepEqual(h.receiver.calls, { identify: 0, send: 0, lookup: 0 });
  });

  it('blocks before sending when the receiver reports a different identity', async () => {
    const h = await createHarness();
    h.receiver.setIdentity({ ...h.destination.identity, fingerprint: 'fp.impostor' });
    const result = attempted(await h.outbox.submit(h.request()));
    assert.equal(result.attempt.state, 'blocked');
    assert.equal(h.receiver.calls.identify, 1);
    assert.equal(h.receiver.calls.send, 0);
    assert.equal(h.receiver.handoffs.length, 0);
  });

  it('never falls back to another destination when the chosen one is ineligible', async () => {
    const h = await createHarness();
    const stale = syntheticDestination({
      destinationId: 'dest.fake-stale' as DestinationId,
      freshness: { status: 'stale', lastSuccessAt: null, generation: 1 },
    });
    refusedWith(await h.outbox.submit(h.request({ destination: stale })), 'not-fresh');
    const offline = syntheticDestination({ status: 'unreachable' });
    refusedWith(await h.outbox.submit(h.request({ destination: offline })), 'not-reachable');
    assert.deepEqual(h.receiver.calls, { identify: 0, send: 0, lookup: 0 });
    assert.equal(h.store.backing.size, 0);
  });

  it('refuses real Jones and new-thread destinations', async () => {
    const h = await createHarness();
    const jones = syntheticDestination({ endpoint: { transport: 'jones-code', locator: 'jones:receiver-synthetic' } });
    refusedWith(await h.outbox.submit(h.request({ destination: jones })), 'transport-not-qualified');
    const { threadRef: _t, ...base } = syntheticDestination();
    const newThread = { ...base, mode: 'new-thread' as const };
    refusedWith(await h.outbox.submit(h.request({ destination: newThread })), 'new-thread-unavailable');
    assert.equal(h.receiver.calls.send, 0);
  });

  it('sends with fallback forbidden and the pinned model; a substituted model is recorded, not retried', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('substitute-model');
    const result = attempted(await h.outbox.submit(h.request()));
    assert.equal(h.receiver.handoffs[0]?.fallback, 'forbidden');
    assert.deepEqual(h.receiver.handoffs[0]?.destination.model, h.destination.model);
    assert.equal(result.attempt.state, 'accepted');
    assert.deepEqual(result.attempt.variances, ['model-mismatch']);
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'already-handed-off');
    assert.equal(h.receiver.calls.send, 1);
  });

  it('records a substituted host as a variance', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('substitute-host');
    const result = attempted(await h.outbox.submit(h.request()));
    assert.deepEqual(result.attempt.variances, ['host-mismatch']);
  });

  it('refuses a body that does not match its frozen digest', async () => {
    const h = await createHarness();
    const request = h.request();
    const tampered = { ...request, packet: { ...request.packet, body: { tampered: true } } };
    refusedWith(await h.outbox.submit(tampered), 'packet-digest-mismatch');
    assert.equal(h.receiver.calls.send, 0);
  });

  it('keeps wire and authoring digests distinct', async () => {
    const h = await createHarness();
    const result = attempted(await h.outbox.submit(h.request()));
    assert.notEqual(result.attempt.wireDigest, h.packet.packetDigest);
    assert.match(result.attempt.wireDigest, /^sha256:[0-9a-f]{64}$/u);
  });
});
