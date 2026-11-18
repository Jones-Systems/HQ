import { describe, expect, it } from 'vitest';
import { createFixturePlanner, MAX_REMEMBERED_REQUESTS, ReplayIndeterminateError, type FixtureWriteCall } from '../fixtures/adapter';
import { withFaults } from '../fixtures/faults';
import { PLANNER_PORT_KEYS, PLANNER_RECOVERY_KEYS, plannerErrorOf, PlannerPortError, type PlannerPort } from '../port';
import type { ItemPatch } from '../types';
import { clock, describePlannerPortConformance, failure, ids, rid } from './port-conformance';

// PlannerPort conformance against the fixture adapter, including T4's cases
// 1-6 (case 7 is in planning.test.ts). The fixture stands in for the service and
// has its ordinary-route semantics; the live adapter runs the same suite in
// live/test/adapter.test.ts with replay-aware semantics.

describePlannerPortConformance('fixture port (service semantics)', async ({ features, now, newId }) => {
  const fixture = createFixturePlanner({ now, newId, ...(features ? { features } : {}) });
  return { port: fixture.port, control: fixture.control, semantics: 'service' };
});

describe('case 6: the port surface has no execution member', () => {
  it('exposes exactly the Planner API keys', () => {
    const { port } = createFixturePlanner();
    expect(Object.keys(port).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
    expect(Object.keys(withFaults(port).port).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
  });

  it('contains no execution, export, import or backup member, in the port or its recovery', () => {
    const banned = /run|exec|dispatch|launch|job|thread|agent|submit|start|send|export|import|backup|restore|delete/iu;
    expect(PLANNER_PORT_KEYS.filter((key) => banned.test(key))).toEqual([]);
    expect(PLANNER_RECOVERY_KEYS.filter((key) => banned.test(key))).toEqual([]);
  });
});

describe('case 4: the types reject patch({status})', () => {
  it('is a compile-time error', () => {
    // @ts-expect-error RW-7: status changes are moves, never patches.
    const patch: ItemPatch = { status: 'done' };
    expect(patch).toBeDefined();
    const port = createFixturePlanner().port as PlannerPort;
    // @ts-expect-error RW-7 at the port boundary as well.
    void (() => port.patch('id', 1, { status: 'done' }, rid()));
  });
});

describe('the replay route (requests.replay) and its eviction floor', () => {
  async function planner() {
    const fixture = createFixturePlanner({ now: clock(), newId: ids() });
    const a = (await fixture.port.create({ title: 'A', status: 'next' }, rid())).item!;
    return { ...fixture, a };
  }
  const reviewed = (id: string, revision: number, requestId: string): FixtureWriteCall => ({ route: 'reviewed', params: { requestId, id, revision } });

  it('replays a retained record without applying it again', async () => {
    const { port, control, a } = await planner();
    const requestId = rid();
    const baseline = control.stateVersion();
    const first = await port.markReviewed(a.id, a.revision, requestId);
    const version = control.stateVersion();
    const lookup = await control.replay({ mode: 'lookup', requestId, original: reviewed(a.id, a.revision, requestId), sentAfterVersion: baseline });
    const resend = await control.replay({ mode: 'resend', requestId, original: reviewed(a.id, a.revision, requestId), sentAfterVersion: baseline });
    expect(lookup).toEqual({ outcome: 'replayed', response: first });
    expect(resend).toEqual({ outcome: 'replayed', response: first });
    expect(control.stateVersion()).toBe(version);
  });

  it('proves "not applied" from the baseline: lookup changes nothing, resend applies once under the original ID', async () => {
    const { control, a } = await planner();
    const requestId = rid();
    const baseline = control.stateVersion();
    const original = reviewed(a.id, a.revision, requestId);
    expect(await control.replay({ mode: 'lookup', requestId, original, sentAfterVersion: baseline })).toEqual({ outcome: 'not_applied' });
    expect(control.stateVersion()).toBe(baseline);
    const applied = await control.replay({ mode: 'resend', requestId, original, sentAfterVersion: baseline });
    expect(applied).toMatchObject({ outcome: 'applied_now', response: { item: { revision: a.revision + 1 } } });
    expect(control.hasRequestRecord(requestId)).toBe(true);
    expect(await control.replay({ mode: 'resend', requestId, original, sentAfterVersion: baseline })).toMatchObject({ outcome: 'replayed' });
    expect(control.stateVersion()).toBe(baseline + 1);
  });

  it('is indeterminate, changing nothing, without a baseline or once the floor passes it', async () => {
    const { port, control, a } = await planner();
    const lost = rid();
    const baseline = control.stateVersion();
    const original = reviewed(a.id, a.revision, lost);
    const missing = await control.replay({ mode: 'lookup', requestId: lost, original }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ReplayIndeterminateError);
    expect(missing).toMatchObject({ sentAfterVersion: null, evictedThroughVersion: 0 });

    let revision = a.revision;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS + 1; i += 1) revision = (await port.markReviewed(a.id, revision, rid())).item!.revision;
    expect(control.evictedThroughVersion()).toBeGreaterThan(baseline);
    const version = control.stateVersion();
    for (const mode of ['lookup', 'resend'] as const) {
      const evicted = await control.replay({ mode, requestId: lost, original, sentAfterVersion: baseline }).catch((e: unknown) => e);
      expect(evicted).toBeInstanceOf(ReplayIndeterminateError);
    }
    expect(control.stateVersion()).toBe(version);
    expect(control.hasRequestRecord(lost)).toBe(false);
  });

  it('only raises the eviction floor', async () => {
    const { port, control, a } = await planner();
    let revision = a.revision;
    const floors: number[] = [];
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS + 3; i += 1) {
      revision = (await port.markReviewed(a.id, revision, rid())).item!.revision;
      floors.push(control.evictedThroughVersion());
    }
    expect(floors).toEqual([...floors].sort((p, q) => p - q));
    expect(floors.at(-1)).toBeGreaterThan(0);
  });

  it('answers request_id_reused for a different body under a recorded ID, and rejects a future baseline', async () => {
    const { port, control, a } = await planner();
    const requestId = rid();
    await port.markReviewed(a.id, a.revision, requestId);
    const other: FixtureWriteCall = { route: 'patch', params: { requestId, id: a.id, revision: a.revision, patch: { notes: 'x' } } };
    expect(await failure(control.replay({ mode: 'lookup', requestId, original: other, sentAfterVersion: 0 }))).toEqual({ kind: 'request_id_reused' });
    expect(await failure(control.replay({ mode: 'lookup', requestId: rid(), original: reviewed(a.id, a.revision, 'mismatched-id'), sentAfterVersion: 0 }))).toMatchObject({ kind: 'invalid' });
    const fresh = rid();
    expect(await failure(control.replay({ mode: 'lookup', requestId: fresh, original: reviewed(a.id, a.revision, fresh), sentAfterVersion: control.stateVersion() + 1 }))).toMatchObject({ kind: 'invalid' });
  });
});

describe('error mapping for ordinary writes', () => {
  it('maps an indeterminate replay to unknown for a write outcome, and a non-Planner failure by call class', () => {
    expect(plannerErrorOf(new PlannerPortError({ kind: 'replay_indeterminate', requestId: 'req-00000001', reason: 'evicted' }))).toEqual({ kind: 'unknown', requestId: 'req-00000001' });
    expect(plannerErrorOf(new Error('lost'), 'req-00000002')).toEqual({ kind: 'unknown', requestId: 'req-00000002' });
    expect(plannerErrorOf(new Error('lost'))).toEqual({ kind: 'unavailable' });
  });
});
