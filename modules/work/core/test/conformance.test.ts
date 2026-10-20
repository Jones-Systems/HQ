import { describe, expect, it } from 'vitest';
import { createFixturePlanner, MAX_REMEMBERED_REQUESTS } from '../fixtures/adapter';
import { withFaults } from '../fixtures/faults';
import { PLANNER_PORT_KEYS, PlannerPortError, type PlannerError, type PlannerPort } from '../port';
import { HQ_REFERENCES_FEATURE, type Item, type ItemPatch } from '../types';

// PlannerPort conformance against the fixture adapter, including T4's cases
// 1-6 (case 7 is in planning.test.ts). The fixture stands in for the service.

function clock(start = '2026-10-21T16:00:00.000Z') {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}
function ids() {
  let n = 0;
  return () => `item${String((n += 1)).padStart(12, '0')}`;
}
let requestCounter = 0;
const rid = () => `req-${String((requestCounter += 1)).padStart(8, '0')}`;

async function failure(promise: Promise<unknown>): Promise<PlannerError> {
  try {
    await promise;
  } catch (reason) {
    if (reason instanceof PlannerPortError) return reason.error;
    throw reason;
  }
  throw new Error('expected a Planner failure');
}

async function seeded() {
  const fixture = createFixturePlanner({ now: clock(), newId: ids() });
  const { port } = fixture;
  const c = (await port.create({ title: 'C', status: 'next' }, rid())).item!;
  const b = (await port.create({ title: 'B', status: 'next' }, rid())).item!;
  const a = (await port.create({ title: 'A', status: 'next' }, rid())).item!;
  const x = (await port.create({ title: 'X', status: 'active' }, rid())).item!;
  const y = (await port.create({ title: 'Y', status: 'active' }, rid())).item!;
  return { ...fixture, a, b, c, x, y };
}
const order = (items: Item[], status: string) => items.filter((i) => i.status === status).sort((p, q) => p.position - q.position).map((i) => i.title);

describe('case 6: the port surface has no execution member', () => {
  it('exposes exactly the Planner API keys', () => {
    const { port } = createFixturePlanner();
    expect(Object.keys(port).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
    expect(Object.keys(withFaults(port).port).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
  });

  it('contains no execution, export, import or backup member', () => {
    const banned = /run|exec|dispatch|launch|job|thread|agent|submit|start|send|export|import|backup|restore|delete/iu;
    expect(PLANNER_PORT_KEYS.filter((key) => banned.test(key))).toEqual([]);
  });
});

describe('case 1: anchors, conflicts and target-only renumbering', () => {
  it('places with after, before, top and bottom anchors', async () => {
    const { port, a, b, c, y } = await seeded();
    expect(order((await port.snapshot()).items, 'next')).toEqual(['A', 'B', 'C']);
    let r = await port.move(a.id, a.revision, 'next', { after_id: b.id }, rid());
    expect(order((await port.snapshot()).items, 'next')).toEqual(['B', 'A', 'C']);
    r = await port.move(a.id, r.item!.revision, 'next', { before_id: b.id }, rid());
    expect(order((await port.snapshot()).items, 'next')).toEqual(['A', 'B', 'C']);
    r = await port.move(a.id, r.item!.revision, 'next', { place: 'bottom' }, rid());
    expect(order((await port.snapshot()).items, 'next')).toEqual(['B', 'C', 'A']);
    await port.move(c.id, c.revision, 'next', { place: 'top' }, rid());
    expect(order((await port.snapshot()).items, 'next')).toEqual(['C', 'B', 'A']);
    expect((await port.snapshot()).items.find((i) => i.id === y.id)!.revision).toBe(1);
  });

  it('returns order_conflict for a missing anchor and changes nothing', async () => {
    const { port, control, a } = await seeded();
    const before = control.stored();
    const version = control.stateVersion();
    expect(await failure(port.move(a.id, a.revision, 'next', { after_id: 'not-there' }, rid()))).toEqual({ kind: 'order_conflict' });
    expect(control.stored()).toEqual(before);
    expect(control.stateVersion()).toBe(version);
  });

  it('returns revision_conflict with the current item for a stale revision', async () => {
    const { port, a } = await seeded();
    const edited = (await port.patch(a.id, a.revision, { notes: 'newer' }, rid())).item!;
    const error = await failure(port.move(a.id, a.revision, 'done', { place: 'top' }, rid()));
    expect(error).toEqual({ kind: 'revision_conflict', current: edited });
  });

  it('renumbers only the target status on a cross-status move', async () => {
    const { port, control, a, x, y } = await seeded();
    const sourceBefore = control.stored().filter((i) => i.status === 'next' && i.id !== a.id).map((i) => [i.id, i.position, i.revision]);
    const result = await port.move(a.id, a.revision, 'active', { after_id: y.id }, rid());
    expect(order((await port.snapshot()).items, 'active')).toEqual(['Y', 'A', 'X']);
    expect(control.stored().filter((i) => i.status === 'next').map((i) => [i.id, i.position, i.revision])).toEqual(sourceBefore);
    expect(control.stored().filter((i) => i.status === 'active').map((i) => i.position)).toEqual([1024, 2048, 3072]);
    expect(result.item).toMatchObject({ status: 'active', revision: a.revision + 1 });
    expect(result.changed.map((i) => i.id).sort()).toEqual([a.id, x.id, y.id].sort());
    // Neighbours are renumbered without a revision bump, as in the service.
    expect(control.stored().find((i) => i.id === x.id)!.revision).toBe(1);
  });

  it('treats an unchanged place as a no-op without a revision bump', async () => {
    const { port, a, b } = await seeded();
    const result = await port.move(a.id, a.revision, 'next', { before_id: b.id }, rid());
    expect(result.item!.revision).toBe(a.revision);
  });

  it('rejects an unknown status and a non-integer revision as invalid', async () => {
    const { port, a } = await seeded();
    expect(await failure(port.move(a.id, a.revision, 'later' as never, { place: 'top' }, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'status', message: 'Unknown status.' }] });
    expect(await failure(port.markReviewed(a.id, 1.5, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'revision', message: 'A numeric base revision is required.' }] });
    expect(await failure(port.markReviewed('nothing-here', 1, rid()))).toEqual({ kind: 'not_found' });
  });
});

