import type { ProjectContext } from '@hq/contracts';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { createCompareController, type CompareController } from '../../../compare/src/controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, createFakeStorage, sampleCatalogData } from '../../../compare/src/fakes.ts';
import { comparisonId, panelId, projectId } from '../../../compare/src/ids.ts';
import { createComparison, liveSource, staticSource } from '../../../compare/src/model.ts';
import { presetById } from '../../../compare/src/presets.ts';
import { CompareWorkspace } from '../../../compare/src/view/index.tsx';
import { PreviewFrame } from '../../PreviewFrame.tsx';

const controllers = new Map<string, CompareController>();

/** One controller per fake project, created synchronously and kept so panel widths and links survive remounts. */
function controllerFor(context: ProjectContext): CompareController {
  const existing = controllers.get(context.id);
  if (existing) return existing;
  const data = sampleCatalogData();
  const version = (id: string) => {
    const found = data.versions.find((item) => item.versionId === id);
    if (!found) throw new Error(`synthetic compare catalog lacks ${id}`);
    return found;
  };
  const phone = presetById('phone')!.viewport;
  const controller = createCompareController(createComparison(comparisonId(`${context.id}-compare`), projectId(context.id), [
    { id: panelId('a'), role: 'baseline', source: staticSource(version('home-v1').captures[0]!), viewport: phone, width: 380 },
    { id: panelId('b'), role: 'candidate', source: liveSource(version('home-v2')), viewport: phone, width: 420 },
    { id: panelId('c'), source: liveSource(version('pricing-v1')), viewport: phone, width: 320 },
  ]), {
    catalog: createFakeCatalog(data),
    preview: createFakePreview({ pages: (id) => (id === 'pricing-v1' ? 2 : 3) }),
    captures: createFakeCaptureImages(),
    storage: createFakeStorage(),
  });
  controllers.set(context.id, controller);
  return controller;
}

export function ComparePreview({ context }: DesignSectionProps) {
  return <PreviewFrame lane="T4 compare" entry="compare/src/view › CompareWorkspace"
    notes={['synthetic captures and labelled fake previews (no host surface)']}>
    <CompareWorkspace controller={controllerFor(context)} />
  </PreviewFrame>;
}
