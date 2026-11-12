import assert from 'node:assert/strict';
import { uiDriver } from './ui.mjs';
import { assertNoServiceMutations } from '../fixtures/http.mjs';

// Last journey: stop only these invocation-owned disposable service children.
export async function unavailableServiceScenario(context) {
  context.begin('unavailable-service-ui');
  const ui = uiDriver(context), { work, social } = context.fixtures;
  assert.equal(typeof work.stop, 'function', 'register owned Planner stop control');
  await context.stopApp();
  await work.stop(); await social.stop();
  const workBoundary = work.ledger.length, socialBoundary = social.ledger.length;
  await context.launchApp(); await context.domain('Work');
  await context.until(() => ui.evaluate(`document.querySelector('main')?.textContent.includes('Planner service unreachable')`), 'truthful Planner unavailable UI');
  const captureEnabled = await ui.evaluate(`!!document.querySelector('form[aria-label="Quick capture"] input:not(:disabled)')`);
  assert.equal(captureEnabled, false, 'unavailable Planner cannot appear ready to capture');
  const workRead = await ui.evaluate(`window.hqServices.work.call('state', {})`);
  assert.equal(workRead.ok, false); assert.equal(workRead.kind, 'unavailable');
  await context.capture('work-service-unavailable');
  await context.domain('Social');
  await context.until(() => ui.evaluate(`/unreachable|unavailable|couldn.t be loaded|offline/i.test(document.querySelector('main')?.textContent ?? '')`), 'truthful Social unavailable UI');
  const socialRead = await ui.evaluate(`window.hqServices.social.call('workspace', {})`);
  assert.equal(socialRead.ok, false); assert.equal(socialRead.kind, 'unavailable');
  await context.domain('Design'); await context.domain('Work'); await context.domain('Social');
  assertNoServiceMutations(work.ledger.slice(workBoundary), 'Work unavailable navigation');
  assertNoServiceMutations(social.ledger.slice(socialBoundary), 'Social unavailable navigation');
  assert.ok(work.ledger.slice(workBoundary).some(entry => entry.method === 'GET'));
  assert.ok(social.ledger.slice(socialBoundary).some(entry => entry.method === 'GET'));
  await context.capture('social-service-unavailable');
  context.passed({ services: ['Work', 'Social'], unavailable: true, navigationMutations: 0,
    limitation: 'Owned local services stopped; no remote/live-provider qualification.' });
}