describe('case 2: actual replay and request_id_reused', () => {
  it('replays the same ID and body with replayed: true and applies once', async () => {
    const { port, control } = await seeded();
    const requestId = rid();
    const first = await port.create({ title: 'Once' }, requestId);
    const again = await port.create({ title: 'Once' }, requestId);
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(control.stored().filter((i) => i.title === 'Once')).toHaveLength(1);
  });

  it('rejects the same ID with a different body and changes nothing', async () => {
    const { port, control, a } = await seeded();
    const requestId = rid();
    await port.patch(a.id, a.revision, { notes: 'first' }, requestId);
    const version = control.stateVersion();
    expect(await failure(port.patch(a.id, a.revision, { notes: 'second' }, requestId))).toEqual({ kind: 'request_id_reused' });
    expect(await failure(port.markReviewed(a.id, a.revision, requestId))).toEqual({ kind: 'request_id_reused' });
    expect(control.stateVersion()).toBe(version);
    expect(control.stored().find((i) => i.id === a.id)!.notes).toBe('first');
  });

  it('replays a revision-guarded write even after the item moved on', async () => {
    const { port, a } = await seeded();
    const requestId = rid();
    const first = await port.patch(a.id, a.revision, { notes: 'kept' }, requestId);
    await port.patch(a.id, first.item!.revision, { notes: 'newer' }, rid());
    const replay = await port.patch(a.id, a.revision, { notes: 'kept' }, requestId);
    expect(replay.replayed).toBe(true);
    expect(replay.item!.notes).toBe('kept');
  });

  it('records nothing for a failed request, so the same ID can be retried', async () => {
    const { port, a } = await seeded();
    const requestId = rid();
    await failure(port.move(a.id, a.revision, 'next', { after_id: 'gone' }, requestId));
    const retried = await port.move(a.id, a.revision, 'next', { place: 'bottom' }, requestId);
    expect(retried.replayed).toBe(false);
  });

  it('remembers only the last 2,000 request IDs', async () => {
    const { port, control, a } = await seeded();
    const oldest = rid();
    await port.create({ title: 'Oldest' }, oldest);
    let revision = a.revision;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS; i += 1) revision = (await port.markReviewed(a.id, revision, rid())).item!.revision;
    expect(control.requestRecordCount()).toBe(MAX_REMEMBERED_REQUESTS);
    expect(control.hasRequestRecord(oldest)).toBe(false);
    // An expired create re-sent with the same ID is applied again: a duplicate.
    expect((await port.create({ title: 'Oldest' }, oldest)).replayed).toBe(false);
    expect(control.stored().filter((i) => i.title === 'Oldest')).toHaveLength(2);
  });

  it('rejects a malformed request ID', async () => {
    const { port } = await seeded();
    expect(await failure(port.create({ title: 'x' }, 'short'))).toEqual({ kind: 'invalid', errors: [{ field: 'requestId', message: 'Malformed X-Request-Id.' }] });
  });
});

