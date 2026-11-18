/** Synthetic fixtures for the Design end-to-end matrix. Nothing here is owner data. */
import { createHash } from 'node:crypto';
import type { PreviewRef } from '../../../../modules/design/projects/src/contract.ts';

/** A real 1x1 PNG, so size and digest checks run against genuine image bytes. */
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
export const digestOf = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
export const PNG_REF: PreviewRef = { digest: digestOf(PNG), mediaType: 'image/png', bytes: PNG.length };

/** The shell's project context for tests that do not create a project through the registry. */
export const SHELL_PROJECT = { id: 'project-synthetic', name: 'Synthetic project' } as const;

const viewport = { w: 390, h: 844, dpr: 3 };
const rect = (x: number, y: number) => ({ x, y, width: 160, height: 48 });
/** Two screens and one hotspot: the smallest flow the Flows parser accepts. */
export function flowRaw(projectId: string = SHELL_PROJECT.id, id = 'flow-checkout', title = 'Checkout'): Record<string, unknown> {
  return {
    schema: 'hq.design.flow/v1', id, projectId, title, platform: 'ios', start: 'cart',
    routes: [{ route: '/cart', states: ['default'] }, { route: '/done', states: ['default'] }],
    screens: [
      { id: 'cart', title: 'Cart', versionId: 'v-cart-1', route: '/cart', state: 'default', viewport },
      { id: 'done', title: 'Order placed', versionId: 'v-done-1', route: '/done', state: 'default', viewport },
    ],
    hotspots: [{ id: 'h-pay', screenId: 'cart', label: 'Pay', rect: rect(115, 760),
      transition: { target: { kind: 'screen', screenId: 'done' }, animation: 'push', durationMs: 250 } }],
  };
}
