import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildCorpus } from '../../../modules/wiki/app/test/corpus.ts';
import { openWikiRuntime } from '../electron/wiki-runtime.mts';
import { createWikiBridge, wikiIpcHandler } from '../electron/wiki-host';
import { App } from './App';
import type { HqServices } from '@hq/contracts/services';

let root: string | undefined; let close: (() => Promise<void>) | undefined;
afterEach(async () => { cleanup(); await close?.(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; close = undefined; delete (window as { hqServices?: HqServices }).hqServices; window.localStorage.clear(); });
function setup() { window.localStorage.clear(); window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }); }
it('real shell reads search, pages, backlinks and topics through the seven-method host boundary', async () => {
  setup(); await mkdir(resolve('.t3/wiki-mount'), { recursive: true }); root = await mkdtemp(resolve('.t3/wiki-mount/shell-'));
  const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'userData'); await mkdir(join(home, 'wiki'), { recursive: true });
  await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: corpus.profiles }));
  const bridge = createWikiBridge(() => openWikiRuntime(home)); close = () => bridge.close();
  const handler = wikiIpcHandler((authorized: boolean) => authorized, bridge);
  const methods = ['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus'];
  const calls: string[] = [];
  const wiki = Object.freeze(Object.fromEntries(methods.map(method => [method, async (...args: unknown[]) => { calls.push(method); return structuredClone(await handler(true, method, structuredClone(args))); }])));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: Object.freeze({ wiki }) });
  const view = render(<App />);
  expect(within(screen.getByRole('navigation', { name: 'Domains' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Design', 'Social', 'Work', 'Wiki']);
  fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
  await waitFor(() => expect(view.container.textContent).toContain(corpus.repos.bl.commit.slice(0, 12)));
  fireEvent.change(view.container.querySelector('input[name="q"]')!, { target: { value: 'quokkaharbor' } });
  fireEvent.submit(view.container.querySelector('form[role="search"]')!);
  await waitFor(() => expect(view.container.querySelectorAll('.wiki-hit')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: /Retry Policy/ }));
  await waitFor(() => expect(view.container.querySelector('.wiki-page-title')?.textContent).toBe('Retry Policy'));
  await waitFor(() => expect(view.container.querySelector('.wiki-backlinks')?.textContent).toContain('Onboarding Guide'));
  fireEvent.click(within(view.container.querySelector('.wiki-backlinks')! as HTMLElement).getByRole('button', { name: /Onboarding Guide/ }));
  await waitFor(() => expect(view.container.querySelector('.wiki-page-title')?.textContent).toBe('Onboarding Guide'));
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  fireEvent.click(await screen.findByRole('button', { name: /App Development topics/i }));
  await waitFor(() => expect(view.container.querySelector('.wiki-topics')?.textContent).toContain('architecture'));
  expect(calls).toEqual(expect.arrayContaining(['listSources', 'search', 'getPage', 'getBacklinks', 'listTopics']));
  expect(view.container.textContent).not.toContain(root); expect(Object.keys(wiki)).toEqual(methods);
});
it('missing Wiki bridge is truthfully unavailable in the real shell', async () => {
  setup(); render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
  expect((await screen.findAllByText(/Source unavailable/i)).length).toBeGreaterThan(0);
});
