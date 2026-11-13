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
  // N01 uses the first armed response loss; never arm a second create fault.
  const unresolved = await persisted(context, value => value.unconfirmed.length === 1,
    'original exported unconfirmed intent saved on device');
  const original = unresolved.unconfirmed[0];
  assert.equal(original.requestId, create.requestId);
  assert.equal(original.baseVersion, before.state_version);
  assert.equal(original.intent.requestId, create.requestId);
  assert.equal(original.intent.sentAfterVersion, before.state_version);
  assert.equal(original.intent.call.route, 'create');
  assert.equal(original.intent.call.params.requestId, create.requestId);
  assert.deepEqual({ fields: original.intent.call.params.fields }, JSON.parse(create.body));
  const restartBoundary = work.ledger.length;
  await context.stopApp();
  await context.launchApp();
  await context.domain('Work');
  await context.until(() => ui.evaluate(`!!document.querySelector('section[aria-label="Unconfirmed changes"]')`),
    'N01 fresh Electron core restores Unconfirmed');
  const restored = await persisted(context, value => value.unconfirmed.length === 1, 'N01 persisted intent restored');
  assert.deepEqual(restored.unconfirmed[0], original);
  await context.domain('Design'); await context.domain('Work');
  assert.equal((await ui.evaluate(`window.hqServices.work.call('state', {})`)).ok, true);
  assert.equal(mutations(work, restartBoundary).length, 0, 'N01 launch/navigation/read sends nothing');
  await context.capture('work-unconfirmed-restart');
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

  context.begin('work-unconfirmed-native-restart');
  context.passed({ scenario: 'N01', requestId: create.requestId, baseVersion: original.baseVersion,
    originalBody: create.bodyUtf8, restartLedgerBoundary: restartBoundary, lookupSequence: lookup.count,
    createCount: 1, lookupCount: 1, itemId: applied.items[0].id, stateVersion: confirmed.state_version });

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

// Read the actual preload-backed document; never seed or repair durable evidence.
async function persisted(context, predicate, label) {
  return context.until(async () => {
    const answer = await context.cdp().evaluate(`window.hqServices.workLocal.call('load', {})`);
    assert.equal(answer.ok, true, `${label}: workLocal.load`);
    const value = answer.value.value;
    return value && predicate(value) && value;
  }, label);
}

function mutations(work, boundary) {
  return work.ledger.slice(boundary).filter(entry => entry.method && entry.method !== 'GET');
}

async function offline(context, ui) {
  await context.domain('Design'); await context.domain('Work');
  await context.until(() => ui.evaluate(`document.querySelector('main').textContent.includes('Offline') || document.querySelector('main').textContent.includes('Planner service unreachable')`),
    'owned Planner unavailable in Work UI', 45000);
}

async function refresh(context, ui) {
  const scope = await ui.evaluate(`[...document.querySelectorAll('.wd-status button')].some(b => b.textContent.trim() === 'Try again') ? '.wd-status' : 'main'`);
  await ui.click('Try again', scope);
  await context.until(() => ui.evaluate(`!document.querySelector('.wd-status')?.textContent.includes('Offline')`), 'Work reconnect read completes');
}

export async function workQueuedNativeRestart(context) {
  context.begin('work-queued-native-restart');
  const { work } = context.fixtures, ui = uiDriver(context);
  assert.equal(typeof work.start, 'function', 'INT must supply owned Planner start-after-stop control');
  const before = await work.state();
  assert.equal(before.items.length, 1, 'N02 requires original HQ03 confirmed item');
  const item = before.items[0], title = `Offline edit ${randomUUID()}`;
  const origin = work.origin, database = work.database;
  let down = false, failure;
  try {
    await work.stop(); down = true;
    await offline(context, ui);
    assert.equal(await ui.evaluate(`(() => { const card = document.querySelector('[data-card-id="${item.id}"]'); if (!card) return false; card.click(); return true; })()`), true);
    await context.until(() => ui.evaluate(`!!document.querySelector('textarea.work-detail-title')`), 'existing item detail');
    await ui.fill('Card title', title);
    await ui.evaluate(`document.activeElement.blur()`);
    const saved = await persisted(context, value => value.queued.length === 1 && value.queued[0].write.patch?.title === title,
      'N02 actual offline edit queued on device');
    const queue = saved.queued[0];
    assert.equal(queue.state, 'queued');
    assert.equal(queue.write.op, 'patch');
    assert.equal(queue.write.id, item.id);
    assert.equal(queue.base.revision, item.revision);
    assert.equal(saved.unconfirmed.length, 0);
    const boundary = work.ledger.length;
    await context.stopApp(); await context.launchApp();
    await offline(context, ui);
    const restored = await persisted(context, value => value.queued.length === 1, 'N02 queued edit survives Electron restart');
    assert.deepEqual(restored.queued[0], queue);
    assert.equal(mutations(work, boundary).length, 0, 'offline restore sends no mutations');
    await context.capture('work-queued-restart-offline');
    down = false; await work.start();
    assert.equal(work.origin, origin); assert.equal(work.database, database);
    await refresh(context, ui);
    await persisted(context, value => value.queued.length === 0 && value.unconfirmed.length === 0, 'N02 queue resolved');
    const after = await work.state();
    assert.equal(after.state_version, before.state_version + 1);
    assert.equal(after.items.length, before.items.length);
    assert.deepEqual(after.items.filter(i => i.id !== item.id), before.items.filter(i => i.id !== item.id));
    const updated = after.items.find(i => i.id === item.id);
    assert.equal(updated.title, title); assert.equal(updated.revision, item.revision + 1);
    const writes = mutations(work, boundary);
    assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].path, `/api/items/${item.id}`); assert.equal(writes[0].status, 200);
    assert.ok(writes[0].requestId);
    assert.deepEqual(JSON.parse(writes[0].body), { revision: item.revision, patch: { title } });
    const quiet = work.ledger.length;
    await context.domain('Design'); await context.domain('Work');
    assert.equal((await ui.evaluate(`window.hqServices.work.call('state', {})`)).ok, true);
    assert.deepEqual(stableState(await work.state()), stableState(after));
    assert.equal(mutations(work, quiet).length, 0);
    await context.until(() => ui.evaluate(`document.querySelector('[data-card-id="${item.id}"]')?.textContent.includes(${JSON.stringify(title)})`), 'N02 edited item visible after reconnect');
    await context.capture('work-queued-restart-confirmed');
    context.passed({ scenario: 'N02', queueId: queue.queueId, queuedRequestId: queue.requestId,
      sentRequestId: writes[0].requestId, patchSequence: writes[0].count, itemId: item.id,
      revisionBefore: item.revision, revisionAfter: updated.revision, stateVersion: after.state_version });
  } catch (error) { failure = error; throw error; } finally {
    await restoreOwnedPlanner(work, down, failure);
  }
}

