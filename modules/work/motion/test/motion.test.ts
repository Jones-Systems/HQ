// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flash, flyTo, settleGhost, tiltFor } from '../motion';

function stubReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-hq-motion');
});

describe('tiltFor', () => {
  it('leans with horizontal velocity and never past four degrees', () => {
    expect(tiltFor(0)).toBe(0);
    expect(tiltFor(0.5)).toBe(3);
    expect(tiltFor(5)).toBe(4);
    expect(tiltFor(-5)).toBe(-4);
    expect(tiltFor(Number.NaN)).toBe(0);
  });
});

describe('flyTo', () => {
  it('only flashes the target, with no flight token, when motion is reduced', () => {
    stubReducedMotion(true);
    const target = document.createElement('div');
    const animate = vi.fn();
    Object.assign(target, { animate });
    document.body.append(target);
    expect(flyTo(new DOMRect(0, 0, 10, 10), target, 'Captured')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('.wk-fly-token')).toBeNull();
    expect(target.classList.contains('hq-flash')).toBe(true);
  });

  it('honours the shell override as well as the OS setting', () => {
    stubReducedMotion(false);
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    const target = document.createElement('div');
    Object.assign(target, { animate: vi.fn() });
    document.body.append(target);
    expect(flyTo(new DOMRect(0, 0, 10, 10), target, 'Captured')).toBeNull();
    expect(document.querySelector('.wk-fly-token')).toBeNull();
  });
});

describe('settleGhost', () => {
  it('finishes at once under reduced motion, so a drop never waits on decoration', () => {
    stubReducedMotion(true);
    const ghost = document.createElement('div');
    const done = vi.fn();
    settleGhost(ghost, new DOMRect(40, 40, 100, 20), done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('flash', () => {
  it('restarts the shared flash class on the element', () => {
    const el = document.createElement('div');
    el.classList.add('hq-flash');
    flash(el);
    expect(el.classList.contains('hq-flash')).toBe(true);
    flash(null);
  });
});
