import { afterEach, expect, it } from 'vitest';
import { workSession, resetWorkSessions, setWorkSessionPort } from '../session';
import { createFixturePlanner } from '../../core/fixtures/adapter';
import { DURABLE_SCHEMA, registerWorkDurability, resetWorkDurability } from '../../core/durability';

afterEach(() => { resetWorkSessions(); resetWorkDurability(); setWorkSessionPort(null); });

it('adopts registered draft durability at session creation, once per project and once per shared hub', async () => {
  const fixture = createFixturePlanner();
  let loads = 0;
  const saved: unknown[] = [];
  registerWorkDurability(fixture.port, {
    async load() {
      loads++;
      return { schema: DURABLE_SCHEMA, queued: [], unconfirmed: [], drafts: [
        { id: 'hq-draft-12', fields: { title: 'Synthetic session capture' }, createdAt: '2026-11-12T14:00:00.000Z' },
      ] };
    },
    async save(value) { saved.push(value); },
  });
  setWorkSessionPort(fixture.port, { example: false });
  const a = workSession('capture-project-a');
  const b = workSession('capture-project-b');
  await Promise.all([a.drafts.ready(), b.drafts.ready()]);
  expect(workSession('capture-project-a')).toBe(a);
  expect(a.drafts.getState().drafts.map((draft) => draft.fields.title)).toEqual(['Synthetic session capture']);
  expect(b.drafts.getState().drafts).toEqual([]);
  expect(loads).toBe(1);
  expect(saved).toEqual([]);
  expect(a.store.getState().unconfirmed).toEqual([]);
});
