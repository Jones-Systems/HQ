import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from './fake_dom.mjs';

installFakeDom();
const { state } = await import('../public/js/state.js');
const { mountDetail, renderDetail, closeDetailPanel } = await import('../public/js/detail.js');
const target = { version: 1, domain: 'design', projectId: 'example-project', kind: 'artifact',
  entityId: 'example-entity', title: '<img src=x onerror=alert(1)>',
  returnDestination: { domain: 'design', destination: 'artifact/example' }, sourceRevision: '7' };
const hq = { id: 'hqref01', kind: 'hq', label: 'Snapshot', target };
const other = { id: 'urlref1', kind: 'url', label: 'Example', url: 'https://example.com/' };
const item = { id: 'item0001', revision: 1, title: 'Example', kind: 'idea', status: 'inbox',
  motivation: null, horizon: null, priority: null, area: null, notes: '', next_steps: [], dates: [],
  references: [hq, other], position: 1024, is_example: false, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', archived_at: null, reviewed_at: null };
const ctx = { today: '2026-01-15', filters: {}, view: () => 'board', go() {}, openItem() {}, closeItem() {},
  rerender() {}, keepFocus() {}, openCapture() {}, openMoveMenu() {}, loadExamples() {},
  draftsPanel: () => document.createElement('div') };

function setup() {
  state.items = [structuredClone(item)];
  state.byId = new Map(state.items.map((value) => [value.id, value]));
  state.phase = 'ready';
  state.connection = 'online';
  const panel = document.createElement('aside');
  document.body.append(panel);
  mountDetail(panel, ctx);
  closeDetailPanel();
  renderDetail(item.id, ctx);
  return panel;
}

test('HQ snapshot renders as literal text and never an external link', () => {
  const panel = setup();
  const row = panel.querySelectorAll('.ref')[0];
  assert.ok(row.textContent.includes(`Linked in HQ: ${target.title}`));
  assert.equal(row.querySelectorAll('a').length, 0);
  assert.equal(row.querySelectorAll('img').length, 0);
  assert.equal(panel.querySelectorAll('.ref')[1].querySelectorAll('a').length, 1);
  panel.remove();
});

test('removing another reference resaves the exact HQ target; removing HQ removes only it', async (t) => {
  const sent = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (path, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.patch.references);
    return { ok: true, json: async () => ({ item: { ...state.byId.get(item.id), ...body.patch, revision: body.revision + 1 }, state_version: sent.length }) };
  };
  let panel = setup();
  const remove = panel.querySelectorAll('.ref')[1].querySelector('button');
  await remove.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(sent[0], [hq]);
  panel.remove();
  panel = setup();
  await panel.querySelectorAll('.ref')[0].querySelector('button').listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(sent[1], [other]);
  panel.remove();
});
