import { useMemo, useState } from 'react';
import { InlineNotice, Presence, StatusIndicator, useListMotion, useToast } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ImportsPanel, type ImportsCrossLink, type ImportsKit } from '../../../imports/src/ImportsPanel.ts';
import '../../../imports/src/imports.css';
import { importSourceId, projectId, type ImportSource } from '../../../imports/src/contract.ts';
import { designModule as referencesModule } from '../../../references/design-module.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { withImportRights } from '../capabilities.ts';
import { selectedImportRights, type RightsDraft } from '../sources/import-rights.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';
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
  const workspace = useDesignWorkspace();
  const { deps, capabilities: baseCapabilities } = workspace.importsFor(context, syntheticSource);
  const [rights, setRights] = useState<RightsDraft>({ basis: '', holder: '', license: '', attribution: '' });
  const selectedRights = useMemo(() => selectedImportRights(rights), [rights]);
  // The retained native dialog still claims owned files only. The desktop owner must update it before releasing other bases.
  const dialogCompatible = !workspace.bridged || selectedRights?.basis === 'owned';
  const capabilities = useMemo(() => ({
    ...baseCapabilities,
    pickSource: baseCapabilities.pickSource && selectedRights && dialogCompatible
      ? withImportRights(baseCapabilities.pickSource, selectedRights) : undefined,
  }), [baseCapabilities, selectedRights, dialogCompatible]);
  const changeRights = (patch: Partial<RightsDraft>) => setRights((current) => ({ ...current, ...patch }));
  // Where References lives follows its descriptor, so a placement change needs no edit here.
  const crossLink = useMemo<ImportsCrossLink>(() => ({
    lead: 'Adding single screenshots?',
    label: 'Use References → Import screenshots',
    onOpen: () => navigate({ nav: referencesModule.nav, section: referencesModule.id }),
  }), [navigate]);
  return <SectionFrame lane="T13 imports" entry="imports/src/ImportsPanel.ts › ImportsPanel" tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={workspace.bridged ? ['Files are chosen with the system file picker.', 'Backup and export are unavailable in this build.'] : ['source picker returns a synthetic two-screen source', 'no save-to-disk capability', 'in-memory fake store']}>
    <ImportsPanel deps={deps} projectId={projectId(context.id)} capabilities={capabilities} options={CONTROLLER_OPTIONS} kit={KIT} crossLink={crossLink} renderRights={(locked) => (
      <fieldset disabled={locked} className="hqd-imports__rights" aria-describedby="import-rights-help">
      <legend>Rights for the selected files</legend>
      <p id="import-rights-help">Choose a basis and name the rights holder before choosing files. Changing this statement clears the pending import plan.</p>
      <label>Rights basis<select value={rights.basis} onChange={(event) => changeRights({ basis: event.target.value as RightsDraft['basis'] })}>
        <option value="">Choose a rights basis</option>
        <option value="owned">Owned</option>
        <option value="licensed" disabled={workspace.bridged}>Licensed</option>
        <option value="permission" disabled={workspace.bridged}>Permission</option>
        <option value="public-domain" disabled={workspace.bridged}>Public domain</option>
      </select></label>
      {workspace.bridged && <p role="status">Licensed, permission and public-domain selection are not available with this file picker yet.</p>}
      <label>Rights holder<input maxLength={300} value={rights.holder} onChange={(event) => changeRights({ holder: event.target.value })} /></label>
      {rights.basis === 'licensed' && <label>License (required)<input maxLength={300} value={rights.license} onChange={(event) => changeRights({ license: event.target.value })} /></label>}
      <label>Attribution (optional)<input maxLength={300} value={rights.attribution} onChange={(event) => changeRights({ attribution: event.target.value })} /></label>
      {!selectedRights && <p role="status">Choose a rights basis, enter a rights holder and include a license for licensed files to enable file selection.</p>}
    </fieldset>
    )} />

  </SectionFrame>;
}
