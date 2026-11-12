import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CAPTURE_HELP, CTL_COMMANDS, CTL_HELP, SERVE_HELP, ctlRequest, parseCaptureArgs, parseCtlArgs, parseServeArgs } from '../args.mjs';
import { UsageError } from '../config.mjs';

const defaults = { repo: '/repo/tool' };

test('capture defaults: example mode, one size, both themes, settings on', () => {
  const options = parseCaptureArgs([], defaults);
  assert.equal(options.repo, '/repo/tool');
  assert.equal(options.mode, 'example');
  assert.deepEqual(options.sizes, [{ width: 1440, height: 900 }]);
  assert.deepEqual(options.themes, ['light', 'dark']);
  assert.equal(options.wiki, true);
  assert.equal(options.settings, true);
  assert.equal(options.reducedMotion, false);
  assert.equal(options.installElectron, false);
  assert.equal(options.out, null);
  assert.equal(options.stepsFile, null);
});

test('capture options parse, resolve paths and honour negation', () => {
  const options = parseCaptureArgs(['--repo', 'other', '--mode', 'live', '--size', '1280x800', '--sizes', '1440x900,760x560', '--themes', 'dark',
    '--out', 'shots', '--reduced-motion', '--no-wiki', '--no-settings', '--steps', 'steps.json', '--install-electron'], defaults);
  assert.equal(options.repo, resolve('other'));
  assert.equal(options.mode, 'live');
  assert.deepEqual(options.size, { width: 1280, height: 800 });
  assert.deepEqual(options.sizes.map(size => `${size.width}x${size.height}`), ['1440x900', '760x560']);
  assert.deepEqual(options.themes, ['dark']);
  assert.equal(options.out, resolve('shots'));
  assert.equal(options.reducedMotion, true);
  assert.equal(options.wiki, false);
  assert.equal(options.settings, false);
  assert.equal(options.stepsFile, resolve('steps.json'));
  assert.equal(options.installElectron, true);
});

test('capture rejects bad values, unknown flags and stray arguments with a UsageError', () => {
  for (const argv of [['--mode', 'dead'], ['--size', 'big'], ['--sizes', ''], ['--themes', 'sepia'], ['--bogus'], ['extra'], ['--out'], ['--out', ''], ['--repo', ''], ['--steps', ' ']]) {
    assert.throws(() => parseCaptureArgs(argv, defaults), UsageError, argv.join(' '));
  }
});

test('serve defaults and options', () => {
  const options = parseServeArgs([], defaults);
  assert.equal(options.name, 'default');
  assert.equal(options.idleMinutes, 90);
  assert.equal(options.out, null);
  const custom = parseServeArgs(['--name', 'lane-f3', '--idle-timeout', '0', '--mode', 'offline', '--out', 'x'], defaults);
  assert.equal(custom.name, 'lane-f3');
  assert.equal(custom.idleMinutes, 0);
  assert.equal(custom.mode, 'offline');
  assert.equal(custom.out, resolve('x'));
});

test('serve refuses unsafe session names and malformed numbers', () => {
  for (const name of ['../x', 'a/b', '', '.hidden', 'a b', 'x'.repeat(41)]) assert.throws(() => parseServeArgs(['--name', name], defaults), UsageError, name);
  assert.throws(() => parseServeArgs(['--idle-timeout', '-5'], defaults), UsageError);
  assert.throws(() => parseServeArgs(['--idle-timeout', 'soon'], defaults), /whole number/);
  assert.throws(() => parseServeArgs(['positional'], defaults), UsageError);
});

