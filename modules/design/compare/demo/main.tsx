/** Local review harness only: labelled fakes, synthetic data, no network. Not shipped with HQ. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createCompareController } from '../src/controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, createFakeStorage, sampleCatalogData } from '../src/fakes.ts';
import { comparisonId, panelId, projectId } from '../src/ids.ts';
import { createComparison, liveSource, staticSource } from '../src/model.ts';
import { presetById } from '../src/presets.ts';
import { CompareWorkspace } from '../src/view/index.tsx';
import './demo.css';

const data = sampleCatalogData();
const v = (id: string) => data.versions.find((item) => item.versionId === id)!;
const phone = presetById('phone')!.viewport;
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

const controller = createCompareController(createComparison(comparisonId('demo'), projectId('sample-project'), [
  { id: panelId('a'), role: 'baseline', source: staticSource(v('home-v1').captures[0]), viewport: phone, width: 380 },
  { id: panelId('b'), role: 'candidate', source: liveSource(v('home-v2')), viewport: phone, width: 420 },
  { id: panelId('c'), source: liveSource(v('pricing-v1')), viewport: phone, width: 320 },
]), {
  catalog: createFakeCatalog(data),
  preview: createFakePreview({ pages: (id) => (id === 'pricing-v1' ? 2 : 3) }),
  captures: createFakeCaptureImages(),
  storage: createFakeStorage(),
});
(window as unknown as { compareDemo: unknown }).compareDemo = controller;

createRoot(document.getElementById('root')!).render(<StrictMode>
  <p className="demo-banner">HQD-03 compare demo — labelled fakes and synthetic captures only.</p>
  <CompareWorkspace controller={controller} />
</StrictMode>);
