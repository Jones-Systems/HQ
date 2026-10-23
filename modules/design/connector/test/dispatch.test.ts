import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Attempt, AttemptState } from '../src/dispatch.ts';
import { ATTEMPT_STATES, DispatchTransitionError, canTransition, hasEffect, isNoEffect, isUnresolved, transitionAttempt } from '../src/dispatch.ts';

const attempt = (state: AttemptState): Attempt => ({
  attemptId: 'dsp_x.a1' as Attempt['attemptId'], ordinal: 1, idempotencyKey: 'dsp_x.a1',
  confirmationId: 'cfm_1' as Attempt['confirmationId'], confirmedAt: '2026-01-01T00:00:00.000Z', sessionId: 's',
  wireDigest: `sha256:${'0'.repeat(64)}`, state, basis: 'local-preflight',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resolvedAt: null,
  receipt: null, reason: null, variances: [], readbacks: 0, lastReadbackAt: null,
});

describe('dispatch/v1 state machine', () => {
  it('classifies every state into exactly one of unresolved, effect or no-effect', () => {
    for (const state of ATTEMPT_STATES) {
      const classes = [isUnresolved(state), hasEffect(state), isNoEffect(state)].filter(Boolean).length;
      assert.equal(classes, 1, state);
    }
  });

  it('never returns to submitting and never leaves a no-effect state', () => {
    for (const from of ATTEMPT_STATES) assert.equal(canTransition(from, 'submitting'), false, from);
    for (const from of ['rejected', 'blocked', 'no-effect'] as const) {
      for (const to of ATTEMPT_STATES) assert.equal(canTransition(from, to), false, `${from}→${to}`);
    }
  });

  it('only an unknown attempt can become no-effect, and accepted stays accepted', () => {
    const toNoEffect = ATTEMPT_STATES.filter((from) => canTransition(from, 'no-effect'));
    assert.deepEqual(toNoEffect, ['unknown']);
    assert.deepEqual(ATTEMPT_STATES.filter((to) => canTransition('accepted', to)), ['accepted']);
    assert.equal(canTransition('submitting', 'no-effect'), false, 'a local send failure is unknown, not no-effect');
  });

  it('throws on an illegal transition and stamps resolvedAt on no-effect', () => {
    assert.throws(() => transitionAttempt(attempt('accepted'), { state: 'rejected', basis: 'readback', at: '2026-01-01T00:00:01.000Z' }), DispatchTransitionError);
    const resolved = transitionAttempt(attempt('unknown'), { state: 'no-effect', basis: 'readback', at: '2026-01-01T00:00:02.000Z', readback: true });
    assert.equal(resolved.resolvedAt, '2026-01-01T00:00:02.000Z');
    assert.equal(resolved.readbacks, 1);
  });
});
