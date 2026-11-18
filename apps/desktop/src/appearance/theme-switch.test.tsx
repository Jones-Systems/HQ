import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { THEME_TRANSITION_ATTRIBUTE, switchAppearance } from './theme-switch';

type ViewDocument = { startViewTransition?: unknown };
const doc = document as unknown as ViewDocument;
const root = () => document.documentElement;

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  Reflect.deleteProperty(doc, 'startViewTransition');
  root().removeAttribute('data-hq-motion');
  root().removeAttribute(THEME_TRANSITION_ATTRIBUTE);
});

it('changes instantly when the browser has no view transitions', () => {
  const change = vi.fn();
  switchAppearance(change);
  expect(change).toHaveBeenCalledOnce();
  expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
});

it('runs the change inside a view transition and clears the marker when it finishes', async () => {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const start = vi.fn((update: () => void) => { update(); return { finished }; });
  doc.startViewTransition = start;
  const change = vi.fn();
  switchAppearance(change);
  expect(start).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledOnce();
  expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(true);
  finish();
  await finished;
  await Promise.resolve();
  expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
});

it('skips the transition when HQ motion is set to reduce', () => {
  const start = vi.fn();
  doc.startViewTransition = start;
  root().setAttribute('data-hq-motion', 'reduce');
  const change = vi.fn();
  switchAppearance(change);
  expect(start).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledOnce();
  expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
});

it('skips the transition when the device asks for reduced motion', () => {
  const start = vi.fn();
  doc.startViewTransition = start;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  const change = vi.fn();
  switchAppearance(change);
  expect(start).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledOnce();
});

it('falls back to an instant change if starting the transition throws', () => {
  doc.startViewTransition = vi.fn(() => { throw new Error('not allowed now'); });
  const change = vi.fn();
  switchAppearance(change);
  expect(change).toHaveBeenCalledOnce();
  expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
});
