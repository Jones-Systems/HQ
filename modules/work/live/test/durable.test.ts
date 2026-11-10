import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JsonValue, WorkLocalTransport } from '@hq/contracts/services';
import { isWorkLocalBridge, WorkLocalError, workLocalPersistence, type WorkLocalFailure } from '../durable';

// The renderer end of the device document, against an in-memory stand-in for main's compare-and-swap: a binding that
// `load` hands out, and a revision a save must match. `apps/desktop/electron/work-local.test.ts` runs this module
// against the real storage.

const BINDING = 'binding-token-1';

function device(initial: { revision: number; value: JsonValue | null } = { revision: 0, value: null }) {
  const calls: { route: string; params: unknown }[] = [];
  const stored = { ...initial };
  let active = 0, peak = 0;
  /** Answers the next call of `route` with this instead of serving it. */
  const scripted = new Map<string, unknown[]>();
  const script = (route: 'load' | 'save', ...answers: unknown[]) => scripted.set(route, [...(scripted.get(route) ?? []), ...answers]);
  const transport = {
    async call(route: string, params: unknown) {
      calls.push({ route, params: structuredClone(params) });
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 0)); // overlapping calls would show in `peak`
        const answer = scripted.get(route)?.shift();
        if (answer !== undefined) {
          if (answer instanceof Error) throw answer;
          return answer;
        }
        if (route === 'load') return { ok: true, value: { binding: BINDING, revision: stored.revision, value: stored.value } };
        const p = params as { binding: string; expectedRevision: number; value: JsonValue };
        if (p.binding !== BINDING || p.expectedRevision !== stored.revision) return { ok: false, kind: 'conflict' };
        stored.revision += 1;
        stored.value = p.value;
        return { ok: true, value: { revision: stored.revision } };
      } finally {
        active -= 1;
      }
    },
  } as unknown as WorkLocalTransport;
  return { transport, calls, stored, script, peak: () => peak };
}

const saves = (calls: { route: string; params: unknown }[]) => calls.filter((c) => c.route === 'save').map((c) => c.params);
const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected a rejection');
};
const failureOf = async (promise: Promise<unknown>): Promise<WorkLocalFailure> => {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(WorkLocalError);
  return (error as WorkLocalError).kind;
};

describe('isWorkLocalBridge', () => {
  it('accepts an object with a call function, as the preload exposes it, and nothing else', () => {
    expect(isWorkLocalBridge(Object.freeze({ call: () => Promise.resolve() }))).toBe(true);
    for (const value of [undefined, null, 'call', 7, [], {}, { call: 'x' }, { call: null }, () => undefined]) expect(isWorkLocalBridge(value)).toBe(false);
  });
});

