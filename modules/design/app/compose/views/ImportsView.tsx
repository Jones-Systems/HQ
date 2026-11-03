import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ImportsPanel } from '../../../imports/src/ImportsPanel.ts';
import '../../../imports/src/imports.css';
import { importSourceId, projectId, type ImportSource } from '../../../imports/src/contract.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { importsFor } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

const SYNTHETIC_RIGHTS = { basis: 'owned', holder: 'Synthetic Owner' } as const;

/** Stand-in for a file picker. Bytes are generated; nothing is read from disk. */
function syntheticSource(): ImportSource {
  return {
    kind: 'hq.files', version: 1, sourceId: importSourceId('src-compose-synthetic'),
    items: [
      { key: 'screens/home.png', title: 'Home', rights: SYNTHETIC_RIGHTS, provenance: { originalName: 'home.png' }, payload: { kind: 'png', bytes: syntheticPng(301, 39, 84) } },
      { key: 'screens/settings.png', title: 'Settings', rights: SYNTHETIC_RIGHTS, provenance: { originalName: 'settings.png' }, payload: { kind: 'png', bytes: syntheticPng(302, 39, 84) } },
    ],
  };
}

export function ImportsView({ context }: DesignSectionProps) {
  const { deps, capabilities } = importsFor(context, syntheticSource);
  return <SectionFrame lane="T13 imports" entry="imports/src/ImportsPanel.ts › ImportsPanel" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={['source picker returns a synthetic two-screen source', 'no save-to-disk capability', 'in-memory fake store']}>
    <ImportsPanel deps={deps} projectId={projectId(context.id)} capabilities={capabilities} />
  </SectionFrame>;
}
