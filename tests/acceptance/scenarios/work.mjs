import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { uiDriver } from './ui.mjs';

export async function workScenarios(context) {
  const { work } = context.fixtures;
  const ui = uiDriver(context);
  const posts = () => work.ledger.filter(entry => entry.method === 'POST');
  context.begin('work-service-replay');
  await context.domain('Work');
  await context.until(async () =>
    work.ledger.some(entry => entry.method === 'GET' && entry.path === '/api/state' && entry.status === 200) &&
    await ui.evaluate(`!!document.querySelector('form[aria-label="Quick capture"] input:not(:disabled)') && !!document.querySelector('[role="region"][aria-label="Status columns"]')`),
  'live Work capture ready');
  const before = await work.state();
  assert.equal(before.items.length, 0);
  const title = `Acceptance capture ${randomUUID()}`;
  work.loseNextCreateResponse();
  await ui.fill('Capture to Inbox', title);
  await ui.click('Capture', 'form[aria-label="Quick capture"]');
  await context.until(() => ui.evaluate(`!!document.querySelector('section[aria-label="Unconfirmed changes"]')`), 'Unconfirmed changes after response loss');
  const applied = await work.state();
  assert.equal(applied.items.length, 1);
  assert.equal(applied.items[0].title, title);
  assert.equal(applied.state_version, before.state_version + 1);
  assert.equal(posts().length, 1);
  const create = posts()[0];
  assert.equal(create.path, '/api/items');
  assert.deepEqual(JSON.parse(create.body), { fields: { title, kind: 'idea', status: 'inbox',
    motivation: null, horizon: null, priority: null, area: null, notes: '', next_steps: [], references: [], dates: [] } });
  assert.ok(create.requestId);
  assert.equal(create.responseLost, true);
  assert.equal(create.status, 201);
  assert.equal(create.response.item.id, applied.items[0].id);
  await context.capture('work-unconfirmed');
  await context.domain('Design');
  await context.domain('Work');
  await context.until(() => ui.evaluate(`!!document.querySelector('section[aria-label="Unconfirmed changes"]')`), 'unconfirmed intent survives navigation');
  // Reads through the real preload and navigation cannot be used as recovery writes.
  const read = await ui.evaluate(`window.hqServices.work.call('state', {})`);
  assert.equal(read.ok, true);
  assert.equal(posts().length, 1);
  await ui.click('Check now', 'section[aria-label="Unconfirmed changes"]');
  await context.until(() => ui.evaluate(`!document.querySelector('section[aria-label="Unconfirmed changes"]') && document.querySelector('main').textContent.includes(${JSON.stringify(title)})`), 'explicit lookup confirms capture');
  const confirmed = await work.state();
  assert.deepEqual(confirmed.items, applied.items);
  assert.equal(confirmed.state_version, applied.state_version);
  assert.equal(posts().length, 2, 'one create plus one explicit lookup');
  const lookup = posts()[1];
  assert.equal(lookup.path, '/api/requests/replay');
  const lookupBody = JSON.parse(lookup.body);
  assert.equal(lookupBody.mode, 'lookup');
  assert.equal(lookupBody.request_id, create.requestId);
  assert.equal(lookupBody.sent_after_version, before.state_version);
  assert.equal(Buffer.from(lookupBody.body_b64, 'base64').toString('utf8'), create.bodyUtf8);
  assert.equal(lookup.response.outcome, 'replayed');
  await context.capture('work-confirmed');
  context.passed({ scenario: 'HQ-02', title, itemId: applied.items[0].id, stateVersion: confirmed.state_version,
    createSequence: create.count, lookupSequence: lookup.count, createCount: 1, lookupCount: 1 });

  context.begin('work-restart-without-intent');
  await context.stopApp();
  await work.restart();
  const boundary = work.ledger.length;
  const retained = await work.state();
  assert.deepEqual(retained.items, confirmed.items);
  assert.equal(retained.state_version, confirmed.state_version);
  await context.launchApp();
  await context.domain('Work');
  await context.until(async () =>
    work.ledger.slice(boundary).some(entry => entry.method === 'GET' && entry.path === '/api/state' && entry.status === 200) &&
    await ui.evaluate(`[...document.querySelectorAll('[role="region"][aria-label="Status columns"] [data-card-id]')].some(card => card.dataset.cardId === ${JSON.stringify(applied.items[0].id)} && card.textContent.includes(${JSON.stringify(title)}))`),
  'retained Planner item after process restart');
  await context.domain('Design'); await context.domain('Work');
  await ui.evaluate(`window.hqServices.work.call('state', {})`);
  assert.equal(await ui.evaluate(`!!document.querySelector('section[aria-label="Unconfirmed changes"]')`), false);
  const after = await work.state();
  assert.deepEqual(after.items, confirmed.items);
  assert.equal(after.state_version, confirmed.state_version);
  assert.equal(work.ledger.slice(boundary).filter(entry => entry.method && entry.method !== 'GET').length, 0);
  assert.equal(work.ledger.filter(entry => entry.method === 'POST' && entry.path === '/api/items').length, 1);
  await context.capture('work-retained-restart');
  context.passed({ scenario: 'HQ-03', itemId: after.items[0].id, stateVersion: after.state_version,
    restartLedgerBoundary: boundary, postRestartMutations: 0, plannerProcesses: work.processes.length,
    limitation: 'Confirmed item durability; no durable unresolved client-intent claim.' });
}