export async function workDraftNativeRestart(context) {
  context.begin('work-draft-native-restart');
  const { work } = context.fixtures, ui = uiDriver(context);
  assert.equal(typeof work.start, 'function', 'INT must supply owned Planner start-after-stop control');
  const before = await work.state(), title = `Kept draft ${randomUUID()}`;
  const origin = work.origin, database = work.database;
  let down = false, failure;
  try {
    await work.stop(); down = true;
    await offline(context, ui);
    const boundary = work.ledger.length;
    await ui.fill('Capture to Inbox', title);
    await ui.click('Capture', 'form[aria-label="Quick capture"]');
    await ui.click('Keep as HQ draft', 'form[aria-label="Quick capture"]');
    await context.until(() => ui.evaluate(`document.querySelector('section[aria-label="HQ drafts"]')?.textContent.includes('HQ drafts are kept on this device')`), 'N03 device save confirmed in UI');
    const saved = await persisted(context, value => value.drafts.length === 1 && value.drafts[0].fields.title === title,
      'N03 kept draft persisted');
    const draft = saved.drafts[0];
    assert.equal(mutations(work, boundary).length, 0, 'guarded offline Capture and Keep do not create');
    await context.stopApp(); await context.launchApp();
    await offline(context, ui);
    await context.until(() => ui.evaluate(`document.querySelector('section[aria-label="HQ drafts"]')?.textContent.includes(${JSON.stringify(title)})`), 'N03 kept draft restored in fresh UI');
    assert.deepEqual((await persisted(context, value => value.drafts.length === 1, 'N03 restored persisted draft')).drafts[0], draft);
    down = false; await work.start();
    assert.equal(work.origin, origin); assert.equal(work.database, database);
    await refresh(context, ui);
    await context.domain('Design'); await context.domain('Work');
    assert.equal((await ui.evaluate(`window.hqServices.work.call('state', {})`)).ok, true);
    assert.deepEqual(stableState(await work.state()), stableState(before));
    assert.equal(mutations(work, boundary).length, 0, 'restore/reconnect/navigation never send drafts');
    const sendBoundary = work.ledger.length;
    await ui.click('Send drafts', 'section[aria-label="HQ drafts"]');
    await persisted(context, value => value.drafts.length === 0 && value.unconfirmed.length === 0,
      'N03 successful explicit send clears durable draft');
    const after = await work.state(), writes = mutations(work, sendBoundary);
    assert.equal(writes.length, 1); assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].path, '/api/items'); assert.equal(writes[0].status, 201);
    assert.equal(after.state_version, before.state_version + 1);
    assert.deepEqual(after.items.filter(i => i.title !== title), before.items);
    const created = after.items.filter(i => i.title === title);
    assert.equal(created.length, 1); assert.equal(writes[0].response.item.id, created[0].id);
    await context.until(() => ui.evaluate(`!document.querySelector('section[aria-label="HQ drafts"] .work-draft')`), 'N03 draft cleared in UI after success');
    const quiet = work.ledger.length;
    await context.domain('Design'); await context.domain('Work');
    await ui.evaluate(`window.hqServices.work.call('state', {})`);
    assert.equal(mutations(work, quiet).length, 0);
    assert.deepEqual(stableState(await work.state()), stableState(after));
    await context.until(() => ui.evaluate(`document.querySelector('[data-card-id="${created[0].id}"]')?.textContent.includes(${JSON.stringify(title)})`), 'N03 explicitly sent item visible');
    await context.capture('work-kept-draft-restart-sent');
    context.passed({ scenario: 'N03', draftId: draft.id, createSequence: writes[0].count,
      itemId: created[0].id, stateVersion: after.state_version, limitation: 'Only explicitly kept, device-confirmed drafts are claimed durable.' });
  } catch (error) { failure = error; throw error; } finally {
    await restoreOwnedPlanner(work, down, failure);
  }
}

async function restoreOwnedPlanner(work, down, failure) {
  if (!down) return;
  try { await work.start(); }
  catch (cleanup) {
    if (!failure) throw cleanup;
    failure.message += `; owned Planner cleanup failed: ${cleanup.message}`;
    failure.stack += `\nOwned Planner cleanup failure: ${cleanup.stack ?? cleanup.message}`;
  }
}

// Planner stamps each read; compare all actual state fields apart from that clock.
function stableState({ server_time, ...state }) { return state; }