test('help flags and no command both ask for help', () => {
  assert.equal(parseServeArgs(['--help'], defaults).help, true);
  assert.equal(parseCaptureArgs(['-h'], defaults).help, true);
  assert.equal(parseCtlArgs([], defaults).help, true);
  assert.equal(parseCtlArgs(['--help'], defaults).help, true);
  for (const text of [SERVE_HELP, CAPTURE_HELP, CTL_HELP]) assert.match(text, /Usage: node tools\/dev-preview\//);
  for (const command of CTL_COMMANDS) assert.ok(CTL_HELP.includes(command), `${command} is documented in the ctl help`);
});

test('ctl maps each command to a route and a validated body', () => {
  const ask = (...argv) => { const { route, body } = parseCtlArgs(argv, defaults); return { route, body }; };
  assert.deepEqual(ask('shot', 'work-dark'), { route: 'shot', body: { name: 'work-dark', settle: true } });
  assert.deepEqual(ask('shot', 'a', '--no-settle'), { route: 'shot', body: { name: 'a', settle: false } });
  assert.deepEqual(ask('click', '--text', 'Work'), { route: 'click', body: { text: 'Work', nth: 0, contains: false, force: false } });
  assert.deepEqual(ask('click', '--x', '10', '--y', '20'), { route: 'click', body: { x: 10, y: 20, force: true } });
  assert.deepEqual(ask('click', '--selector', 'nav button', '--nth', '1', '--contains'), { route: 'click', body: { selector: 'nav button', nth: 1, contains: true, force: false } });
  assert.deepEqual(ask('key', 'k', '--mods', 'ctrl,shift'), { route: 'key', body: { key: 'k', mods: ['ctrl', 'shift'], repeat: 1 } });
  assert.deepEqual(ask('type', 'hello', 'world'), { route: 'type', body: { text: 'hello world' } });
  assert.deepEqual(ask('eval', 'document.title'), { route: 'eval', body: { expr: 'document.title' } });
  assert.deepEqual(ask('domain', 'Work'), { route: 'domain', body: { name: 'Work' } });
  assert.deepEqual(ask('window', '760', '560'), { route: 'window', body: { width: 760, height: 560 } });
  assert.deepEqual(ask('window', '1024x768'), { route: 'window', body: { width: 1024, height: 768 } });
  assert.deepEqual(ask('window', 'reset'), { route: 'window', body: { reset: true } });
  assert.deepEqual(ask('media', 'prefers-color-scheme=dark', 'prefers-reduced-motion=reduce'), { route: 'media', body: { features: { 'prefers-color-scheme': 'dark', 'prefers-reduced-motion': 'reduce' } } });
  assert.deepEqual(ask('media', 'reset'), { route: 'media', body: { reset: true } });
  assert.deepEqual(ask('svc', 'down', 'work'), { route: 'svc', body: { down: true, target: 'work' } });
  assert.deepEqual(ask('svc', 'up'), { route: 'svc', body: { down: false, target: 'all' } });
  assert.deepEqual(ask('wait', '250'), { route: 'wait', body: { ms: 250 } });
  assert.deepEqual(ask('wait', '--text', 'Saved', '--timeout', '2000'), { route: 'wait', body: { text: 'Saved', timeout: 2000 } });
  assert.deepEqual(ask('errors', '--since', '4', '--clear'), { route: 'errors', body: { since: 4, clear: true } });
  for (const command of ['status', 'log', 'ledger', 'restart', 'quit', 'settings']) assert.deepEqual(ask(command), { route: command, body: {} });
});

test('ctl options: session, repo, raw and max time', () => {
  const options = parseCtlArgs(['--session', 'mine', '--repo', 'wt', '--raw', '--max-time', '5', 'log'], defaults);
  assert.equal(options.session, 'mine');
  assert.equal(options.repo, resolve('wt'));
  assert.equal(options.raw, true);
  assert.equal(options.maxTimeMs, 5000);
  assert.equal(parseCtlArgs(['status'], defaults).session, 'default');
  assert.equal(parseCtlArgs(['status'], defaults).maxTimeMs, 120_000);
});

test('ctl rejects malformed commands before anything is sent', () => {
  const bad = [
    ['click'], ['click', 'Work'], ['click', '--text', 'a', '--x', '1', '--y', '2'], ['click', '--x', '1'], ['click', '--x', 'one', '--y', '2'],
    ['key'], ['key', 'a', 'b'], ['key', 'Hyper'], ['key', 'a', '--mods', 'super'],
    ['window'], ['window', 'wide'], ['window', '1', '2', '3'], ['window', '10', '10'],
    ['media'], ['media', 'prefers-color-scheme'], ['media', 'prefers-color-scheme=mauve'],
    ['svc'], ['svc', 'sideways'], ['svc', 'down', 'work', 'extra'],
    ['wait'], ['wait', 'soon'], ['eval'], ['domain'], ['status', 'extra'], ['frobnicate'], ['shot', '../escape'],
    ['--session', '../x', 'status'], ['--max-time', 'abc', 'status'],
  ];
  for (const argv of bad) assert.throws(() => parseCtlArgs(argv, defaults), UsageError, argv.join(' '));
  assert.throws(() => ctlRequest('nope', [], {}), /Unknown command/);
});
