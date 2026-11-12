import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SIZE, FONT_ALIASES, MODES, NAV, OFFLINE_ORIGIN, UsageError, fontconfigXml, formatSize, keyEvents,
  normalizeKey, normalizeModifiers, parseMediaFeatures, parseMode, parseSize, parseSizes, parseThemes, pickFace,
  resolveSize, serviceConfigFor,
} from '../config.mjs';

test('parseSize accepts WIDTHxHEIGHT and rejects everything else', () => {
  assert.deepEqual(parseSize('1440x900'), { width: 1440, height: 900 });
  assert.deepEqual(parseSize(' 760X560 '), { width: 760, height: 560 });
  for (const bad of ['', '1440', '1440*900', 'x900', '1440x', '12x12', '99999x900', '100x100', '4000x900', '1440x2500', undefined, 'abcxdef']) {
    assert.throws(() => parseSize(bad), UsageError, `expected ${bad} to be rejected`);
  }
});

test('resolveSize defaults, and accepts strings and objects', () => {
  assert.deepEqual(resolveSize(), DEFAULT_SIZE);
  assert.notEqual(resolveSize(), DEFAULT_SIZE, 'callers get a copy');
  assert.deepEqual(resolveSize('800x600'), { width: 800, height: 600 });
  assert.deepEqual(resolveSize({ width: 800, height: 600 }), { width: 800, height: 600 });
  assert.throws(() => resolveSize({ width: 5, height: 5 }), UsageError);
  assert.equal(formatSize(resolveSize()), '1440x900');
});

test('parseSizes keeps order, drops duplicates and requires at least one size', () => {
  assert.deepEqual(parseSizes('1440x900, 760x560,1440x900').map(formatSize), ['1440x900', '760x560']);
  assert.throws(() => parseSizes(''), UsageError);
  assert.throws(() => parseSizes(','), UsageError);
  assert.throws(() => parseSizes('1440x900,wide'), UsageError);
});

test('parseMode and parseThemes validate against the known values', () => {
  assert.deepEqual([...MODES], ['example', 'live', 'offline']);
  assert.equal(parseMode(), 'example');
  assert.equal(parseMode('live'), 'live');
  assert.throws(() => parseMode('dead'), /Unknown mode "dead"/);
  assert.deepEqual(parseThemes('dark,light,dark'), ['dark', 'light']);
  assert.throws(() => parseThemes('sepia'), UsageError);
  assert.throws(() => parseThemes(' '), UsageError);
});

test('modes map to the service configuration the app should find', () => {
  assert.equal(serviceConfigFor('example'), null, 'example leaves the app on its built-in examples');
  assert.deepEqual(serviceConfigFor('offline'), { work: OFFLINE_ORIGIN, social: OFFLINE_ORIGIN });
  assert.deepEqual(serviceConfigFor('live', { work: 'http://127.0.0.1:1111', social: 'http://127.0.0.1:2222' }), { work: 'http://127.0.0.1:1111', social: 'http://127.0.0.1:2222' });
  assert.throws(() => serviceConfigFor('live', { work: 'http://127.0.0.1:1111' }), /both work and social/);
  assert.throws(() => serviceConfigFor('bogus'), UsageError);
});

test('the offline endpoint is loopback on a privileged port nothing can bind as a user', () => {
  const url = new URL(OFFLINE_ORIGIN);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(Number(url.port) < 1024);
});

test('the navigation table names every selector the tools depend on', () => {
  assert.ok(NAV.domainScopes.length >= 2, 'a fallback scope exists besides the primary one');
  assert.ok(NAV.domainScopes.includes('nav[aria-label="Domains"]'));
  assert.equal(NAV.settingsName, 'Settings');
  assert.equal(NAV.current, '[aria-current="page"]');
  assert.ok(Object.isFrozen(NAV) && Object.isFrozen(NAV.domainScopes));
});

test('keys normalize names, aliases and single characters', () => {
  assert.equal(normalizeKey('enter'), 'Enter');
  assert.equal(normalizeKey('Esc'), 'Escape');
  assert.equal(normalizeKey('pgdn'), 'PageDown');
  assert.equal(normalizeKey('k'), 'k');
  assert.equal(normalizeKey(' '), 'Space');
  assert.throws(() => normalizeKey('Hyper'), /Unknown key/);
  assert.throws(() => normalizeKey(''), UsageError);
});

test('modifiers accept lists, strings and aliases, and reject unknown names', () => {
  assert.deepEqual(normalizeModifiers('ctrl,Shift'), ['ctrl', 'shift']);
  assert.deepEqual(normalizeModifiers(['cmd', 'option', 'cmd']), ['meta', 'alt']);
  assert.deepEqual(normalizeModifiers(undefined), []);
  assert.throws(() => normalizeModifiers('ctrl,super'), /Unknown modifier "super"/);
});

test('keyEvents builds a down/up pair with CDP modifier bits', () => {
  const [down, up] = keyEvents('k', ['ctrl', 'shift']);
  assert.equal(down.modifiers, 2 | 8);
  assert.equal(down.type, 'rawKeyDown', 'a control chord types no text');
  assert.equal(down.text, undefined);
  assert.equal(down.code, 'KeyK');
  assert.equal(up.type, 'keyUp');
  const [plain] = keyEvents('a');
  assert.equal(plain.type, 'keyDown');
  assert.equal(plain.text, 'a');
  const [enter] = keyEvents('Enter');
  assert.equal(enter.text, '\r');
  assert.equal(enter.windowsVirtualKeyCode, 13);
  const [escape] = keyEvents('Escape');
  assert.equal(escape.type, 'rawKeyDown');
  assert.equal(keyEvents('Space')[0].key, ' ');
});

test('media features validate names and values and accept pairs or an object', () => {
  assert.deepEqual(parseMediaFeatures(['prefers-color-scheme=dark', 'prefers-reduced-motion=reduce']), { 'prefers-color-scheme': 'dark', 'prefers-reduced-motion': 'reduce' });
  assert.deepEqual(parseMediaFeatures({ 'prefers-contrast': 'more' }), { 'prefers-contrast': 'more' });
  assert.throws(() => parseMediaFeatures(['prefers-color-scheme']), /feature=value/);
  assert.throws(() => parseMediaFeatures(['prefers-color-scheme=purple']), /Invalid value "purple"/);
  assert.throws(() => parseMediaFeatures(['screen-brightness=high']), /Unknown media feature/);
  assert.throws(() => parseMediaFeatures([]), UsageError);
});

test('font alias picks the first preferred face that is installed', () => {
  assert.equal(pickFace(['Liberation Mono', 'Liberation Sans', 'DejaVu Sans']), 'Liberation Sans');
  assert.equal(pickFace(['dejavu sans ']), 'DejaVu Sans');
  assert.equal(pickFace(['Liberation Mono']), null);
});

test('fontconfig XML aliases every app family to the chosen face and escapes names', () => {
  const xml = fontconfigXml('Liberation Sans');
  for (const family of FONT_ALIASES) assert.ok(xml.includes(`<string>${family}</string>`), family);
  assert.equal(xml.split('<string>Liberation Sans</string>').length - 1, FONT_ALIASES.length);
  assert.ok(xml.includes('/etc/fonts/fonts.conf'), 'host defaults stay included');
  assert.ok(fontconfigXml('A&B <"x">', ['f']).includes('A&amp;B &lt;&quot;x&quot;&gt;'));
});
