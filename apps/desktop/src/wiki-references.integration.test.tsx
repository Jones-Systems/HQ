// @vitest-environment happy-dom
// The Wiki as a registered HQ reference provider (finding X9): the shell's reference port finds Wiki pages and opens
// them with Back-to-origin. The first half scripts the bridge to pin the provider contract through the shell's own
// port and validators; the second half drives the whole shell over the real Wiki host and a synthetic corpus.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import type { HqServices } from '@hq/contracts/services';
import { buildCorpus } from '../../../modules/wiki/app/test/corpus.ts';
import { FEATURE_HQ_REFERENCES, FIXTURE_IDS, resetSocialSessions } from '../../../modules/social/core';
import { createWireStub } from '../../../modules/social/live/test/wire-stub';
import { openWikiRuntime } from '../electron/wiki-runtime.mts';
import { createWikiBridge, wikiIpcHandler } from '../electron/wiki-host';
import { App } from './App';
import { REFERENCE_PROVIDERS } from './reference-providers';
import { createReferencePort } from './references';
import { navigationKey } from './state';

const projectId = 'hq-local';
const READS = ['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus'];
const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

type Reply = (method: string, args: unknown[]) => unknown;
/** A frozen seven-method bridge answering through `reply`; every request is recorded after a structured clone. */
function scriptedWiki(reply: Reply) {
  const calls: { method: string; args: unknown[] }[] = [];
  const wiki = Object.freeze(Object.fromEntries(READS.map(method => [method, async (...args: unknown[]) => {
    calls.push({ method, args: structuredClone(args) }); return structuredClone(reply(method, args));
  }])));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: Object.freeze({ wiki }) });
  return { wiki, calls };
}
const hit = (namespace: string, path: string, title: string) => ({ key: { namespace, path }, title, score: 1, snippet: 'Synthetic excerpt.' });
const page = (key: { namespace: string; path: string }, title: string, commit = COMMIT) =>
  ({ key, title, commit, byteLength: 10, fields: [], outLinks: [], content: { state: 'raw', reason: 'markdown-unsupported', text: 'x' } });
const HITS = [
  hit('bl', 'policies/retry-policy.md', 'Retry Policy'),
  hit('appdev', 'architecture/overview.md', 'Architecture Overview'),
  hit('bl', 'x'.repeat(200), 'Too long to be named by an envelope'),
];
const standard: Reply = (method, args) => {
  if (method === 'search') return { ok: true, value: { query: 'retry', hits: HITS, totalHits: HITS.length, truncated: false } };
  if (method === 'getPage') { const { key } = args[0] as { key: { namespace: string; path: string } }; return { ok: true, value: page(key, `Latest ${key.path}`) }; }
  return { ok: false, error: { code: 'unavailable', reason: 'source-unavailable', message: 'Synthetic.' } };
};
const failure = (code: string, reason: string) => () => ({ ok: false, error: { code, reason, message: 'Synthetic failure.' } });
const nav = () => ({ projectId: () => projectId, open: vi.fn(), notice: vi.fn() });
const returnTo = { label: 'Autumn notes', to: { domain: 'social', destination: `library/${FIXTURE_IDS.autumnBlend}` } } as const;

beforeEach(() => {
  resetSocialSessions(); localStorage.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); resetSocialSessions(); vi.restoreAllMocks(); Reflect.deleteProperty(window, 'hqServices'); localStorage.clear(); });

it('registers the Wiki last, as the provider of pages', () => {
  expect(REFERENCE_PROVIDERS.map(p => p.domain)).toEqual(['design', 'social', 'work', 'wiki']);
  const wiki = REFERENCE_PROVIDERS.find(p => p.domain === 'wiki')!;
  expect(wiki.kinds).toEqual(['page']);
});

it('the shell port finds Wiki pages as envelopes the shell validator accepts; unnameable hits are skipped', async () => {
  const { calls } = scriptedWiki(standard);
  const port = createReferencePort(REFERENCE_PROVIDERS, nav());
  const found = await port.find('retry', { projectId, domains: ['wiki'], limit: 30 });
  expect(found).toEqual([
    { version: 1, domain: 'wiki', projectId, kind: 'page', entityId: 'bl/policies/retry-policy.md', title: 'Retry Policy',
      returnDestination: { domain: 'wiki', destination: 'page/bl/policies/retry-policy.md' } },
    { version: 1, domain: 'wiki', projectId, kind: 'page', entityId: 'appdev/architecture/overview.md', title: 'Architecture Overview',
      returnDestination: { domain: 'wiki', destination: 'page/appdev/architecture/overview.md' } },
  ]);
  for (const envelope of found) expect(parseReference(envelope)).toEqual(envelope);
  expect(calls).toEqual([{ method: 'search', args: [{ query: 'retry', namespaces: ['bl', 'appdev'], limit: 30 }] }]);
});

