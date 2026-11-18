import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestStatus, stepProgress } from '../ui/model.ts';
import { env, readyDraft } from './fixtures.ts';

test('request progress follows stored draft and frozen packet state', async () => {
  const { session } = await readyDraft(env());
  assert.equal(stepProgress(session.state, null).current, 'Freeze');
  assert.equal(requestStatus(session.state).kind, 'draft');
  await session.freeze();
  assert.equal(stepProgress(session.state, null).current, 'Review');
  assert.equal(requestStatus(session.state).kind, 'frozen');
});