describe('case 3: create lands at the top and keeps its dates exactly', () => {
  it('places every create at the top of its status', async () => {
    const { port } = await seeded();
    await port.create({ title: 'Newest', status: 'next' }, rid());
    expect(order((await port.snapshot()).items, 'next')).toEqual(['Newest', 'A', 'B', 'C']);
    expect(order((await port.snapshot()).items, 'inbox')).toEqual([]);
    expect((await port.create({ title: 'Default' }, rid())).item).toMatchObject({ status: 'inbox', kind: 'idea', revision: 1 });
  });

  it('keeps date kind and precision exactly and derives timed instants on read', async () => {
    const { port } = await seeded();
    const result = await port.create({
      title: 'Dated', dates: [
        { kind: 'start', precision: 'quarter', value: '2027-Q2' },
        { kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', end_time: '11:00', tz: 'America/New_York' },
      ],
    }, rid());
    expect(result.item!.dates.map(({ kind, precision, value }) => ({ kind, precision, value }))).toEqual([
      { kind: 'start', precision: 'quarter', value: '2027-Q2' }, { kind: 'event', precision: 'day', value: '2026-11-14' },
    ]);
    expect(result.item!.dates[1]).toMatchObject({ instant: '2026-11-14T15:00:00Z', end_instant: '2026-11-14T16:00:00Z', tz_abbr: 'EST' });
  });

  it('returns validation errors as field messages and stores nothing', async () => {
    const { port, control } = await seeded();
    const count = control.stored().length;
    expect(await failure(port.create({ title: '' }, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'title', message: 'Required.' }] });
    expect(control.stored()).toHaveLength(count);
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

describe('settings, archive, review and history', () => {
  it('validates and merges settings', async () => {
    const { port } = createFixturePlanner();
    const result = await port.updateSettings({ default_tz: 'Europe/Berlin', week_start: 'mon', stale_days: 14 }, rid());
    expect(result.settings).toEqual({ default_tz: 'Europe/Berlin', week_start: 'mon', stale_days: 14 });
    expect(await failure(port.updateSettings({ default_tz: 'Nowhere/Land', week_start: 'mon', stale_days: 14 }, rid()))).toMatchObject({ kind: 'invalid' });
    expect((await port.snapshot()).settings.default_tz).toBe('Europe/Berlin');
  });

  it('archives without touching status or position, and logs history', async () => {
    const { port, a } = await seeded();
    const archived = (await port.setArchived(a.id, a.revision, true, rid())).item!;
    expect(archived).toMatchObject({ status: 'next', position: a.position, revision: a.revision + 1 });
    expect(archived.archived_at).not.toBeNull();
    expect((await port.setArchived(a.id, archived.revision, true, rid())).changed).toEqual([]);
    const reviewed = (await port.markReviewed(a.id, archived.revision, rid())).item!;
    expect(reviewed.updated_at).toBe(archived.updated_at);
    expect((await port.history(a.id)).map((h) => h.action)).toEqual(['reviewed', 'archived', 'created']);
  });

  it('advertises features and gates hq references on them', async () => {
    const target = { version: 1 as const, domain: 'social' as const, projectId: 'fixture-project', kind: 'draft', entityId: 'draft-1', title: 'Spring post', returnDestination: { domain: 'work' as const, destination: 'home' } };
    const off = createFixturePlanner().port;
    expect((await off.snapshot()).features).toEqual([]);
    expect(await failure(off.create({ title: 'L', references: [{ kind: 'hq', target }] }, rid()))).toMatchObject({ kind: 'invalid' });
    const on = createFixturePlanner({ features: [HQ_REFERENCES_FEATURE] }).port;
    const created = await on.create({ title: 'L', references: [{ kind: 'hq', target }] }, rid());
    expect(created.item!.references[0]).toMatchObject({ kind: 'hq', label: 'Spring post', target });
  });
});
