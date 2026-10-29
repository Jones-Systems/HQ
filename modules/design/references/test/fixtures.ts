/** Synthetic fixtures only; no real captures or owner data. */
import type { ReferenceImportCandidate } from '../src/contract.ts';

export function bytes(label: string): Uint8Array {
  return new TextEncoder().encode(`synthetic-asset:${label}`);
}

export function screenshot(overrides: Partial<ReferenceImportCandidate> = {}): ReferenceImportCandidate {
  return {
    kind: 'screenshot',
    source: { kind: 'url', url: 'https://example.com/pricing' },
    capturedAt: '2026-02-01T10:00:00.000Z',
    capturedBy: 'observed',
    title: 'Example pricing page',
    tags: ['Pricing', 'cards'],
    asset: { bytes: bytes('pricing'), mediaType: 'image/png', w: 1440, h: 900 },
    ...overrides,
  };
}

export function appScreenshot(overrides: Partial<ReferenceImportCandidate> = {}): ReferenceImportCandidate {
  return {
    kind: 'screenshot',
    source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen: 'editor' },
    capturedAt: '2026-02-02T09:00:00.000Z',
    capturedBy: 'observed',
    title: 'Notes editor toolbar',
    tags: ['toolbar', 'ios'],
    asset: { bytes: bytes('notes-editor'), mediaType: 'image/png', w: 1179, h: 2556 },
    ...overrides,
  };
}

export function nativeReference(overrides: Partial<ReferenceImportCandidate> = {}): ReferenceImportCandidate {
  return {
    kind: 'native',
    source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen: 'editor' },
    capturedAt: '2026-02-03T09:00:00.000Z',
    capturedBy: 'observed',
    title: 'Notes editor on device',
    nativeEvidence: { platform: 'ios', runtime: 'device', buildRef: 'synthetic-build-42', claim: 'observed' },
    ...overrides,
  };
}
