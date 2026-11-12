// @vitest-environment happy-dom
// Wiki pages as HQ cross-module reference targets (B5-W2): the real App, the real Wiki runtime over the synthetic
// bare-repository corpus, and the Work Planner fixture that advertises hq-references-v1. Synthetic data only.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import type { HqServices, WorkServiceRoute, WorkServiceTransport } from '@hq/contracts/services';
import { createFixturePlanner, EXAMPLE_SETTINGS, HQ_REFERENCES_FEATURE, normalizeFields } from '../../../modules/work/core';
import { resetWorkSessions } from '../../../modules/work/nav';
import { resetViewMemory } from '../../../modules/work/views/env';
import { viewItems, VIEW_TODAY } from '../../../modules/work/views/fixtures';
import { FEATURE_HQ_REFERENCES, resetSocialSessions } from '../../../modules/social/core';
import { createWireStub } from '../../../modules/social/live/test/wire-stub';
import { parseDestination } from '../../../modules/wiki/contract/src/index.ts';
import { buildCorpus } from '../../../modules/wiki/app/test/corpus.ts';
import { openWikiRuntime } from '../electron/wiki-runtime.mts';
import { createWikiBridge, wikiIpcHandler } from '../electron/wiki-host';
import { App } from './App';
import { REFERENCE_PROVIDERS } from './reference-providers';
import { createReferencePort } from './references';

const projectId = 'hq-local';
const slow = { timeout: 20_000 };
const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
const WIKI_METHODS = ['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus'];
const STALE = `wiki-c1:${'0'.repeat(64)}`;
const REMOVED = `wiki-c1:${'1'.repeat(64)}`;

let root: string | undefined;
let closeWiki: (() => Promise<void>) | undefined;
beforeEach(() => {
  resetWorkSessions(); resetViewMemory(); resetSocialSessions(); localStorage.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(async () => {
  cleanup(); resetWorkSessions(); resetSocialSessions(); resetViewMemory(); vi.restoreAllMocks();
  await closeWiki?.(); if (root) await rm(root, { recursive: true, force: true });
  root = undefined; closeWiki = undefined;
  Reflect.deleteProperty(window, 'hqServices'); localStorage.clear();
});

/** The runtime opens at once and indexes in the background (#207), so tests read only after the sources are indexed. */
async function indexed(bridge: { admin(route: unknown, params: unknown): Promise<unknown> }) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await bridge.admin('status', {}) as { ok: boolean; value?: { sources: { state: string }[] } };
    if (result.ok && !result.value!.sources.some(source => source.state === 'indexing')) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Wiki indexing did not settle');
}

/** The real Wiki runtime over the committed synthetic corpus, behind the same seven-method host boundary as the app. */
async function wikiBridge() {
  await mkdir(resolve('.t3/wiki-mount'), { recursive: true });
  root = await mkdtemp(resolve('.t3/wiki-mount/references-'));
  const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'userData');
  await mkdir(join(home, 'wiki'), { recursive: true });
  await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: corpus.profiles }));
  const bridge = createWikiBridge(() => openWikiRuntime(home));
  closeWiki = () => bridge.close();
  await indexed(bridge);
  const handler = wikiIpcHandler((authorized: boolean) => authorized, bridge);
  const calls: string[] = [];
  const wiki = Object.freeze(Object.fromEntries(WIKI_METHODS.map(method => [method, async (...args: unknown[]) => {
    calls.push(method);
    return structuredClone(await handler(true, method, structuredClone(args)));
  }]))) as unknown as NonNullable<HqServices['wiki']>;
  return { wiki, calls };
}

/** One Work card on a Planner that advertises hq-references-v1, with Social's call recorder for the zero-execution checks. */
function workFixture(wiki: HqServices['wiki']) {
  const social = createWireStub({ features: [FEATURE_HQ_REFERENCES], clock: () => new Date() });
  const item = { ...viewItems(VIEW_TODAY)[0]!, title: 'Synthetic reference card', references: [] };
  const planner = createFixturePlanner({ items: [item], settings: { ...EXAMPLE_SETTINGS }, features: [HQ_REFERENCES_FEATURE] });
  const calls: { route: WorkServiceRoute; params: unknown }[] = [];
  const work: WorkServiceTransport = { async call(route, params) {
    calls.push({ route, params: structuredClone(params) });
    const state = await planner.port.snapshot();
    if (route === 'state') return { ok: true, status: 200, body: { items: state.items, settings: state.settings, state_version: state.stateVersion,
      server_time: new Date().toISOString(), api: 2, features: [HQ_REFERENCES_FEATURE], request_retention: { max: 2000, evicted_through_version: 0 } }, replayed: false };
    if (route === 'version') return { ok: true, status: 200, body: { state_version: state.stateVersion }, replayed: false };
    if (route === 'history') return { ok: true, status: 200, body: { history: [] }, replayed: false };
    if (route === 'patch' && 'patch' in params) {
      const fields = normalizeFields(params.patch, { creating: false, features: [HQ_REFERENCES_FEATURE] });
      if (!fields.ok) return { ok: true, status: 400, body: { errors: fields.errors }, replayed: false };
      const { status, ...patch } = fields.value;
      if (status !== undefined) return { ok: true, status: 400, body: { error: 'Use the move route' }, replayed: false };
      const result = await planner.port.patch(params.id, params.revision, patch, params.requestId);
      return { ok: true, status: 200, body: { item: result.item, state_version: result.stateVersion }, replayed: false };
    }
    return { ok: false, kind: 'unavailable' };
  } };
  const services = { work, social: social.transport, wiki,
    config: { status: async () => configured, set: async () => configured },
    design: { call: async () => ({ ok: false, kind: 'unavailable' }) } } as unknown as HqServices;
  Object.defineProperty(window, 'hqServices', { configurable: true, value: services });
  const link = (id: string, target: ReferenceEnvelope) => ({ id, kind: 'hq' as const, label: target.title, target });
  const noExecution = () => {
    expect(social.callsTo('submitRun')).toEqual([]);
    expect(calls.filter(c => !['state', 'version', 'history', 'patch'].includes(c.route))).toEqual([]);
  };
  return { item, planner, calls, link, noExecution };
}