describe('load', () => {
  it('returns the stored value, and null when nothing is stored', async () => {
    const empty = workLocalPersistence(device().transport);
    expect(await empty.load()).toBeNull();
    const document = { queue: [{ queueId: 'q1', n: 1 }], flag: false };
    const filled = device({ revision: 4, value: document });
    expect(await workLocalPersistence(filled.transport).load()).toEqual(document);
    expect(filled.calls).toEqual([{ route: 'load', params: {} }]);
  });

  it('keeps the binding and revision, and sends them with the first save', async () => {
    const { transport, calls } = device({ revision: 4, value: { n: 1 } });
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    await persistence.save({ n: 2 });
    expect(saves(calls)).toEqual([{ binding: BINDING, expectedRevision: 4, value: { n: 2 } }]);
  });

  it.each(['conflict', 'invalid', 'too_large', 'unavailable'] as const)('rejects when main answers %s', async (kind) => {
    const { transport, script } = device();
    script('load', { ok: false, kind });
    expect(await failureOf(workLocalPersistence(transport).load())).toBe(kind);
  });

  it('rejects, as unavailable, when the bridge throws', async () => {
    const { transport, script } = device();
    script('load', new Error('ipc closed: /home/someone/path 127.0.0.1'));
    const error = await rejection(workLocalPersistence(transport).load());
    expect(error).toMatchObject({ name: 'WorkLocalError', kind: 'unavailable', message: 'Work local unavailable' });
  });

  it.each([
    ['nothing', null], ['a string', 'ok'], ['an array', []], ['an empty object', {}], ['ok without a value', { ok: true }],
    ['a refusal of another kind', { ok: false, kind: 'teapot' }], ['a refusal without a kind', { ok: false }],
    ['no binding', { ok: true, value: { revision: 0, value: null } }], ['an empty binding', { ok: true, value: { binding: '', revision: 0, value: null } }],
    ['a numeric binding', { ok: true, value: { binding: 7, revision: 0, value: null } }],
    ['a negative revision', { ok: true, value: { binding: BINDING, revision: -1, value: null } }],
    ['a fractional revision', { ok: true, value: { binding: BINDING, revision: 1.5, value: null } }],
    ['a string revision', { ok: true, value: { binding: BINDING, revision: '1', value: null } }],
    ['no value member', { ok: true, value: { binding: BINDING, revision: 0 } }],
    ['a value that is not a record', { ok: true, value: 'document' }],
  ])('rejects as malformed on an answer of %s', async (_label, answer) => {
    const { transport, script, calls } = device();
    script('load', answer);
    const persistence = workLocalPersistence(transport);
    expect(await failureOf(persistence.load())).toBe('malformed');
    // A document that could not be read is never a base for a save.
    expect(await failureOf(persistence.save({ n: 1 }))).toBe('not_loaded');
    expect(saves(calls)).toEqual([]);
  });
});