it('without a domain filter the other providers fail quietly and the Wiki pages still arrive', async () => {
  scriptedWiki(standard);
  const port = createReferencePort(REFERENCE_PROVIDERS, nav());
  const found = await port.find('retry', { projectId, limit: 30 });
  expect(found.filter(e => e.domain === 'wiki').map(e => e.entityId)).toEqual(['bl/policies/retry-policy.md', 'appdev/architecture/overview.md']);
  expect(found.every(e => parseReference(e) !== null)).toBe(true);
});

it('kinds and query limits keep the Wiki quiet: no read is made for what it cannot answer', async () => {
  const { calls } = scriptedWiki(standard);
  const port = createReferencePort(REFERENCE_PROVIDERS, nav());
  expect(await port.find('retry', { projectId, domains: ['wiki'], kinds: ['item', 'draft'], limit: 30 })).toEqual([]);
  expect(await port.find('', { projectId, domains: ['wiki'], limit: 30 })).toEqual([]);
  expect(await port.find('   ', { projectId, domains: ['wiki'], limit: 30 })).toEqual([]);
  expect(await port.find('x'.repeat(257), { projectId, domains: ['wiki'], limit: 30 })).toEqual([]);
  expect(calls).toEqual([]);
  expect(await port.find('retry', { projectId, domains: ['wiki'], kinds: ['page'], limit: 1 })).toHaveLength(1);
  expect(calls.map(c => (c.args[0] as { limit: number }).limit)).toEqual([1]);
});

it('a missing or failing bridge finds nothing and resolves unavailable, never an example page', async () => {
  const port = createReferencePort(REFERENCE_PROVIDERS, nav());
  const envelope = { version: 1, domain: 'wiki', projectId, kind: 'page', entityId: 'bl/policies/retry-policy.md', title: 'Retry Policy',
    returnDestination: { domain: 'wiki', destination: 'page/bl/policies/retry-policy.md' } } as const satisfies ReferenceEnvelope;
  expect(await port.find('retry', { projectId, domains: ['wiki'], limit: 30 })).toEqual([]);
  expect(await port.resolve(envelope)).toMatchObject({ status: 'unavailable' });
  scriptedWiki(failure('unavailable', 'source-unavailable'));
  expect(await port.find('retry', { projectId, domains: ['wiki'], limit: 30 })).toEqual([]);
  expect(await port.resolve(envelope)).toMatchObject({ status: 'unavailable' });
});

it('opening a Wiki reference navigates to its page destination with the origin as Back', async () => {
  const { calls } = scriptedWiki(standard);
  const navigation = nav();
  const port = createReferencePort(REFERENCE_PROVIDERS, navigation);
  const [envelope] = await port.find('retry', { projectId, domains: ['wiki'], limit: 30 });
  expect(await port.resolve(envelope!)).toMatchObject({ status: 'available', latestTitle: 'Latest policies/retry-policy.md', latestRevision: COMMIT, destination: 'page/bl/policies/retry-policy.md' });
  port.open(envelope!, returnTo);
  await waitFor(() => expect(navigation.open).toHaveBeenCalledTimes(1));
  expect(navigation.open).toHaveBeenCalledWith(envelope, 'page/bl/policies/retry-policy.md', { label: 'Autumn notes', to: { domain: 'social', destination: `library/${FIXTURE_IDS.autumnBlend}` } });
  expect(navigation.notice).not.toHaveBeenCalled();
  expect(new Set(calls.map(c => c.method))).toEqual(new Set(['search', 'getPage']));
});

it('a snapshot taken at another commit resolves as changed and still opens; a missing page does not open', async () => {
  let reply: Reply = standard;
  scriptedWiki((method, args) => reply(method, args));
  const navigation = nav();
  const port = createReferencePort(REFERENCE_PROVIDERS, navigation);
  const [envelope] = await port.find('retry', { projectId, domains: ['wiki'], limit: 30 });
  const snapshot = { ...envelope!, sourceRevision: OTHER_COMMIT };
  expect(await port.resolve(snapshot)).toMatchObject({ status: 'changed', latestRevision: COMMIT });
  port.open(snapshot, returnTo);
  await waitFor(() => expect(navigation.open).toHaveBeenCalledTimes(1));
  navigation.open.mockClear();
  // A fresh port: resolutions are cached for a few minutes.
  reply = (method, args) => method === 'getPage' ? failure('not-found', 'not-found')() : standard(method, args);
  const fresh = createReferencePort(REFERENCE_PROVIDERS, navigation);
  fresh.open(envelope!, returnTo);
  await waitFor(() => expect(navigation.notice).toHaveBeenCalledWith({ title: 'Retry Policy', message: 'missing. Snapshot is read-only.' }));
  expect(navigation.open).not.toHaveBeenCalled();
  reply = failure('unavailable', 'source-unavailable');
  createReferencePort(REFERENCE_PROVIDERS, navigation).open(envelope!, returnTo);
  await waitFor(() => expect(navigation.notice).toHaveBeenCalledWith({ title: 'Retry Policy', message: 'unavailable. Snapshot is read-only.' }));
  expect(navigation.open).not.toHaveBeenCalled();
});

