import type { BlobDigest, ReferenceImportCandidate } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { createReferencesEnvironment } from '../../app/sections/references/env.ts';
import { syntheticPng } from '../../projects/fakes/index.ts';
import { appTree, pageCapture, websiteTree } from '../test/graph-fixtures.ts';

/** Public synthetic data only; each invocation owns fresh in-memory storage and preview URLs. */
export async function createCombinedFixture() {
  const ports = fakePorts();
  const urls = new Map<BlobDigest, string>();
  const dispose = () => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); };
  let sequence = 0;
  const env = await createReferencesEnvironment({
    storage: ports.storage, clock: ports.clock,
    ids: { label: 'fake:combined-reference-ids', next: (kind) => `${kind}_synthetic-${++sequence}` },
    compareSlot: () => null,
    previewUrl: (digest) => {
      const cached = urls.get(digest);
      if (cached !== undefined) return cached;
      const blob = ports.storage.blobs.get(digest);
      if (blob === undefined) return null;
      const url = URL.createObjectURL(new Blob([blob.bytes as Uint8Array<ArrayBuffer>], { type: blob.mediaType }));
      urls.set(digest, url);
      return url;
    },
  });
  const candidates: readonly ReferenceImportCandidate[] = [
    { kind: 'screenshot', title: 'Pricing', source: { kind: 'url', url: 'https://example.com/pricing' },
      capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', tags: ['pricing', 'cards'],
      rights: { status: 'permitted', basis: 'Owner-created synthetic fixture' },
      asset: { bytes: syntheticPng(201, 48, 30), mediaType: 'image/png', w: 48, h: 30 } },
    { kind: 'screenshot', title: 'Notes editor with a deliberately long title for checking wrapping and access to complete provenance',
      source: { kind: 'app', platform: 'ios', appId: 'com.example.notes',
        appName: 'Example Notes — a deliberately long synthetic application name', screen: 'editor' },
      capturedAt: '2026-02-02T09:00:00.000Z', capturedBy: 'observed', tags: ['toolbar', 'ios', 'long content'],
      asset: { bytes: syntheticPng(202, 20, 40), mediaType: 'image/png', w: 20, h: 40 } },
    { kind: 'native', title: 'Notes on device',
      source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen: 'editor' },
      capturedAt: '2026-02-03T09:00:00.000Z', capturedBy: 'observed',
      nativeEvidence: { platform: 'ios', runtime: 'device', buildRef: 'synthetic-build-42', claim: 'observed' } },
  ];
  try {
    for (const candidate of candidates) {
      const result = await env.library.importReference(candidate);
      if (result.status !== 'created') throw new Error('Synthetic reference seed was not created.');
      if (candidate === candidates[0]) await env.library.useInProject(result.id, 'proj_alpha');
    }
    for (const tree of [websiteTree(), appTree({ title: 'Example Notes — synthetic app with a long readable label' }),
      websiteTree({ pages: [{ url: 'https://example.com/pricing', title: 'Pricing',
        captures: [pageCapture('pricing-v2', { capturedAt: '2026-03-01T10:00:00.000Z' })] }] })]) {
      const result = await env.graph.importTree(tree);
      if (!result.ok) throw new Error('Synthetic graph seed was rejected.');
    }
    return { env, dispose, label: ports.storage.label };
  } catch (error) { dispose(); throw error; }
}
