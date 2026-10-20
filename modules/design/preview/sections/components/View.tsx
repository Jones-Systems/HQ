import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { ProjectId } from '../../../components/src/contract.ts';
import {
  SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM,
} from '../../../components/src/fixtures.ts';
import { webCryptoDigest } from '../../../components/src/model/jcs.ts';
import { ComponentLibrary } from '../../../components/src/workspace/library.ts';
import { createMemoryStorage, performanceClock } from '../../../components/src/workspace/fakes.ts';
import { ComponentsWorkspace } from '../../../components/ui/index.ts';
import '../../../components/ui/components.css';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

const load = perProject(async (project) => {
  const library = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
  const button = await library.saveSource(SYNTHETIC_BUTTON);
  await library.saveVariants(button, { componentId: button.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  const study = await library.saveMotionStudy(SYNTHETIC_MOTION);
  await library.setProjectMembership({
    projectId: project.id as ProjectId,
    components: [{ componentId: card.componentId, revision: 1 }], studies: [{ studyId: study.id, revision: 1 }],
  });
  return library;
});

/**
 * Component execution is HELD. Sandbox frames are srcdoc documents and inherit
 * this page's shell-mirroring CSP (script-src 'self'), so neither the bootstrap
 * nor component scripts run, as in the shell today. Pending the sandbox direction.
 */
export function ComponentsPreview({ context, appearance }: DesignSectionProps) {
  const library = use(load(context));
  return <PreviewFrame lane="T10 components" entry="components/ui › ComponentsWorkspace"
    notes={['component scripts HELD by the inherited shell CSP (sandbox direction pending)', 'in-memory fake storage']}>
    <ComponentsWorkspace library={library} clock={performanceClock} appearance={appearance} />
  </PreviewFrame>;
}