it('another project\'s Wiki reference and a malformed identity never reach the bridge or navigate', async () => {
  const { calls } = scriptedWiki(standard);
  const navigation = nav();
  const port = createReferencePort(REFERENCE_PROVIDERS, navigation);
  const [envelope] = await port.find('retry', { projectId, domains: ['wiki'], limit: 30 });
  calls.length = 0;
  port.open({ ...envelope!, projectId: 'elsewhere' }, returnTo);
  expect(navigation.notice).toHaveBeenCalledTimes(1);
  expect(await port.resolve({ ...envelope!, entityId: 'bl/../../outside.md' })).toMatchObject({ status: 'unknown' });
  expect(await port.resolve({ ...envelope!, entityId: 'nowhere/page.md' })).toMatchObject({ status: 'unknown' });
  expect(await port.resolve({ ...envelope!, kind: 'topic' })).toMatchObject({ status: 'unknown' });
  expect(navigation.open).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

// ---- the whole shell over the real host --------------------------------------------------------------------------

let root: string | undefined; let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; close = undefined; });

it('Social "Link to…" finds a real Wiki page; opening the link shows the reader with Back to the draft', async () => {
  await mkdir(resolve('.t3/wiki-mount'), { recursive: true }); root = await mkdtemp(resolve('.t3/wiki-mount/references-'));
  const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'userData'); await mkdir(join(home, 'wiki'), { recursive: true });
  await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: corpus.profiles }));
  const bridge = createWikiBridge(() => openWikiRuntime(home)); close = () => bridge.close();
  const handler = wikiIpcHandler((authorized: boolean) => authorized, bridge);
  const calls: string[] = [];
  const wiki = Object.freeze(Object.fromEntries(READS.map(method => [method, async (...args: unknown[]) => {
    calls.push(method); return structuredClone(await handler(true, method, structuredClone(args)));
  }])));
  const social = createWireStub({ features: [FEATURE_HQ_REFERENCES], clock: () => new Date() });
  const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
  const unavailable = { call: async () => ({ ok: false, kind: 'unavailable' }) } as const;
  Object.defineProperty(window, 'hqServices', { configurable: true, value: Object.freeze({
    work: unavailable, design: unavailable, social: social.transport, wiki,
    config: { status: async () => configured, set: async () => configured },
  } as unknown as HqServices) });
  localStorage.setItem(navigationKey(projectId), JSON.stringify({ domain: 'social', destinations: {
    social: `library/${FIXTURE_IDS.autumnBlend}`, work: 'board', design: 'home', wiki: 'home' } }));
  const view = render(<App />);
  await screen.findByLabelText('Body');

  fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Search references' }), { target: { value: 'quokkaharbor' } });
  const options = await screen.findAllByRole('option', { name: /Retry Policy|Architecture Overview/ });
  // The host decides the ranking; both pages, named by their logical identity, are offered.
  expect(options.map(o => o.querySelector('.hq-reference-provenance')?.textContent).sort()).toEqual([
    `wiki · page · appdev/architecture/overview.md · Project ${projectId}`,
    `wiki · page · bl/policies/retry-policy.md · Project ${projectId}`,
  ]);
  fireEvent.click(screen.getByRole('option', { name: /Retry Policy/ }));
  await waitFor(() => expect(social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links).toHaveLength(1));
  const saved = social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links?.[0];
  expect(saved).toMatchObject({ domain: 'wiki', kind: 'page', entityId: 'bl/policies/retry-policy.md', title: 'Retry Policy',
    returnDestination: { domain: 'wiki', destination: 'page/bl/policies/retry-policy.md' } });
  expect(parseReference(saved)).toEqual(saved);

  // Open is offered once the link's resolution has arrived: the Wiki provider answers "Available".
  await within(screen.getByRole('region', { name: 'Draft links' })).findByText('Available');
  fireEvent.click(screen.getByRole('button', { name: 'Open Retry Policy' }));
  await waitFor(() => expect(view.container.querySelector('.wiki-page-title')?.textContent).toBe('Retry Policy'));
  const back = screen.getByRole('button', { name: 'Back to Autumn blend tasting notes' });
  fireEvent.click(back);
  await screen.findByLabelText('Body');
  expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();

  expect(calls.every(method => READS.includes(method))).toBe(true);
  expect(calls).toEqual(expect.arrayContaining(['search', 'getPage']));
  expect(social.callsTo('submitRun')).toEqual([]);
  expect(Object.keys(wiki)).toEqual(READS);
});
