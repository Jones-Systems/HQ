import { describe, expect, it } from 'vitest';
import type { FixtureControl } from '../fixtures/adapter';
import { MAX_REMEMBERED_REQUESTS } from '../fixtures/adapter';
import { PlannerPortError, type PlannerPort, type PlannerRecoveryError } from '../port';
import { HQ_REFERENCES_FEATURE, type Item } from '../types';

// The shared PlannerPort conformance suite (T4 cases 1-3 and the settings, archive, review and history behaviour).
// Each harness wraps the one fixture Planner: the bare fixture port has the service's ordinary-route semantics; the
// live adapter over a fixture-backed transport has the replay-aware semantics. They differ in one place only, which
// the suite states explicitly: what a same-ID send does after the request record is evicted.

export interface PlannerPortHarness {
  port: PlannerPort;
  control: Pick<FixtureControl, 'stored' | 'stateVersion' | 'requestRecordCount' | 'hasRequestRecord'>;
  /**
   * `service`: a same-ID send goes through the ordinary route, as the Planner service handles it.
   * `replay-aware`: a same-ID send of a recorded intent goes only through the replay route.
   */
  semantics: 'service' | 'replay-aware';
}

export interface HarnessOptions {
  features?: string[];
  now: () => Date;
  newId: () => string;
}

export function clock(start = '2026-10-21T16:00:00.000Z') {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}
export function ids() {
  let n = 0;
  return () => `item${String((n += 1)).padStart(12, '0')}`;
}
let requestCounter = 0;
export const rid = () => `req-${String((requestCounter += 1)).padStart(8, '0')}`;

export async function failure(promise: Promise<unknown>): Promise<PlannerRecoveryError> {
  try {
    await promise;
  } catch (reason) {
    if (reason instanceof PlannerPortError) return reason.error;
    throw reason;
  }
  throw new Error('expected a Planner failure');
}

const order = (items: Item[], status: string) => items.filter((i) => i.status === status).sort((p, q) => p.position - q.position).map((i) => i.title);

export function describePlannerPortConformance(label: string, createHarness: (options: HarnessOptions) => Promise<PlannerPortHarness>): void {
  const harness = (options: Partial<HarnessOptions> = {}) => createHarness({ now: clock(), newId: ids(), ...options });

  async function seeded() {
    const h = await harness();
    const { port } = h;
    const c = (await port.create({ title: 'C', status: 'next' }, rid())).item!;
    const b = (await port.create({ title: 'B', status: 'next' }, rid())).item!;
    const a = (await port.create({ title: 'A', status: 'next' }, rid())).item!;
    const x = (await port.create({ title: 'X', status: 'active' }, rid())).item!;
    const y = (await port.create({ title: 'Y', status: 'active' }, rid())).item!;
    return { ...h, a, b, c, x, y };
  }

  describe(`PlannerPort conformance: ${label}`, () => {
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

      it('renumbers only the target status on a cross-status move, and reports every renumbered item', async () => {
        const { port, control, a, x, y } = await seeded();
        const sourceBefore = control.stored().filter((i) => i.status === 'next' && i.id !== a.id).map((i) => [i.id, i.position, i.revision]);
        const result = await port.move(a.id, a.revision, 'active', { after_id: y.id }, rid());
        expect(order((await port.snapshot()).items, 'active')).toEqual(['Y', 'A', 'X']);
        expect(control.stored().filter((i) => i.status === 'next').map((i) => [i.id, i.position, i.revision])).toEqual(sourceBefore);
        expect(control.stored().filter((i) => i.status === 'active').map((i) => i.position)).toEqual([1024, 2048, 3072]);
        expect(result.item).toMatchObject({ status: 'active', revision: a.revision + 1 });
        expect(result.changed.map((i) => i.id).sort()).toEqual([a.id, x.id, y.id].sort());
        // `changed` carries full items with their new positions.
        const stored = new Map(control.stored().map((i) => [i.id, i.position]));
        for (const changed of result.changed) expect(changed.position).toBe(stored.get(changed.id));
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

      it('after the request record is evicted, a same-ID create duplicates on the ordinary route but is indeterminate through replay', async () => {
        const { port, control, a, semantics } = await seeded();
        const oldest = rid();
        await port.create({ title: 'Oldest' }, oldest);
        let revision = a.revision;
        for (let i = 0; i < MAX_REMEMBERED_REQUESTS; i += 1) revision = (await port.markReviewed(a.id, revision, rid())).item!.revision;
        expect(control.requestRecordCount()).toBe(MAX_REMEMBERED_REQUESTS);
        expect(control.hasRequestRecord(oldest)).toBe(false);
        if (semantics === 'service') {
          // The Planner service's own behaviour: the ordinary route applies an expired create again. This is why
          // HQ never re-sends an unknown write through it.
          expect((await port.create({ title: 'Oldest' }, oldest)).replayed).toBe(false);
          expect(control.stored().filter((i) => i.title === 'Oldest')).toHaveLength(2);
        } else {
          const version = control.stateVersion();
          expect(await failure(port.create({ title: 'Oldest' }, oldest))).toMatchObject({ kind: 'replay_indeterminate', requestId: oldest });
          expect(control.stored().filter((i) => i.title === 'Oldest')).toHaveLength(1);
          expect(control.stateVersion()).toBe(version);
        }
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
            { kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', end_time: '11:00', tz: 'America/New_York', note: 'Hall' },
          ],
        }, rid());
        expect(result.item!.dates.map(({ kind, precision, value }) => ({ kind, precision, value }))).toEqual([
          { kind: 'start', precision: 'quarter', value: '2027-Q2' }, { kind: 'event', precision: 'day', value: '2026-11-14' },
        ]);
        expect(result.item!.dates[1]).toMatchObject({ time: '10:00', end_time: '11:00', tz: 'America/New_York', note: 'Hall' });
        expect(result.item!.dates[1]).toMatchObject({ instant: '2026-11-14T15:00:00Z', end_instant: '2026-11-14T16:00:00Z', tz_abbr: 'EST' });
      });

      it('stores no derived date field sent back on a write', async () => {
        const { port, control } = await seeded();
        const created = (await port.create({ title: 'Timed', dates: [{ kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', tz: 'America/New_York' }] }, rid())).item!;
        // A read item, derived fields and all, sent straight back as a patch.
        await port.patch(created.id, created.revision, { dates: created.dates }, rid());
        const stored = control.stored().find((i) => i.id === created.id)!;
        expect(stored.dates[0]).not.toHaveProperty('instant');
        expect(stored.dates[0]).not.toHaveProperty('tz_abbr');
      });

      it('returns validation errors as field messages and stores nothing', async () => {
        const { port, control } = await seeded();
        const count = control.stored().length;
        expect(await failure(port.create({ title: '' }, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'title', message: 'Required.' }] });
        expect(control.stored()).toHaveLength(count);
      });
    });

    describe('settings, archive, review and history', () => {
      it('validates and merges settings', async () => {
        const { port } = await harness();
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
        const off = (await harness()).port;
        expect((await off.snapshot()).features).not.toContain(HQ_REFERENCES_FEATURE);
        expect(await failure(off.create({ title: 'L', references: [{ kind: 'hq', target }] }, rid()))).toMatchObject({ kind: 'invalid' });
        const on = (await harness({ features: [HQ_REFERENCES_FEATURE] })).port;
        await on.snapshot();
        const created = await on.create({ title: 'L', references: [{ kind: 'hq', target }] }, rid());
        expect(created.item!.references[0]).toMatchObject({ kind: 'hq', label: 'Spring post', target });
      });
    });
  });
}
