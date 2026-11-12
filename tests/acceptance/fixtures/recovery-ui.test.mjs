import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { recoveryUi, clickRecoveryControl } from './recovery-ui.mjs';
import { uiDriver } from '../scenarios/ui.mjs';
import { unavailableServiceScenario } from '../scenarios/services.mjs';

async function withDom(run) {
  const window = new Window();
  window.HTMLElement.prototype.scrollIntoView = function () {};
  try { await run(window); } finally { await window.happyDOM.close(); }
}
function driver(window) {
  return {
    cdp: () => ({
      evaluate: expression => window.eval(expression),
      send: async (method, { text }) => {
        assert.equal(method, 'Input.insertText');
        window.document.activeElement.value = text;
        window.document.activeElement.dispatchEvent(new window.Event('input', { bubbles: true }));
      },
    }),
    until: async (predicate, description) => {
      const result = await predicate();
      assert.ok(result, description);
      return result;
    },
  };
}

test('Social accepts empty and populated Library; shortcut-decorated Save draft blocks unknown intent', () => withDom(async window => {
  const { document } = window, context = driver(window);
  for (const className of ['soc-lib-empty', 'soc-lib-list']) {
    document.body.innerHTML = `<section class="${className}"></section>`;
    assert.equal(window.eval(recoveryUi.socialLibraryReady), true);
  }
  for (const empty of [true, false]) {
    document.body.innerHTML = `<div class="sx-page"><header><button>New draft</button></header>${empty ? '<div class="soc-lib-empty"><button>New draft</button></div>' : '<section class="soc-lib-list"></section>'}</div>`;
    const scope = window.eval(recoveryUi.socialNewDraftScope);
    let opened = 0;
    document.querySelector(`${scope} button`).onclick = () => opened++;
    await uiDriver(context).click('New draft', scope);
    assert.equal(opened, 1, 'empty invitation and frame header select one control');
  }
  document.body.innerHTML = '<section class="soc-list"></section>';
  assert.equal(window.eval(recoveryUi.socialLibraryReady), false);
  document.body.innerHTML = `<section class="soc-cmp"><div class="soc-savebar-actions"><button>Archive</button><button aria-keyshortcuts="Control+S Meta+S">Save draft<kbd>⌘ S</kbd></button></div></section>`;
  const button = document.querySelector('[aria-keyshortcuts]');
  let saves = 0; button.onclick = () => saves++;
  await clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft');
  assert.equal(saves, 1);
  button.disabled = true;
  assert.equal(window.eval(recoveryUi.socialSaveBlocked), true);
  await assert.rejects(clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft'));
  assert.equal(saves, 1, 'unknown disabled save cannot be retried');
  button.disabled = false;
  button.after(button.cloneNode(true));
  assert.equal(window.eval(recoveryUi.socialSaveBlocked), false);
  await assert.rejects(clickRecoveryControl(context, recoveryUi.socialSaveButton, 'Save draft'));
  assert.equal(saves, 1, 'ambiguous controls never dispatch');
}));

test('Work detail readiness and return require the textarea and exact inner label despite appended hints', () => withDom(async window => {
  const { document } = window, context = driver(window), title = 'Acceptance capture "quoted"';
  document.body.innerHTML = '<input class="work-detail-title"><button><span class="hq-return-label"></span><span>⌘ [</span></button>';
  assert.equal(window.eval(recoveryUi.workDetailReady()), false);
  const input = document.querySelector('input');
  input.replaceWith(document.createElement('textarea'));
  const textarea = document.querySelector('textarea'); textarea.className = 'work-detail-title'; textarea.value = title;
  assert.equal(window.eval(recoveryUi.workDetailReady()), true);
  assert.equal(window.eval(recoveryUi.workDetailReady(title)), true);
  assert.equal(window.eval(recoveryUi.workDetailReady('another item')), false);
  const label = document.querySelector('.hq-return-label'); label.textContent = `Back to ${title}`;
  const button = label.closest('button'); let returns = 0; button.onclick = () => returns++;
  await clickRecoveryControl(context, recoveryUi.returnButton(title), 'Back');
  assert.equal(returns, 1);
  await assert.rejects(clickRecoveryControl(context, recoveryUi.returnButton('another item'), 'Back'));
  button.setAttribute('aria-hidden', 'true');
  await assert.rejects(clickRecoveryControl(context, recoveryUi.returnButton(title), 'Back'));
  assert.equal(returns, 1);
}));

async function offlineScenario(window, guarded) {
  const { document } = window, context = driver(window), work = { ledger: [], stop: async () => {} }, social = { ledger: [], stop: async () => {} };
  let workMarkup;
  let title = '';
  window.hqServices = Object.fromEntries(['work', 'social'].map(name => [name, { call: async () => {
    (name === 'work' ? work : social).ledger.push({ method: 'GET' });
    return { ok: false, kind: 'unavailable' };
  } }]));
  const domain = async name => {
    if (document.querySelector('form')) { workMarkup = document.body.innerHTML; title = document.querySelector('input').value; }
    if (name !== 'Work') { document.body.innerHTML = '<main>Social service unavailable</main>'; return; }
    document.body.innerHTML = workMarkup ?? '<main>Planner service unreachable<form aria-label="Quick capture"><label for="capture">Capture to Inbox</label><input id="capture"><button>Capture</button><div class="notice"></div></form></main>';
    document.querySelector('input').value = title;
    document.querySelector('button').onclick = event => {
      event.preventDefault();
      if (!guarded) { work.ledger.push({ method: 'POST' }); return; }
      document.querySelector('.notice').innerHTML = '<div role="alert">Planner unreachable · nothing was saved<button>Keep as HQ draft</button></div>';
    };
  };
  let passed = false;
  await unavailableServiceScenario({ ...context, fixtures: { work, social }, domain,
    stopApp: async () => {}, launchApp: async () => {}, capture: async () => {}, begin: () => {}, passed: () => { passed = true; } });
  assert.equal(passed, true);
  assert.equal(work.ledger.some(entry => entry.method !== 'GET'), false);
}

test('unavailable journey permits local typing, requires explicit offline guard, and preserves text across domains', () => withDom(window => offlineScenario(window, true)));
test('unavailable journey fails when Capture sends instead of showing the offline guard', () => withDom(window => assert.rejects(offlineScenario(window, false), /explicit offline send/)));
