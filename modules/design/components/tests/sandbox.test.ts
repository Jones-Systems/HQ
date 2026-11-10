import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYNTHETIC_MOTION, SYNTHETIC_SYSTEM } from '../src/fixtures.ts';
import { parseMotionStudy, sampleStudy } from '../src/model/motion.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { parseDesignSystem, resolveTokens } from '../src/model/tokens.ts';
import { judgeProbe } from '../src/review/isolation-probe.ts';
import { motionFrameMessage, parseSandboxMessage } from '../src/review/sandbox-channel.ts';
import {
  SANDBOX_CHANNEL, SANDBOX_CSP, buildSandboxDocument, createSandboxNonce, sandboxFrameAttributes, validateSandboxTokens,
} from '../src/review/sandbox-document.ts';
import { seededWorkspace } from './helpers.ts';

const tokens = resolveTokens(parseDesignSystem(SYNTHETIC_SYSTEM)).values;
const NONCE = 'nonce-for-tests-01';

test('frames get allow-scripts only: an opaque origin with no same-origin, top navigation or popups', async () => {
  const { button } = await seededWorkspace();
  const attributes = sandboxFrameAttributes(button, resolveRenderInput(button, null, null, {}, tokens), { nonce: NONCE });
  assert.equal(attributes.sandbox, 'allow-scripts');
  assert.equal(attributes.referrerPolicy, 'no-referrer');
  assert.match(attributes.allow, /camera 'none'/u);
  for (const token of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-popups-to-escape-sandbox']) {
    assert.throws(() => validateSandboxTokens(`allow-scripts ${token}`), /break component isolation/u);
  }
  assert.throws(() => validateSandboxTokens('allow-scripts allow-unknown'), /not granted/u);
});

test('the srcdoc carries its own deny-by-default CSP and nothing from the host', async () => {
  const { button } = await seededWorkspace();
  const html = buildSandboxDocument(button, resolveRenderInput(button, null, null, {}, tokens), { nonce: NONCE });
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.indexOf('Content-Security-Policy') < head.indexOf('<style'), 'CSP precedes all content');
  assert.ok(html.includes(`content="${SANDBOX_CSP}"`));
  for (const directive of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "default-src 'none'"]) {
    assert.ok(SANDBOX_CSP.includes(directive), directive);
  }
  for (const hostOnly of ['hqDesktop', 'require(', 'process.', 'ipcRenderer', 'contextBridge', 'localStorage']) {
    assert.ok(!html.includes(hostOnly), `srcdoc must not mention ${hostOnly}`);
  }
});

test('prop text cannot break out of its JSON script element', async () => {
  const { button } = await seededWorkspace();
  const hostile = '</script><script>parent.document.title="pwned"</script><!--';
  const html = buildSandboxDocument(button, resolveRenderInput(button, null, null, { label: hostile }, tokens), { nonce: NONCE });
  assert.ok(!html.includes(hostile));
  const scripts = html.match(/<script\b/giu) ?? [];
  const closes = html.match(/<\/script>/giu) ?? [];
  assert.equal(scripts.length, 4, 'bootstrap, props, tokens and component scripts only');
  assert.equal(closes.length, scripts.length);
  assert.ok(html.includes('\\u003c/script\\u003e'));
});

test('a render input bound to another revision is refused', async () => {
  const { button, card } = await seededWorkspace();
  const input = resolveRenderInput(card, null, null, {}, tokens);
  assert.throws(() => buildSandboxDocument(button, input, { nonce: NONCE }), /different component revision/u);
  assert.throws(() => buildSandboxDocument(card, input, { nonce: 'short' }), /nonce/u);
});

test('host accepts only exact-frame, opaque-origin, nonce-matched, well-formed messages', () => {
  const frame = {};
  const other = {};
  const good = { source: frame, origin: 'null', data: { channel: SANDBOX_CHANNEL, nonce: NONCE, type: 'size', detail: { width: 120.4, height: 99999 } } };
  assert.deepEqual(parseSandboxMessage(good, frame, NONCE), { type: 'size', width: 120, height: 8192 });
  assert.equal(parseSandboxMessage({ ...good, source: other }, frame, NONCE), null, 'another window');
  assert.equal(parseSandboxMessage({ ...good, origin: 'http://127.0.0.1:5173' }, frame, NONCE), null, 'non-opaque origin');
  assert.equal(parseSandboxMessage({ ...good, data: { ...good.data, nonce: 'nonce-other-000' } }, frame, NONCE), null, 'wrong nonce');
  assert.equal(parseSandboxMessage({ ...good, data: { ...good.data, type: 'invoke' } }, frame, NONCE), null, 'unknown type');
  assert.equal(parseSandboxMessage({ ...good, data: { ...good.data, detail: { width: 'x', height: 1 } } }, frame, NONCE), null);
  assert.equal(parseSandboxMessage(good, null, NONCE), null, 'no frame window');
  assert.deepEqual(
    parseSandboxMessage({ ...good, data: { ...good.data, type: 'error', detail: { message: 'x'.repeat(900) } } }, frame, NONCE),
    { type: 'error', message: 'x'.repeat(500) },
  );
});

test('motion frames sent to a sandbox contain only sampled styles', () => {
  const study = parseMotionStudy(SYNTHETIC_MOTION);
  const message = motionFrameMessage(study, sampleStudy(study, 300), NONCE) as { detail: { styles: Record<string, unknown> } };
  assert.deepEqual(Object.keys(message).sort(), ['channel', 'detail', 'nonce', 'type']);
  assert.deepEqual(Object.keys(message.detail.styles).sort(), ['badge', 'card']);
});

test('nonces are random identifiers, and probe judgement requires every host reach to be blocked', () => {
  assert.notEqual(createSandboxNonce(), createSandboxNonce());
  assert.match(createSandboxNonce(), /^[0-9a-f]{32}$/u);
  const isolated = {
    'parent.document': 'blocked:SecurityError', 'parent.hqDesktop': 'blocked:SecurityError', 'top.hqDesktop': 'blocked:SecurityError',
    'parent.location.href': 'blocked:SecurityError', 'self.hqDesktop': 'absent', 'self.require': 'absent', 'self.process': 'absent',
    frameElement: 'null', origin: 'null', cookie: 'blocked:SecurityError', localStorage: 'blocked:SecurityError',
    'window.open': 'null', fetch: 'blocked:TypeError',
  };
  assert.equal(judgeProbe(isolated).passed, true);
  const leaked = judgeProbe({ ...isolated, 'parent.hqDesktop': 'reachable', origin: 'http://127.0.0.1:5173' });
  assert.equal(leaked.passed, false);
  assert.deepEqual(leaked.failures, ['parent.hqDesktop=reachable', 'origin=http://127.0.0.1:5173']);
  const { fetch: _fetch, ...partial } = isolated;
  assert.deepEqual(judgeProbe(partial).missing, ['fetch']);
});
