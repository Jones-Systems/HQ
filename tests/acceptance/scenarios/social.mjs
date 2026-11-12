import assert from 'node:assert/strict';
import { uiDriver } from './ui.mjs';
import { recoveryUi, clickRecoveryControl } from '../fixtures/recovery-ui.mjs';
import { assertNoServiceMutations } from '../fixtures/http.mjs';

export async function socialScenario(context) {
  context.begin('social-save-and-unknown');
  const social = context.fixtures.social, ui = uiDriver(context);
  assert.equal(typeof social.armSave, 'function', 'real synthetic Social fixture must be registered');
  const posts = () => social.ledger.filter(entry => entry.method !== 'GET');
  await context.domain('Social');
  await clickRecoveryControl(context, recoveryUi.socialLibraryButton, 'Social Library');
  await context.until(() => ui.evaluate(recoveryUi.socialLibraryReady), 'Social library ready');
  assertNoServiceMutations(social.ledger, 'Social before intentional save');
  context.beginSocialSaves();
  const before = await social.state();
  const newDraftScope = await ui.evaluate(recoveryUi.socialNewDraftScope);
  await ui.click('New draft', newDraftScope);
  await context.until(() => ui.evaluate(`!!document.querySelector('.soc-cmp')`), 'Social composer opened');
  await ui.fill('Title', 'Synthetic acceptance draft');
  await ui.fill('Body', 'Synthetic acceptance body');
  await clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft');
  await context.until(async () => (await social.state()).content.length === before.content.length + 1 &&
    await ui.evaluate(`document.querySelector('.soc-cmp')?.textContent.includes('Saved')`), 'confirmed Social save');
  assert.equal(posts().length, 1);
  const saved = (await social.state()).content.find(item => item.title === 'Synthetic acceptance draft');
  assert.ok(saved); assert.equal(saved.body, 'Synthetic acceptance body');
  await ui.fill('Title', 'Synthetic rejected title');
  social.armSave('reject');
  await clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft');
  await context.until(() => ui.evaluate(`document.querySelector('.soc-cmp [role="alert"]')?.textContent.includes('Synthetic rejection before save')`), 'explicit save failure');
  assert.equal(posts().length, 2);
  assert.deepEqual((await social.state()).content.find(item => item.id === saved.id), saved);
  await ui.fill('Title', 'Synthetic uncertain title');
  social.armSave('lose');
  await clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft');
  await context.until(() => ui.evaluate(`document.querySelector('.soc-cmp')?.textContent.includes('Save result unknown') && ${recoveryUi.socialSaveBlocked}`), 'unknown save is blocked');
  const applied = (await social.state()).content.find(item => item.id === saved.id);
  assert.equal(applied.title, 'Synthetic uncertain title');
  assert.equal(applied.version, saved.version + 1);
  assert.equal(posts().length, 3);
  assert.equal(posts()[2].responseLost, true);
  await context.capture('social-unknown');
  await context.domain('Design'); await context.domain('Social');
  await context.until(() => ui.evaluate(`!!document.querySelector('.soc-cmp')`), 'return to uncertain draft');
  await ui.evaluate(`window.hqServices.social.call('workspace', {})`);
  assert.equal(posts().length, 3, 'navigation and reads never repeat the uncertain intent');
  await ui.click('Check', '.soc-cmp');
  await context.until(() => ui.evaluate(`document.querySelector('.soc-cmp')?.textContent.includes('Saved') && !document.querySelector('.soc-cmp')?.textContent.includes('Save result unknown')`), 'explicit read reconciles save');
  assert.equal(posts().length, 3, 'check is a read, never a save retry');
  assert.deepEqual((await social.state()).content.find(item => item.id === saved.id), applied);
  assert.equal((await social.state()).content.length, before.content.length + 1);
  assert.ok(posts().every(entry => entry.path === '/api/content'));
  await context.capture('social-confirmed');
  context.passed({ fixture: 'real-local-Social-synthetic-data', saves: 3, applied: 2, rejected: 1,
    duplicateIntents: 0, limitation: 'No posting, accounts or live providers qualified.' });
}
