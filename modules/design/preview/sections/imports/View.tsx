import type { ProjectContext } from '@hq/contracts';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { importSourceId, projectId, type ImportSource } from '../../../imports/src/contract.ts';
import { DEFAULT_TEST_NAMESPACES, FakeStoragePort } from '../../../imports/src/fake-storage.ts';
import type { ImportsCapabilities } from '../../../imports/src/controller.ts';
import type { ImportDeps } from '../../../imports/src/importer.ts';
import { ImportsPanel } from '../../../imports/src/ImportsPanel.ts';
import '../../../imports/src/imports.css';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';

const OWNED = { basis: 'owned', holder: 'Synthetic Owner' } as const;

/** Preview-local synthetic source standing in for a file picker. Bytes are generated; nothing is read from disk. */
function syntheticSource(): ImportSource {
  return {
    kind: 'hq.files', version: 1, sourceId: importSourceId('src-preview-synthetic'),
    items: [
      { key: 'screens/home.png', title: 'Home', rights: OWNED, provenance: { originalName: 'home.png' }, payload: { kind: 'png', bytes: syntheticPng(301, 39, 84) } },
      { key: 'screens/settings.png', title: 'Settings', rights: OWNED, provenance: { originalName: 'settings.png' }, payload: { kind: 'png', bytes: syntheticPng(302, 39, 84) } },
    ],
  };
}

interface ImportsSeed {
  readonly deps: ImportDeps;
  readonly capabilities: ImportsCapabilities;
}

const seeds = new Map<string, ImportsSeed>();

/** Stable deps per fake project: the panel memoises its controller on them. Saving to disk stays unavailable. */
function seedFor(context: ProjectContext): ImportsSeed {
  const existing = seeds.get(context.id);
  if (existing) return existing;
  const seed: ImportsSeed = {
    deps: { storage: new FakeStoragePort(DEFAULT_TEST_NAMESPACES), clock: { now: () => new Date().toISOString() } },
    capabilities: { pickSource: async () => syntheticSource() },
  };
  seeds.set(context.id, seed);
  return seed;
}

export function ImportsPreview({ context }: DesignSectionProps) {
  const { deps, capabilities } = seedFor(context);
  return <PreviewFrame lane="T13 imports" entry="imports/src/ImportsPanel.ts › ImportsPanel"
    notes={['source picker returns a synthetic two-screen source', 'no save-to-disk capability', 'in-memory fake store']}>
    <ImportsPanel deps={deps} projectId={projectId(context.id)} capabilities={capabilities} />
  </PreviewFrame>;
}
