import { createRoot } from 'react-dom/client';
import { artboardId, canvasId, canvasItemId, projectId, providerId } from '../src/contract.ts';
import { createProviderRegistry } from '../src/providers.ts';
import { arrangementKey, encodeArrangement } from '../src/codec.ts';
import { addArtboard, addPlacement, emptyArrangement } from '../src/arrangement.ts';
import { FAKE_LABEL, createFakeProvider, createFakeStorage, createSequentialIds } from '../src/fakes.ts';
import { CanvasWorkspace } from '../src/view/index.ts';
import '../src/view/canvas.css';

/** Review harness only: synthetic project, fake provider and in-memory storage. */
const PROJECT = projectId('harness-project');
const CANVAS = canvasId('harness-canvas');
const views = createFakeProvider('harness-views', 'Synthetic views', [
  { entityId: 'home', revision: 'v1', title: 'Home v1', kind: 'view-version', provenance: 'static-capture', size: { width: 320, height: 200 } },
  { entityId: 'home', revision: 'v2', title: 'Home v2', kind: 'view-version', provenance: 'live-preview', size: { width: 320, height: 200 } },
  { entityId: 'pricing', revision: 'v7', title: 'Pricing v7', kind: 'view-version', provenance: 'web-approximation', size: { width: 240, height: 160 } },
]);
const registry = createProviderRegistry();
registry.register(views);

let seed = emptyArrangement(CANVAS, PROJECT);
seed = addArtboard(seed, { id: artboardId('board-desktop'), name: 'Desktop', frame: { x: 40, y: 40, width: 800, height: 500 } });
seed = addPlacement(seed, { id: canvasItemId('item-a'), ref: { providerId: providerId('harness-views'), entityId: 'home', revision: 'v1' }, frame: { x: 80, y: 80, width: 320, height: 200 } });
seed = addPlacement(seed, { id: canvasItemId('item-b'), ref: { providerId: providerId('harness-views'), entityId: 'home', revision: 'v2' }, frame: { x: 900, y: 80, width: 320, height: 200 } });
seed = addPlacement(seed, { id: canvasItemId('item-c'), ref: { providerId: providerId('harness-views'), entityId: 'pricing', revision: 'v7' }, frame: { x: 900, y: 360, width: 240, height: 160 } });
seed = addPlacement(seed, { id: canvasItemId('item-missing'), ref: { providerId: providerId('unregistered'), entityId: 'gone', revision: 'r1' }, frame: { x: 1300, y: 80, width: 200, height: 120 } });

const storage = createFakeStorage({ [arrangementKey(CANVAS)]: encodeArrangement(seed) });
const harness = { storage, views, registry, label: FAKE_LABEL };
(window as unknown as { __canvasHarness: typeof harness }).__canvasHarness = harness;

createRoot(document.getElementById('root')!).render(<div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
  <p style={{ margin: 0, padding: '4px 10px', fontSize: 12, background: '#fff4d6', color: '#5c4400' }}>{FAKE_LABEL}: synthetic canvas harness for review. Nothing here is a real project, provider or store.</p>
  <CanvasWorkspace projectId={PROJECT} canvasId={CANVAS} storage={storage} registry={registry} ids={createSequentialIds('harness')} />
</div>);
