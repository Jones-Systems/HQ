import assert from 'node:assert/strict';
import test from 'node:test';
import { doubles, compareSlot } from '../test/doubles.ts';
import { createRunsEnvironment } from './env.ts';

test('production defaults to disconnected with no synthetic destination or send', async () => {
  const d = doubles();
  const { requests } = await d.open();
  const runs = await createRunsEnvironment({ ...d, requests, compareSlot });
  assert.equal(runs.catalog.destinations.length, 0);
  assert.equal(runs.controller.view().sendEnabled, false);
  runs.controller.requestSend();
  assert.equal(await runs.pipeline.confirm(), null);
  assert.deepEqual(await d.outbox.list(), []);
});