const wikiEnvelope = (entityId: string, title: string, sourceRevision: string): ReferenceEnvelope => ({
  version: 1, domain: 'wiki', projectId, kind: 'page', entityId, title, sourceRevision,
  returnDestination: { domain: 'wiki', destination: `page/${entityId}` },
});

async function openCard() {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Domains' })).getByRole('button', { name: 'Work' }));
  fireEvent.click(await screen.findByRole('article', { name: 'Synthetic reference card' }));
  await screen.findByRole('textbox', { name: 'Card title' });
}

const chips = () => Object.fromEntries([...document.querySelectorAll('.hq-reference')].map(chip =>
  [chip.querySelector('.hq-reference-title')?.textContent, chip.getAttribute('data-reference-status')]));
const pageTitle = () => document.querySelector('.wiki-page-title')?.textContent;

// One journey through the real App. The App's Work module keeps its store for the life of the module, so the Work card
// is mounted by exactly one test in this file; the other tests drive the shell's ReferencePort without a Work mount.
it('Work card: Wiki links read Changed and Missing, Link to… adds a page, opening shows it and Back returns to the card', async () => {
  const w = await wikiBridge(); const f = workFixture(w.wiki);
  const stale = wikiEnvelope('bl/guides/onboarding.md', 'Onboarding Guide', STALE);
  const removed = wikiEnvelope('bl/policies/removed-policy.md', 'Removed policy', REMOVED);
  await f.planner.port.patch(f.item.id, f.item.revision, { references: [f.link('wikilink1', stale), f.link('wikilink2', removed)] }, 'fixture-seed-wiki-links');
  render(<App />); await openCard();

  // A changed page still opens; a page that no longer exists keeps its readable snapshot and cannot be opened.
  await waitFor(() => expect(chips()).toEqual({ 'Onboarding Guide': 'changed', 'Removed policy': 'missing' }), slow);
  expect(screen.getByText(/bl\/policies\/removed-policy\.md/).textContent).toContain(`Snapshot revision ${REMOVED}`);
  const gone = screen.getByRole('button', { name: 'Open Removed policy' });
  expect(gone.hasAttribute('disabled')).toBe(true);
  fireEvent.click(gone);
  expect(pageTitle()).toBeUndefined();
  expect(f.calls.filter(c => c.route === 'patch')).toEqual([]); // reading never rewrites the card

  fireEvent.change(screen.getByRole('textbox', { name: 'Capture to Inbox' }), { target: { value: 'Keep this capture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link to…' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Search references' }), { target: { value: 'quokkaharbor' } });
  const results = () => within(screen.getByRole('listbox', { name: 'Reference results' }));
  await waitFor(() => expect(results().getAllByRole('option')).toHaveLength(2), slow);
  const retry = results().getByRole('option', { name: /Retry Policy/ });
  expect(retry.textContent).toContain('wiki · page · bl/policies/retry-policy.md');
  expect(results().getByRole('option', { name: /Architecture Overview/ }).textContent).toContain('wiki · page · appdev/architecture/overview.md');
  fireEvent.click(retry);

  // The link is part of the Work card and was saved by the Planner; the Wiki stored nothing.
  await waitFor(async () => expect((await f.planner.port.snapshot()).items[0]!.references).toHaveLength(3), slow);
  const stored = (await f.planner.port.snapshot()).items[0]!.references.at(-1)!;
  const target = stored.kind === 'hq' ? stored.target : undefined;
  expect(parseReference(target)).toEqual(target);
  expect(target).toMatchObject({ domain: 'wiki', kind: 'page', entityId: 'bl/policies/retry-policy.md', title: 'Retry Policy', projectId,
    returnDestination: { domain: 'wiki', destination: 'page/bl/policies/retry-policy.md' } });
  expect(target?.sourceRevision).toMatch(/^wiki-c1:[0-9a-f]{64}$/);
  expect(f.calls.filter(c => c.route === 'patch')).toHaveLength(1);

  const open = await screen.findByRole('button', { name: 'Open Retry Policy' });
  await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false), slow);
  expect(chips()).toEqual({ 'Onboarding Guide': 'changed', 'Removed policy': 'missing', 'Retry Policy': 'available' });
  // The Wiki module is not mounted yet, so these reads were the references' (plus the rail's own status check).
  expect(w.calls).toEqual(expect.arrayContaining(['search', 'getPage']));

  fireEvent.click(open);
  await waitFor(() => expect(pageTitle()).toBe('Retry Policy'), slow);
  expect(within(screen.getByRole('navigation', { name: 'Domains' })).getByRole('button', { name: 'Wiki' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Back to Synthetic reference card' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Capture to Inbox' })).toHaveProperty('value', 'Keep this capture'));
  expect(screen.getByRole('textbox', { name: 'Card title' })).toHaveProperty('value', 'Synthetic reference card');
  expect(screen.getByRole('button', { name: /^Work$/ }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();
  await waitFor(() => expect(chips()).toEqual({ 'Onboarding Guide': 'changed', 'Removed policy': 'missing', 'Retry Policy': 'available' }));

  // A Changed link opens the latest page and returns the same way.
  fireEvent.click(screen.getByRole('button', { name: 'Open Onboarding Guide' }));
  await waitFor(() => expect(pageTitle()).toBe('Onboarding Guide'), slow);
  fireEvent.click(screen.getByRole('button', { name: 'Back to Synthetic reference card' }));
  await screen.findByRole('textbox', { name: 'Card title' });

  // Linking, opening and returning changed only the card (one save); nothing was executed and the Wiki has no write to call.
  expect(f.calls.filter(c => c.route === 'patch')).toHaveLength(1);
  expect(w.calls.every(method => WIKI_METHODS.includes(method))).toBe(true);
  f.noExecution();
}, 90_000);

it('the shell ReferencePort finds, resolves and opens Wiki pages for any caller, such as a palette lane', async () => {
  const w = await wikiBridge();
  Object.defineProperty(window, 'hqServices', { configurable: true, value: Object.freeze({ wiki: w.wiki }) });
  const open = vi.fn(); const notice = vi.fn();
  const port = createReferencePort(REFERENCE_PROVIDERS, { projectId: () => projectId, open, notice });
  const wikiOnly = { projectId, domains: ['wiki'] as const, limit: 10 };

  const found = await port.find('quokkaharbor', wikiOnly);
  expect(found.map(e => e.entityId).sort()).toEqual(['appdev/architecture/overview.md', 'bl/policies/retry-policy.md']);
  expect(await port.find('quokkaharbor', { ...wikiOnly, kinds: ['item'] })).toEqual([]);
  expect(await port.find('', wikiOnly)).toEqual([]);
  expect(await port.find('zzqxjvk', wikiOnly)).toEqual([]);

  const retry = found.find(e => e.entityId === 'bl/policies/retry-policy.md')!;
  expect(await port.resolve(retry)).toMatchObject({ status: 'available', latestTitle: 'Retry Policy', latestRevision: retry.sourceRevision, destination: 'page/bl/policies/retry-policy.md' });
  expect(await port.resolve({ ...retry, sourceRevision: STALE })).toMatchObject({ status: 'changed', latestRevision: retry.sourceRevision });

  const back = { label: 'Palette', to: { domain: 'design', destination: 'home' } } as const;
  port.open(retry, back);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  const [opened, destination, context] = open.mock.calls[0]!;
  expect(opened).toEqual(retry);
  expect(context).toEqual(back);
  expect(parseDestination(destination)).toEqual({ ok: true, value: { kind: 'page', key: { namespace: 'bl', path: 'policies/retry-policy.md' } } });

  const missing = { ...retry, entityId: 'bl/policies/removed-policy.md', title: 'Removed policy' };
  expect(await port.resolve(missing)).toMatchObject({ status: 'missing' });
  port.open(missing, back);
  await waitFor(() => expect(notice).toHaveBeenCalledWith({ title: 'Removed policy', message: 'missing. Snapshot is read-only.' }));
  expect(open).toHaveBeenCalledTimes(1);

  // A non-page kind and a malformed id never reach the Wiki, and nothing but search and page reads happened.
  expect(await port.resolve({ ...retry, kind: 'topic' })).toMatchObject({ status: 'unknown' });
  expect(await port.resolve({ ...retry, entityId: 'other/x.md' })).toMatchObject({ status: 'unknown' });
  expect([...new Set(w.calls)].sort()).toEqual(['getPage', 'search']);
}, 60_000);

it('without a Wiki bridge nothing is found and a Wiki reference reads unavailable', async () => {
  const port = createReferencePort(REFERENCE_PROVIDERS, { projectId: () => projectId, open: vi.fn(), notice: vi.fn() });
  const id = wikiEnvelope('bl/policies/retry-policy.md', 'Retry Policy', STALE);
  expect(await port.find('quokkaharbor', { projectId, domains: ['wiki'], limit: 10 })).toEqual([]);
  expect(await port.resolve(id)).toMatchObject({ status: 'unavailable' });
});
