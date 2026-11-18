import { afterEach, expect, it } from 'vitest';
import { durableDrafts, registerWorkDurability, resetWorkDurability } from '../durability';
import { createFixturePlanner } from '../fixtures/adapter';

afterEach(() => resetWorkDurability());

it('exposes the existing hub save settlement and failure notifications to draft handles', async () => {
  const port = createFixturePlanner().port;
  let fail = true;
  let changes = 0;
  registerWorkDurability(port, { async load() { return null; }, async save() { if (fail) throw new Error('synthetic refusal'); } });
  const slot = durableDrafts(port)!;
  const stop = slot.onStatus(() => { changes++; });
  await slot.claim();
  slot.save([]); await slot.settle();
  expect(slot.status()).toBe('failed');
  expect(changes).toBe(1);
  fail = false; await slot.settle();
  expect(slot.status()).toBe('ok');
  expect(changes).toBe(2);
  stop(); fail = true; await slot.settle();
  expect(changes).toBe(2);
});
