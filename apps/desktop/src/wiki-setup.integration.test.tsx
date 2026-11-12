// @vitest-environment happy-dom
// The installed first-run state: the real App over the real Wiki runtime with no source configured. The Wiki shows a
// set-up card instead of error panels, and Open Settings lands on Settings › Data sources › Local Wiki. Synthetic only.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HqServices } from '@hq/contracts/services';
import { openWikiRuntime } from '../electron/wiki-runtime.mts';
import { createWikiBridge, wikiIpcHandler } from '../electron/wiki-host';
import { App } from './App';

const METHODS = ['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus'];
let root: string | undefined; let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  cleanup(); await close?.(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; close = undefined;
  delete (window as { hqServices?: HqServices }).hqServices; window.localStorage.clear();
});

it('a Wiki with no source shows the set-up card, and Open Settings opens Local Wiki settings', async () => {
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  await mkdir(resolve('.t3/wiki-mount'), { recursive: true }); root = await mkdtemp(resolve('.t3/wiki-mount/setup-'));
  const bridge = createWikiBridge(() => openWikiRuntime(join(root!, 'userData'))); close = () => bridge.close();
  const handler = wikiIpcHandler((authorized: boolean) => authorized, bridge);
  const calls: string[] = [];
  const wiki = Object.freeze(Object.fromEntries(METHODS.map(method => [method, async (...args: unknown[]) => {
    calls.push(method); return structuredClone(await handler(true, method, structuredClone(args)));
  }])));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: Object.freeze({ wiki }) });

  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
  const card = await screen.findByRole('region', { name: 'Set up the Wiki' }, { timeout: 10_000 });
  expect(card.textContent).toContain('Settings › Data sources › Local Wiki');
  expect(view.container.querySelector('.wiki-error')).toBeNull();
  for (const alert of screen.queryAllByRole('alert')) expect(alert.textContent).toBe('');
  expect(screen.queryByRole('heading', { name: 'Local Wiki' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Open Settings' }));
  expect(await screen.findByRole('heading', { name: 'Local Wiki' })).toBeTruthy();
  expect([...new Set(calls)].sort()).toEqual(['indexStatus', 'listSources']);
}, 20_000);
