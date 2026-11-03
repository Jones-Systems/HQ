import { useMemo } from 'react';
import { InlineNotice, Presence, StatusIndicator, useListMotion, useToast } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ImportsPanel, type ImportsCrossLink, type ImportsKit } from '../../../imports/src/ImportsPanel.ts';
import '../../../imports/src/imports.css';
import { importSourceId, projectId, type ImportSource } from '../../../imports/src/contract.ts';
import { designModule as referencesModule } from '../../../references/design-module.ts';
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

/** The shared motion and feedback primitives, handed to a section that cannot import `@hq/ui` itself. */
const KIT: ImportsKit = { Presence, InlineNotice, StatusIndicator, useToast, useListMotion };

/** The example store answers in a frame, so each busy state stays on screen briefly. A durable store takes its own time. */
const CONTROLLER_OPTIONS = { minBusyMs: 450 } as const;

export function ImportsView({ context, navigate }: DesignSectionProps) {
  const { deps, capabilities } = importsFor(context, syntheticSource);
  // Where References lives follows its descriptor, so a placement change needs no edit here.
  const crossLink = useMemo<ImportsCrossLink>(() => ({
    lead: 'Adding single screenshots?',
    label: 'Use References → Import screenshots',
    onOpen: () => navigate({ nav: referencesModule.nav, section: referencesModule.id }),
  }), [navigate]);
  return <SectionFrame lane="T13 imports" entry="imports/src/ImportsPanel.ts › ImportsPanel" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={['source picker returns a synthetic two-screen source', 'no save-to-disk capability', 'in-memory fake store']}>
    <ImportsPanel deps={deps} projectId={projectId(context.id)} capabilities={capabilities} options={CONTROLLER_OPTIONS} kit={KIT} crossLink={crossLink} />
  </SectionFrame>;
}
