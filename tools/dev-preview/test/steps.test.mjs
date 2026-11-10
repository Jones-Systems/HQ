import assert from 'node:assert/strict';
import test from 'node:test';
import { UsageError } from '../config.mjs';
import { ROUTES, STEP_ACTIONS, normalizeRequest, normalizeStep, normalizeSteps } from '../steps.mjs';

test('every step action is also a control route, and lifecycle routes are not steps', () => {
  for (const action of STEP_ACTIONS) assert.ok(ROUTES.includes(action), action);
  for (const route of ['quit', 'status', 'log', 'ledger', 'errors']) assert.ok(!STEP_ACTIONS.includes(route), route);
});

test('click needs exactly one kind of target', () => {
  assert.deepEqual(normalizeRequest('click', { text: 'Work' }), { text: 'Work', nth: 0, contains: false, force: false });
  assert.deepEqual(normalizeRequest('click', { selector: 'nav button', nth: 2, contains: true }), { selector: 'nav button', nth: 2, contains: true, force: false });
  assert.deepEqual(normalizeRequest('click', { x: 10, y: 20 }), { x: 10, y: 20, force: true });
  assert.throws(() => normalizeRequest('click', {}), /needs text, selector or x and y/);
  assert.throws(() => normalizeRequest('click', { text: 'a', x: 1, y: 2 }), /not both/);
  assert.throws(() => normalizeRequest('click', { x: 1 }), UsageError);
  assert.throws(() => normalizeRequest('click', { text: '' }), UsageError);
  assert.throws(() => normalizeRequest('click', { text: 'a', nth: -1 }), UsageError);
  assert.throws(() => normalizeRequest('click', { text: 'a', scope: 'nav' }), /array of selectors/);
  assert.throws(() => normalizeRequest('click', { text: 'a', bogus: 1 }), /unknown field bogus/);
});

test('shot names are file stems that cannot escape the evidence directory', () => {
  assert.deepEqual(normalizeRequest('shot', {}), { name: 'shot', settle: true });
  assert.deepEqual(normalizeRequest('shot', { name: 'work-dark.png', settle: false }), { name: 'work-dark', settle: false });
  for (const name of ['../x', 'a/b', '.hidden', 'a..b', '', 'x'.repeat(81)]) assert.throws(() => normalizeRequest('shot', { name }), UsageError, name);
});

test('window, media, key, svc, wait and errors validate their fields', () => {
  assert.deepEqual(normalizeRequest('window', { width: 760, height: 560 }), { width: 760, height: 560 });
  assert.deepEqual(normalizeRequest('window', { size: '1024x768' }), { width: 1024, height: 768 });
  assert.deepEqual(normalizeRequest('window', { reset: true }), { reset: true });
  assert.throws(() => normalizeRequest('window', { width: 760 }), UsageError);
  assert.deepEqual(normalizeRequest('media', { features: { 'prefers-color-scheme': 'dark' } }), { features: { 'prefers-color-scheme': 'dark' } });
  assert.deepEqual(normalizeRequest('media', { reset: true }), { reset: true });
  assert.throws(() => normalizeRequest('media', { features: { 'prefers-color-scheme': 'mauve' } }), UsageError);
  assert.deepEqual(normalizeRequest('key', { key: 'esc', mods: 'ctrl' }), { key: 'Escape', mods: ['ctrl'], repeat: 1 });
  assert.throws(() => normalizeRequest('key', { key: 'a', repeat: 51 }), UsageError);
  assert.deepEqual(normalizeRequest('svc', { down: true }), { down: true, target: 'all' });
  assert.throws(() => normalizeRequest('svc', { down: 'yes' }), /down: true or false/);
  assert.throws(() => normalizeRequest('svc', { down: true, target: 'wiki' }), UsageError);
  assert.deepEqual(normalizeRequest('wait', { ms: 250 }), { ms: 250 });
  assert.deepEqual(normalizeRequest('wait', { text: 'Done' }), { text: 'Done', timeout: 5000 });
  assert.throws(() => normalizeRequest('wait', {}), /needs ms, text or selector/);
  assert.throws(() => normalizeRequest('wait', { ms: 1, text: 'a' }), /not both/);
  assert.throws(() => normalizeRequest('wait', { ms: 999999 }), UsageError);
  assert.deepEqual(normalizeRequest('errors', {}), { since: 0, clear: false });
  assert.deepEqual(normalizeRequest('settle', {}), { timeout: 4000 });
  assert.throws(() => normalizeRequest('settle', { timeout: 60000 }), UsageError);
});

test('eval and type enforce size limits and string types', () => {
  assert.deepEqual(normalizeRequest('eval', { expr: '1 + 1' }), { expr: '1 + 1' });
  assert.throws(() => normalizeRequest('eval', { expr: '' }), UsageError);
  assert.throws(() => normalizeRequest('eval', { expr: 5 }), UsageError);
  assert.throws(() => normalizeRequest('eval', { expr: 'x'.repeat(100_001) }), /longer than/);
  assert.deepEqual(normalizeRequest('type', { text: '' }), { text: '' });
  assert.throws(() => normalizeRequest('type', {}), UsageError);
});

test('requests must be JSON objects for known routes', () => {
  assert.throws(() => normalizeRequest('nope', {}), /Unknown route/);
  assert.throws(() => normalizeRequest('eval', [1]), /must be a JSON object/);
  assert.throws(() => normalizeRequest('eval', 'x'), /must be a JSON object/);
  assert.deepEqual(normalizeRequest('quit'), {});
  assert.throws(() => normalizeRequest('quit', { now: true }), /unknown field now/);
});

test('steps name the offending entry and refuse unknown or lifecycle actions', () => {
  assert.deepEqual(normalizeStep({ do: 'domain', name: 'Work' }), { do: 'domain', name: 'Work' });
  assert.deepEqual(normalizeStep({ do: 'shot', name: 'a' }), { do: 'shot', name: 'a', settle: true });
  assert.throws(() => normalizeStep({ do: 'shot' }, 3), /steps\[3\]: a shot step needs a "name"/);
  assert.throws(() => normalizeStep({ do: 'clck', text: 'x' }, 1), /steps\[1\]: unknown action "clck"/);
  assert.throws(() => normalizeStep({ do: 'quit' }), /unknown action "quit"/);
  assert.throws(() => normalizeStep({ text: 'x' }), /missing "do"/);
  assert.throws(() => normalizeStep('click'), /must be a JSON object/);
  assert.throws(() => normalizeStep({ do: 'click' }, 2), /steps\[2\]: click: needs text/);
});

test('a step list must be a non-empty bounded array', () => {
  assert.equal(normalizeSteps([{ do: 'settings' }, { do: 'key', key: 'Escape' }]).length, 2);
  assert.throws(() => normalizeSteps({}), /JSON array/);
  assert.throws(() => normalizeSteps([]), /empty/);
  assert.throws(() => normalizeSteps(Array.from({ length: 501 }, () => ({ do: 'settings' }))), /more than 500/);
  assert.throws(() => normalizeSteps([{ do: 'settings' }, { do: 'wait' }]), /steps\[1\]/);
});
