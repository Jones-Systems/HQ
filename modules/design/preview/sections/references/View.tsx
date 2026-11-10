import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { BlobDigest, ReferenceImportCandidate } from '../../../references/src/contract.ts';
import { fakePorts } from '../../../references/src/fakes.ts';
import { ReferenceLibrary } from '../../../references/src/service.ts';
import { ReferenceLibraryPanel } from '../../../references/ui/index.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

/** Preview-local synthetic candidates. URLs and app ids are data only; nothing is fetched. */
const CANDIDATES: readonly ReferenceImportCandidate[] = [
  {
    kind: 'screenshot', source: { kind: 'url', url: 'https://example.com/pricing' }, capturedAt: '2026-02-01T10:00:00.000Z',
    capturedBy: 'observed', title: 'Example pricing page', tags: ['pricing', 'cards'],
    rights: { status: 'permitted', basis: 'Synthetic CC0' },
    asset: { bytes: syntheticPng(201, 48, 30), mediaType: 'image/png', w: 48, h: 30 },
  },
  {
    kind: 'screenshot', source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen: 'editor' },
    capturedAt: '2026-02-02T09:00:00.000Z', capturedBy: 'observed', title: 'Notes editor toolbar', tags: ['toolbar', 'ios'],
    asset: { bytes: syntheticPng(202, 20, 40), mediaType: 'image/png', w: 20, h: 40 },
  },
  {
    kind: 'native', source: { kind: 'app', platform: 'ios', appId: 'com.example.notes', appName: 'Example Notes', screen: 'editor' },
    capturedAt: '2026-02-03T09:00:00.000Z', capturedBy: 'observed', title: 'Notes editor on device',
    nativeEvidence: { platform: 'ios', runtime: 'device', buildRef: 'synthetic-build-42', claim: 'observed' },
  },
];

const load = perProject(async (project) => {
  const ports = fakePorts();
  const library = await ReferenceLibrary.open(ports);
  const ids = [];
  for (const candidate of CANDIDATES) {
    const outcome = await library.importReference(candidate);
    if ('id' in outcome) ids.push(outcome.id);
  }
  if (ids[0] !== undefined) await library.useInProject(ids[0], project.id);
  const urls = new Map<BlobDigest, string>();
  const previewUrl = (digest: BlobDigest): string | null => {
    const cached = urls.get(digest);
    if (cached !== undefined) return cached;
    const blob = ports.storage.blobs.get(digest);
    if (blob === undefined) return null;
    const url = URL.createObjectURL(new Blob([blob.bytes as Uint8Array<ArrayBuffer>], { type: blob.mediaType }));
    urls.set(digest, url);
    return url;
  };
  return { library, previewUrl };
});

export function ReferencesPreview({ context }: DesignSectionProps) {
  const { library, previewUrl } = use(load(context));
  return <PreviewFrame lane="T8 references" entry="references/ui › ReferenceLibraryPanel" notes={['in-memory fake storage']}>
    <ReferenceLibraryPanel library={library} currentProject={{ id: context.id, name: context.name }} previewUrl={previewUrl} />
  </PreviewFrame>;
}
