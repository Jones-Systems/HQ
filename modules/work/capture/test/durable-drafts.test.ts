import { afterEach, describe, expect, it } from 'vitest';
import { createDraftStore, draftScopeNote, DRAFT_SCOPE_NOTE } from '../drafts';
import { DURABLE_SCHEMA, durableDrafts, registerWorkDurability, resetWorkDurability, type WorkPersistence } from '../../core/durability';
import { createFixturePlanner } from '../../core/fixtures/adapter';
import { setup, writes } from '../../board/test/fixtures';

const AT = '2026-11-12T14:00:00.000Z';
const draft = (id = 'hq-draft-7') => ({ id, fields: { title: 'Repair the synthetic kite', status: 'inbox' as const }, createdAt: AT });
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
function device(drafts: unknown[] = []) {
  let disk: unknown = { schema: DURABLE_SCHEMA, queued: [], unconfirmed: [], drafts };
  const control = { fail: false, load: null as Promise<void> | null, save: null as Promise<void> | null, saves: 0 };
  const persistence: WorkPersistence = {
    async load() { if (control.load) await control.load; return structuredClone(disk); },
    async save(value) {
      control.saves++;
      if (control.save) await control.save;
      if (control.fail) throw new Error('synthetic device refusal');
      disk = structuredClone(value);
    },
  };
  const open = () => {
    const port = createFixturePlanner().port;
    registerWorkDurability(port, persistence);
    return createDraftStore({ durableDrafts: durableDrafts(port) });
  };
  return { control, open, disk: () => structuredClone(disk) as { drafts: unknown[] } };
}
afterEach(() => resetWorkDurability());

describe('device capture drafts', () => {
  it('refuses mutation during delayed claim; explicit send waits for restore and never sends by itself', async () => {
    const env = await setup();
    const p = device([draft()]);
    const load = gate(); p.control.load = load.promise;
    const drafts = p.open();
    expect(() => drafts.add({ title: 'Keep input' })).toThrow(/Reading/);
    expect(() => drafts.discard('hq-draft-7')).toThrow(/Reading/);
    expect(p.control.saves).toBe(0);
    const sending = drafts.sendAll(env.store);
    expect(writes(env.calls)).toEqual([]);
    load.open();
    expect((await sending).sent).toBe(1);
    expect(writes(env.calls)).toHaveLength(1);
    expect(drafts.getState().drafts).toEqual([]);
  });

  it('restores across a fresh hub without sending, allocates beyond restored IDs, and persists discard', async () => {
    const env = await setup();
    const p = device([draft('hq-draft-900')]);
    const first = p.open(); await first.ready();
    const added = first.add({ title: 'Second kite' }); await first.settle();
    expect(Number(added.id.slice(9))).toBeGreaterThan(900);
    expect(first.getState().durability).toBe('saved');
    resetWorkDurability();
    const second = p.open(); await second.ready();
    expect(second.getState().drafts.map((d) => d.fields.title)).toEqual(['Repair the synthetic kite', 'Second kite']);
    expect(writes(env.calls)).toEqual([]);
    second.discard(added.id); await second.settle();
    resetWorkDurability();
    const third = p.open(); await third.ready();
    expect(third.getState().drafts).toEqual([draft('hq-draft-900')]);
  });

  it('claims stored drafts once across projects and gives new drafts different IDs', async () => {
    const p = device([draft()]);
    const a = p.open(), b = p.open();
    await Promise.all([a.ready(), b.ready()]);
    expect(a.getState().drafts).toHaveLength(1);
    expect(b.getState().drafts).toHaveLength(0);
    const one = a.add({ title: 'A' }), two = b.add({ title: 'B' });
    await Promise.all([a.settle(), b.settle()]);
    expect(one.id).not.toBe(two.id);
    expect(p.disk().drafts).toHaveLength(3);
  });

  it.each([
    [null], [draft(), draft()], [{ ...draft(), fields: { title: 42 } }],
    [{ ...draft(), createdAt: 'invalid' }], [{ ...draft(), handoff: 'false' }],
  ])('blocks malformed or duplicate stored drafts without overwriting them: %j', async (...rows) => {
    const p = device(rows);
    const drafts = p.open(); await drafts.ready();
    expect(drafts.getState().durability).toBe('blocked');
    expect(() => drafts.add({ title: 'Preserve input' })).toThrow(/Nothing will overwrite/);
    await expect(drafts.settle()).rejects.toThrow();
    expect(p.control.saves).toBe(0);
    expect(p.disk().drafts).toEqual(rows);
  });

  it('refuses unreadable device documents without a fallback save', async () => {
    const port = createFixturePlanner().port;
    let saves = 0;
    registerWorkDurability(port, { async load() { throw new Error('synthetic unreadable device'); }, async save() { saves++; } });
    const drafts = createDraftStore({ durableDrafts: durableDrafts(port) });
    await drafts.ready();
    expect(drafts.getState().durability).toBe('blocked');
    expect(() => drafts.add({ title: 'Keep the capture open' })).toThrow();
    expect(saves).toBe(0);
  });

  it('keeps local input and reports pending/failed saves; failed storage prevents dispatch', async () => {
    const env = await setup();
    const p = device(); const drafts = p.open(); await drafts.ready();
    const save = gate(); p.control.save = save.promise;
    drafts.add({ title: 'Keep this text' });
    expect(drafts.getState().durability).toBe('saving');
    expect(draftScopeNote(drafts.getState())).toContain('pending');
    p.control.fail = true; save.open(); await drafts.settle();
    expect(drafts.getState().durability).toBe('failed');
    expect(drafts.getState().drafts[0]?.fields.title).toBe('Keep this text');
    expect((await drafts.sendAll(env.store)).stopped).toBe(true);
    expect(writes(env.calls)).toEqual([]);
  });

  it('hands unknown create to core once and never resends a stale pre-handoff draft after restart', async () => {
    const env = await setup();
    const p = device(); const drafts = p.open(); await drafts.ready();
    drafts.add({ title: 'Unknown kite' }); await drafts.settle();
    env.faults.next('lose-response');
    // Refuse removal after core takes the unknown outcome; the previous disk copy has a handoff marker.
    const create = env.store.create.bind(env.store);
    env.store.create = async (...args) => { const outcome = await create(...args); p.control.fail = true; return outcome; };
    expect((await drafts.sendAll(env.store)).unconfirmed).toBe(1);
    expect(env.store.getState().unconfirmed).toHaveLength(1);
    const requestId = env.store.getState().unconfirmed[0]!.requestId;
    resetWorkDurability(); p.control.fail = false;
    const restored = p.open(); await restored.ready();
    expect(restored.getState().drafts[0]?.handoff).toBe(true);
    await restored.sendAll(env.store);
    expect(writes(env.calls)).toHaveLength(1);
    expect(env.store.getState().unconfirmed[0]!.requestId).toBe(requestId);
  });

  it('preserves synchronous in-memory behavior without a slot', () => {
    const drafts = createDraftStore();
    const kept = drafts.add({ title: 'Session only' });
    expect(drafts.getState().drafts).toEqual([kept]);
    expect(draftScopeNote(drafts.getState())).toBe(DRAFT_SCOPE_NOTE);
    drafts.discard(kept.id);
    expect(drafts.getState().drafts).toEqual([]);
  });
});
