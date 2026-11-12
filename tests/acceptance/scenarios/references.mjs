import assert from 'node:assert/strict';
import { uiDriver } from './ui.mjs';

export async function referenceScenario(context) {
  context.begin('reference-round-trips');
  const ui = uiDriver(context), { work, social } = context.fixtures;
  await context.domain('Work');
  const state = await work.state();
  const item = state.items.find(item => item.title.startsWith('Acceptance capture '));
  assert.ok(item, 'run the real Planner capture journey first');
  assert.equal(await ui.evaluate(`(() => { const card = [...document.querySelectorAll('[data-card-id]')].find(c => c.dataset.cardId === ${JSON.stringify(item.id)}); if (!card) return false; card.click(); return true; })()`), true);
  await context.until(() => ui.evaluate(`!!document.querySelector('input.work-detail-title')`), 'Work card opened');
  const before = work.ledger.length, socialBefore = social.ledger.length;
  await ui.click('Link to…');
  // Input insertion goes through Chromium, not a direct port mutation.
  await ui.fill('Search references', 'quokkaharbor');
  await context.until(() => ui.evaluate(`!![...document.querySelectorAll('[role="option"]')].find(o => o.textContent.includes('bl/policies/retry-policy.md'))`), 'committed Wiki reference result');
  assert.equal(await ui.evaluate(`(() => { const option = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent.includes('bl/policies/retry-policy.md')); option.click(); return true; })()`), true);
  const linked = await context.until(async () => {
    const current = (await work.state()).items.find(value => value.id === item.id);
    return current.references.some(ref => ref.target?.entityId === 'bl/policies/retry-policy.md') && current;
  }, 'Planner persisted Wiki reference');
  const target = linked.references.find(ref => ref.target?.entityId === 'bl/policies/retry-policy.md').target;
  assert.equal(target.domain, 'wiki');
  assert.match(target.sourceRevision, /^wiki-c1:[0-9a-f]{64}$/);
  const mutations = () => work.ledger.slice(before).filter(entry => entry.method !== 'GET');
  assert.equal(mutations().length, 1, 'one deliberate reference save');
  assert.equal(mutations()[0].method, 'PATCH');
  await context.until(() => ui.evaluate(`document.querySelector('.hq-reference[data-reference-status="available"]')?.textContent.includes('Retry Policy')`), 'reference resolved available');
  await ui.click('Open Retry Policy');
  await context.until(() => ui.evaluate(`document.querySelector('.wiki-page-title')?.textContent === 'Retry Policy'`), 'Wiki page opened');
  await context.capture('reference-open');
  await ui.click(`Back to ${item.title}`);
  await context.until(() => ui.evaluate(`document.querySelector('input.work-detail-title')?.value === ${JSON.stringify(item.title)}`), 'return to originating card');
  assert.equal(mutations().length, 1, 'open and return never save or execute');
  assert.deepEqual((await work.state()).items.find(value => value.id === item.id), linked);
  assert.equal(social.ledger.slice(socialBefore).filter(entry => entry.method !== 'GET').length, 0);
  await context.capture('reference-return');
  context.passed({ target: target.entityId, status: 'available', referenceSaves: 1, navigationMutations: 0 });
}
