/** Synthetic fixtures only; no owner data. */
import type { FlowDocument } from '../src/contract.ts';
import { parseFlow } from '../src/model.ts';

const viewport = { w: 390, h: 844, dpr: 3 };
const rect = (x: number, y: number, width = 160, height = 48) => ({ x, y, width, height });
const go = (target: Record<string, unknown>, animation = 'push') => ({ target, animation, durationMs: 250 });

/** A synthetic iOS checkout prototype with one broken screen target and one undeclared route. */
export function checkoutRaw(): Record<string, unknown> {
  return {
    schema: 'hq.design.flow/v1', id: 'flow-checkout', projectId: 'project-synthetic', title: 'Checkout', platform: 'ios', start: 'cart',
    routes: [
      { route: '/cart', states: ['default', 'empty'] },
      { route: '/checkout', states: ['default', 'error'] },
      { route: '/done', states: ['default'] },
    ],
    screens: [
      { id: 'cart', title: 'Cart', versionId: 'v-cart-3', route: '/cart', state: 'default', viewport, captureDigest: 'sha256:aa' },
      { id: 'cart-empty', title: 'Empty cart', versionId: 'v-cart-empty-1', route: '/cart', state: 'empty', viewport },
      { id: 'checkout', title: 'Checkout', versionId: 'v-checkout-2', route: '/checkout', state: 'default', viewport },
      { id: 'checkout-error', title: 'Card declined', versionId: 'v-checkout-error-1', route: '/checkout', state: 'error', viewport },
      { id: 'done', title: 'Order placed', versionId: 'v-done-1', route: '/done', state: 'default', viewport },
    ],
    hotspots: [
      { id: 'h-checkout', screenId: 'cart', label: 'Checkout', rect: rect(115, 760), transition: go({ kind: 'route', route: '/checkout' }) },
      { id: 'h-clear', screenId: 'cart', label: 'Clear cart', rect: rect(16, 96, 120, 32), transition: go({ kind: 'route', route: '/cart', state: 'empty' }, 'fade') },
      { id: 'h-help', screenId: 'cart', label: 'Help', rect: rect(330, 40, 44, 44), transition: go({ kind: 'external', url: 'https://example.com/help' }, 'instant') },
      { id: 'h-pay', screenId: 'checkout', label: 'Pay', rect: rect(115, 760), transition: go({ kind: 'screen', screenId: 'done' }) },
      { id: 'h-decline', screenId: 'checkout', label: 'Simulate decline', rect: rect(115, 680), transition: go({ kind: 'route', route: '/checkout', state: 'error' }, 'fade') },
      { id: 'h-back', screenId: 'checkout', label: 'Back', rect: rect(8, 40, 64, 44), transition: go({ kind: 'back' }, 'pop') },
      { id: 'h-retry', screenId: 'checkout-error', label: 'Retry', rect: rect(115, 760), transition: go({ kind: 'screen', screenId: 'checkout' }) },
      { id: 'h-receipt', screenId: 'done', label: 'View receipt', rect: rect(115, 760), transition: go({ kind: 'screen', screenId: 'receipt' }) },
      { id: 'h-promo', screenId: 'done', label: 'Promo', rect: rect(115, 680), transition: go({ kind: 'route', route: '/promo' }) },
    ],
  };
}

export function parsed(raw: unknown): FlowDocument {
  const result = parseFlow(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.flow;
}

export const checkout = (): FlowDocument => parsed(checkoutRaw());

/** Deterministic PRNG so generated flows are reproducible from their seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random structurally valid flow with ok, back, exit, broken, ambiguous and orphan edges. */
export function randomFlow(seed: number): FlowDocument {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const routeCount = 1 + Math.floor(random() * 4);
  const routes = Array.from({ length: routeCount }, (_, r) => ({ route: `/r${r}`, states: Array.from({ length: 1 + Math.floor(random() * 3) }, (_, s) => `s${s}`) }));
  const screens = Array.from({ length: 1 + Math.floor(random() * 7) }, (_, n) => {
    const route = pick(routes);
    return { id: `screen-${n}`, title: `Screen ${n}`, versionId: `v-${n}`, route: route.route, state: pick(route.states), viewport };
  });
  const hotspots = Array.from({ length: Math.floor(random() * 14) }, (_, n) => {
    const roll = random();
    const target = roll < 0.4 ? { kind: 'screen', screenId: random() < 0.85 ? pick(screens).id : `ghost-${n}` }
      : roll < 0.7 ? (random() < 0.8 ? { kind: 'route', route: pick(routes).route, ...(random() < 0.5 ? { state: pick(['s0', 's1', 's2', 's9']) } : {}) } : { kind: 'route', route: '/nowhere' })
      : roll < 0.85 ? { kind: 'back' } : { kind: 'external', url: `https://example.com/${n}` };
    const screenId = random() < 0.95 ? pick(screens).id : `orphan-${n}`;
    return { id: `hotspot-${n}`, screenId, label: `Link ${n}`, rect: rect(Math.floor(random() * 300), Math.floor(random() * 800), 40, 40), transition: go(target) };
  });
  return parsed({
    schema: 'hq.design.flow/v1', id: `flow-${seed}`, projectId: 'project-synthetic', title: `Generated ${seed}`,
    platform: pick(['web', 'ios', 'android', 'desktop']), start: random() < 0.9 ? screens[0]!.id : 'missing-start', routes, screens, hotspots,
  });
}
