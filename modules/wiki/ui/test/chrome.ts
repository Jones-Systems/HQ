// Selectors and input helpers for the Wiki chrome (sidebar, top bar, search field, history popover) plus a fake clock for
// the debounced paths. Tests across owners use these so a chrome change is made in one place.

import { mock } from 'node:test';
import { act } from 'react';
import type { WikiToastPort } from '../src/context.ts';
import { dom } from './dom.ts';
import { all, one, textOf } from './render.ts';

export const sidebar = (container: ParentNode): HTMLElement => one(container, 'nav.wiki-sidebar');
export const backButton = (container: ParentNode): HTMLButtonElement => one(container, '.wiki-nav button[aria-label="Back"]') as HTMLButtonElement;
export const forwardButton = (container: ParentNode): HTMLButtonElement => one(container, '.wiki-nav button[aria-label="Forward"]') as HTMLButtonElement;
export const historyButton = (container: ParentNode): HTMLButtonElement => one(container, 'button[aria-label="History"]') as HTMLButtonElement;
export const browseButton = (container: ParentNode): HTMLButtonElement => one(container, 'button[aria-label="Browse"]') as HTMLButtonElement;
export const homeButton = (container: ParentNode): HTMLButtonElement => one(container, 'nav.wiki-sidebar button[data-side="home"]') as HTMLButtonElement;
export const topicsButton = (container: ParentNode, namespace: string): HTMLButtonElement => one(container, `nav.wiki-sidebar button[data-namespace="${namespace}"]`) as HTMLButtonElement;
export const recentButtons = (container: ParentNode): HTMLButtonElement[] => all(container, 'nav.wiki-sidebar button[data-side="recent"]') as HTMLButtonElement[];
/** The top bar's search field (the combobox). */
export const searchInput = (container: ParentNode): HTMLInputElement => one(container, 'header input[name="q"]') as HTMLInputElement;
export const searchForm = (container: ParentNode): HTMLElement => one(container, 'header form[role="search"]');
/** The results page's own query field. */
export const resultsInput = (container: ParentNode): HTMLInputElement => one(container, 'input[name="results-query"]') as HTMLInputElement;
/** A repository filter chip on the results page: a namespace, or `all`. */
export const filterChip = (container: ParentNode, repo: string): HTMLButtonElement => one(container, `.wiki-repo-chips button[data-repo="${repo}"]`) as HTMLButtonElement;
export const options = (container: ParentNode): HTMLElement[] => all(container, '[role="listbox"] [role="option"]');
export const historyItems = (container: ParentNode): HTMLButtonElement[] => all(container, '.wiki-history-list button') as HTMLButtonElement[];
export const crumbs = (container: ParentNode): string[] => all(container, '.wiki-crumb').map((item) => textOf(item));

/** The label of whatever the content column shows (the first child of `main`). */
export const shown = (container: ParentNode): string => one(container, 'main').firstElementChild?.getAttribute('aria-label') ?? '';

/** A click that settles without timers, so it also works while `fakeClock` is on. */
export async function tap(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
  });
  await flush();
}

/** Labels of the history popover's entries, newest first. Opens the popover and closes it again. */
export async function historyLabels(container: ParentNode): Promise<string[]> {
  await tap(historyButton(container));
  const labels = historyItems(container).map((item) => textOf(one(item, '.wiki-history-label')));
  await tap(historyButton(container));
  if (container.querySelector('.wiki-history') !== null) throw new Error('The history popover did not close');
  return labels;
}

interface KeyInit {
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/** Dispatches a keydown on an element (it bubbles to the window like a real key press) and lets React commit. */
export async function press(target: EventTarget, key: string, init: KeyInit = {}): Promise<boolean> {
  let allowed = true;
  await act(async () => {
    const event = new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    allowed = target.dispatchEvent(event as unknown as Event);
  });
  return allowed;
}

/** Lets pending promise callbacks and React commits run without touching timers (safe while timers are faked). */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

export interface Clock {
  /** Moves the fake clock forward, running every timer that falls due, then lets the resulting work settle. */
  advance(ms: number): Promise<void>;
  restore(): void;
}

/** Fakes `setTimeout` only: React's scheduler and promises keep running, so `flush` still works. */
export function fakeClock(): Clock {
  mock.timers.enable({ apis: ['setTimeout'] });
  return {
    advance: async (ms) => {
      await act(async () => {
        mock.timers.tick(ms);
      });
      await flush();
    },
    restore: () => mock.timers.reset(),
  };
}

export interface ToastRecord {
  readonly kind: 'info' | 'success' | 'warning' | 'error' | 'dismiss';
  readonly title: string;
  readonly options: { readonly id?: string; readonly description?: string; readonly action?: { readonly label: string } } | undefined;
}

/** A fake host toast port that records every call. */
export function recordingToast(): { toast: WikiToastPort; records: ToastRecord[] } {
  const records: ToastRecord[] = [];
  const make = (kind: ToastRecord['kind']) => (title?: string, options?: ToastRecord['options']): string => {
    records.push({ kind, title: title ?? '', options });
    return 'toast-id';
  };
  return { toast: { info: make('info'), success: make('success'), warning: make('warning'), error: make('error'), dismiss: make('dismiss') }, records };
}
