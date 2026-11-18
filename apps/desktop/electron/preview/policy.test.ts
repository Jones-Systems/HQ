import { expect, it } from 'vitest';
import { previewTarget, requestAllowed } from './policy';
import { previewParams, validAgentEvent } from './validation';
it.each(['file:///tmp/x', 'https://user:secret@example.com/', 'http://example.com/', 'javascript:alert(1)', 'https://example.com/\\path'])('refuses unsafe target %s', value => expect(previewTarget(value)).toBeNull());
it('pins main navigation while allowing ordinary public subresources', () => {
  const target = new URL('https://example.com');
  expect(requestAllowed('https://example.com/page', target, true)).toBe(true);
  expect(requestAllowed('https://other.example/script.js', target, false)).toBe(true);
  expect(requestAllowed('https://other.example/', target, true)).toBe(false);
  for (const url of ['file:///tmp/a', 'hq-component://x/', 'http://127.0.0.1/', 'http://192.168.1.2/', 'http://host.local/']) expect(requestAllowed(url, target, false)).toBe(false);
  expect(requestAllowed('http://localhost:1234/', new URL('http://localhost:1234/'), true)).toBe(true);
});
it('validates closed routes and bounded requests', () => {
  expect(previewParams('open', { versionId: 'version', label: 'Page', url: 'https://example.com', viewport: { w: 390, h: 844, dpr: 2 } })).toBe(true);
  expect(previewParams('status', { sessionId: 'session', url: 'https://example.com' })).toBe(false);
  expect(previewParams('navigate', { sessionId: 's', route: '//other.example/' })).toBe(false);
  expect(previewParams('resolve', { sessionId: 's', generation: 0, requests: Array(51).fill({ kind: 'element', path: 'body' }) })).toBe(false);
  expect(validAgentEvent({ type: 'element-picked' })).toBe(false);
});
