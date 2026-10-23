/** Synthetic public fixtures for the reference graph; no real captures, sites or owner data. */
import type {
  AppTreeCandidate, GraphCaptureCandidate, TreeImportOutcome, WebsiteTreeCandidate,
} from '../src/graph-contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { ReferenceGraph } from '../src/graph-service.ts';
import { bytes } from './fixtures.ts';

export type Issues = readonly { readonly field: string; readonly code: string }[];

/** The issues of a rejected outcome; fails the test if the outcome was accepted. */
export function issuesOf(outcome: TreeImportOutcome): Issues {
  if (outcome.ok) throw new Error(`expected a rejection, got ${JSON.stringify(outcome)}`);
  return outcome.issues;
}

export const PERMITTED = { vocabulary: 'hq.design.references/v1', value: 'permitted', basis: 'synthetic fixture: owner-created mockup' } as const;

export function pageCapture(label: string, overrides: Partial<GraphCaptureCandidate> = {}): GraphCaptureCandidate {
  return {
    kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed',
    asset: { bytes: bytes(label), mediaType: 'image/png', w: 1440, h: 900 },
    ...overrides,
  };
}

export function websiteTree(overrides: Partial<WebsiteTreeCandidate> = {}): WebsiteTreeCandidate {
  return {
    kind: 'website', origin: 'https://example.com', title: 'Example Co',
    pages: [
      {
        url: 'https://example.com/', title: 'Home',
        captures: [pageCapture('home', {
          anchors: [
            { key: 'hero', kind: 'section', label: 'Hero', rect: { x: 0, y: 0, w: 1, h: 0.4 } },
            { key: 'hero-cta', kind: 'element', label: 'Primary call to action', parentKey: 'hero', rect: { x: 0.4, y: 0.3, w: 0.2, h: 0.05 } },
            { key: 'footer', kind: 'section', label: 'Footer', rect: { x: 0, y: 0.9, w: 1, h: 0.1 } },
          ],
        })],
      },
      { url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing')] },
      {
        url: 'https://example.com/about', title: 'About',
        captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'agent-reported', captureKey: 'metadata-only' }],
      },
    ],
    ...overrides,
  };
}

export function appTree(overrides: Partial<AppTreeCandidate> = {}): AppTreeCandidate {
  const shot = (label: string): GraphCaptureCandidate => pageCapture(label, { asset: { bytes: bytes(label), mediaType: 'image/png', w: 1179, h: 2556 } });
  return {
    kind: 'app', platform: 'ios', appId: 'com.example.notes', title: 'Example Notes',
    screens: [
      { key: 'list', title: 'Note list', captures: [shot('notes-list')] },
      { key: 'editor', title: 'Editor', captures: [shot('notes-editor')] },
      { key: 'settings', title: 'Settings', captures: [shot('notes-settings')] },
    ],
    flows: [{ key: 'new-note', title: 'Create a note', steps: ['list', 'editor'] }],
    ...overrides,
  };
}

export async function openGraph() {
  const ports = fakePorts();
  const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
  return { ports, graph };
}

export function writes(ports: ReturnType<typeof fakePorts>): number {
  return ports.storage.operations.filter((operation) => operation.op === 'writeDocument').length;
}