describe('save', () => {
  it('sends the kept binding and revision, and keeps each new revision', async () => {
    const { transport, calls, stored } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    for (const n of [1, 2, 3]) await persistence.save({ n });
    expect(saves(calls)).toEqual([0, 1, 2].map((expectedRevision, i) => ({ binding: BINDING, expectedRevision, value: { n: i + 1 } })));
    expect(stored).toEqual({ revision: 3, value: { n: 3 } });
  });

  it('rejects, before sending anything, when there has been no successful load', async () => {
    const { transport, calls } = device();
    const persistence = workLocalPersistence(transport);
    expect(await failureOf(persistence.save({ n: 1 }))).toBe('not_loaded');
    expect(calls).toEqual([]);
  });

  it('rejects a save made while the first load is still running, rather than writing over what it will return', async () => {
    const { transport, calls, stored } = device({ revision: 2, value: { queue: ['kept'] } });
    const persistence = workLocalPersistence(transport);
    const loading = persistence.load();
    expect(await failureOf(persistence.save({ queue: [] }))).toBe('not_loaded');
    expect(await loading).toEqual({ queue: ['kept'] });
    expect(saves(calls)).toEqual([]);
    expect(stored).toEqual({ revision: 2, value: { queue: ['kept'] } });
  });

  it('rejects with the refusal, and does not overwrite another writer\'s document', async () => {
    const { transport, stored, calls } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    stored.revision = 7; // another writer saved since this one loaded
    stored.value = { theirs: true };
    expect(await failureOf(persistence.save({ mine: true }))).toBe('conflict');
    expect(stored).toEqual({ revision: 7, value: { theirs: true } });
    // The stale revision is not guessed at: the same save is refused again until a fresh load.
    expect(await failureOf(persistence.save({ mine: true }))).toBe('conflict');
    expect(saves(calls).map((p) => (p as { expectedRevision: number }).expectedRevision)).toEqual([0, 0]);
    expect(await persistence.load()).toEqual({ theirs: true });
    await persistence.save({ merged: true });
    expect(stored).toEqual({ revision: 8, value: { merged: true } });
  });

  it.each(['invalid', 'too_large', 'unavailable'] as const)('rejects when main answers %s, and keeps its revision for the next save', async (kind) => {
    const { transport, script, calls, stored } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    script('save', { ok: false, kind });
    expect(await failureOf(persistence.save({ n: 1 }))).toBe(kind);
    await persistence.save({ n: 2 });
    expect(saves(calls).map((p) => (p as { expectedRevision: number }).expectedRevision)).toEqual([0, 0]);
    expect(stored).toEqual({ revision: 1, value: { n: 2 } });
  });

  it('rejects, as unavailable, when the bridge throws, naming nothing from the exception', async () => {
    const { transport, script } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    script('save', new Error('EACCES /home/someone/.config/HQ/work-local'));
    const error = await rejection(persistence.save({ n: 1 })) as Error;
    expect(error).toBeInstanceOf(WorkLocalError);
    expect([error.message, (error as WorkLocalError).kind]).toEqual(['Work local unavailable', 'unavailable']);
  });

  it.each([
    ['nothing', null], ['ok without a value', { ok: true }], ['no revision', { ok: true, value: {} }],
    ['a revision that did not advance', { ok: true, value: { revision: 0 } }], ['a revision that went back', { ok: true, value: { revision: -1 } }],
    ['a fractional revision', { ok: true, value: { revision: 1.5 } }], ['a string revision', { ok: true, value: { revision: '1' } }],
  ])('rejects as malformed on an answer of %s, and asks for a fresh load before the next save', async (_label, answer) => {
    const { transport, script, calls } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    script('save', answer);
    expect(await failureOf(persistence.save({ n: 1 }))).toBe('malformed');
    expect(await failureOf(persistence.save({ n: 2 }))).toBe('not_loaded');
    expect(saves(calls)).toHaveLength(1);
    await persistence.load();
    await persistence.save({ n: 3 });
    expect(saves(calls)).toHaveLength(2);
  });

  it('never runs two saves at once, and sends them in call order with advancing revisions', async () => {
    const { transport, calls, stored, peak } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    await Promise.all([1, 2, 3, 4, 5].map((n) => persistence.save({ n })));
    expect(peak()).toBe(1);
    expect(saves(calls)).toEqual([0, 1, 2, 3, 4].map((expectedRevision, i) => ({ binding: BINDING, expectedRevision, value: { n: i + 1 } })));
    expect(stored).toEqual({ revision: 5, value: { n: 5 } });
  });

  it('keeps going after a refused save: the next queued save is still sent, from the last accepted revision', async () => {
    const { transport, script, calls, stored } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    script('save', { ok: false, kind: 'unavailable' });
    const [first, second] = await Promise.allSettled([persistence.save({ n: 1 }), persistence.save({ n: 2 })]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('fulfilled');
    expect(saves(calls).map((p) => (p as { expectedRevision: number }).expectedRevision)).toEqual([0, 0]);
    expect(stored).toEqual({ revision: 1, value: { n: 2 } });
  });

  it('holds a save made during a later load until that load finishes, then uses its revision', async () => {
    const { transport, calls, stored } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    stored.revision = 5;
    stored.value = { fresh: true };
    const [loaded] = await Promise.all([persistence.load(), persistence.save({ n: 1 })]);
    expect(loaded).toEqual({ fresh: true });
    expect(calls.map((c) => c.route)).toEqual(['load', 'load', 'save']);
    expect(saves(calls)).toEqual([{ binding: BINDING, expectedRevision: 5, value: { n: 1 } }]);
  });

  it('forgets its base when a later load fails, so a save cannot go over an unreadable document', async () => {
    const { transport, script, calls } = device();
    const persistence = workLocalPersistence(transport);
    await persistence.load();
    script('load', { ok: false, kind: 'invalid' });
    expect(await failureOf(persistence.load())).toBe('invalid');
    expect(await failureOf(persistence.save({ n: 1 }))).toBe('not_loaded');
    expect(saves(calls)).toEqual([]);
  });
});

describe('the module boundary', () => {
  it('stands alone: it does not import Work core durability, which is written in parallel', () => {
    const source = readFileSync(new URL('../durable.ts', import.meta.url), 'utf8');
    expect(/from '[^']*core[^']*'/u.test(source)).toBe(false);
    // Only the local bridge mirror; the shared `services.ts` is outside ac.work-domain.001.
    expect(Array.from(source.matchAll(/from '([^']+)'/gu), (match) => match[1])).toEqual(['./transport']);
  });
});
