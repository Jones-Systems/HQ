import type { DesignSectionProps, JsonValue } from '../../../ui/contract.ts';
import { artboardId, canvasId, canvasItemId, projectId, providerId } from '../../../canvas/src/contract.ts';
import type { CanvasSession } from '../../../canvas/src/controller.ts';
import { createProviderRegistry } from '../../../canvas/src/providers.ts';
import { arrangementKey, encodeArrangement } from '../../../canvas/src/codec.ts';
import { addArtboard, addPlacement, emptyArrangement } from '../../../canvas/src/arrangement.ts';
import { createFakeProvider, createFakeStorage, createSequentialIds } from '../../../canvas/src/fakes.ts';
import { CanvasWorkspace } from '../../../canvas/src/view/index.ts';
import '../../../canvas/src/view/canvas.css';
import type { ProjectContext } from '@hq/contracts';
import { PreviewFrame } from '../../PreviewFrame.tsx';

interface CanvasSeed {
  readonly project: ReturnType<typeof projectId>;
  readonly canvas: ReturnType<typeof canvasId>;
  readonly storage: ReturnType<typeof createFakeStorage>;
  readonly registry: ReturnType<typeof createProviderRegistry>;
  readonly ids: ReturnType<typeof createSequentialIds>;
}

const seeds = new Map<string, CanvasSeed>();

/** One fake provider, arrangement and store per fake project; synchronous, kept for the page's lifetime. */
function seedFor(context: ProjectContext): CanvasSeed {
  const existing = seeds.get(context.id);
  if (existing) return existing;
  const project = projectId(context.id);
  const canvas = canvasId(`${context.id}-canvas`);
  const views = createFakeProvider('preview-views', 'Synthetic views', [
    { entityId: 'home', revision: 'v1', title: 'Home v1', kind: 'view-version', provenance: 'static-capture', size: { width: 320, height: 200 } },
    { entityId: 'home', revision: 'v2', title: 'Home v2', kind: 'view-version', provenance: 'live-preview', size: { width: 320, height: 200 } },
    { entityId: 'pricing', revision: 'v7', title: 'Pricing v7', kind: 'view-version', provenance: 'web-approximation', size: { width: 240, height: 160 } },
  ], project);
  const registry = createProviderRegistry();
  registry.register(views);
  const ref = (entityId: string, revision: string) => ({ providerId: providerId('preview-views'), entityId, revision });
  let arrangement = emptyArrangement(canvas, project);
  arrangement = addArtboard(arrangement, { id: artboardId('board-desktop'), name: 'Desktop', frame: { x: 40, y: 40, width: 800, height: 500 } });
  arrangement = addPlacement(arrangement, { id: canvasItemId('item-a'), ref: ref('home', 'v1'), frame: { x: 80, y: 80, width: 320, height: 200 } });
  arrangement = addPlacement(arrangement, { id: canvasItemId('item-b'), ref: ref('home', 'v2'), frame: { x: 900, y: 80, width: 320, height: 200 } });
  arrangement = addPlacement(arrangement, { id: canvasItemId('item-c'), ref: ref('pricing', 'v7'), frame: { x: 900, y: 360, width: 240, height: 160 } });
  arrangement = addPlacement(arrangement, {
    id: canvasItemId('item-missing'), ref: { providerId: providerId('unregistered'), entityId: 'gone', revision: 'r1' },
    frame: { x: 1300, y: 80, width: 200, height: 120 },
  });
  const seed: CanvasSeed = {
    project, canvas, registry,
    storage: createFakeStorage({ [arrangementKey(canvas)]: encodeArrangement(arrangement) }),
    ids: createSequentialIds(`preview-${context.id}`),
  };
  seeds.set(context.id, seed);
  return seed;
}

function readSession(value: JsonValue | undefined): CanvasSession | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'camera' in value && 'selection' in value
    ? value as unknown as CanvasSession : undefined;
}

export function CanvasPreview({ context, state }: DesignSectionProps) {
  const seed = seedFor(context);
  const session = readSession(state.read());
  return <PreviewFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" fill
    notes={['fake provider and in-memory arrangement store', 'camera/selection kept in Design session state']}>
    <CanvasWorkspace projectId={seed.project} canvasId={seed.canvas} storage={seed.storage} registry={seed.registry} ids={seed.ids}
      {...(session ? { session } : {})}
      onSessionChange={(next) => { state.write(next as unknown as JsonValue); }} />
  </PreviewFrame>;
}
