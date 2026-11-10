import type { ComponentPlacement, ComponentRenderRequest, ComponentRun, ComponentRunnerPort } from '../runner.ts';
import { jcsDigest } from '../model/jcs.ts';

/** Synthetic lifecycle evidence only; never executes markup or produces native captures. */
export function createFakeComponentRunner(): ComponentRunnerPort & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  const runs = new Map<string, { request: ComponentRenderRequest; placement: ComponentPlacement }>();
  let next = 0;
  const get = (run: ComponentRun) => {
    const entry = runs.get(run.id);
    if (!entry) throw new Error('Unknown or closed fake component run.');
    return entry;
  };
  return {
    label: 'FAKE component runner · synthetic only', evidence: 'synthetic', calls,
    async render(request) {
      const run: ComponentRun = { id: `fake-${++next}`, evidence: 'synthetic', label: 'FAKE component run' };
      runs.set(run.id, { request: structuredClone(request), placement: { x: 0, y: 0, width: 1, height: 1, visible: false } });
      calls.push('render');
      return { status: 'ok', value: run };
    },
    async place(run, placement) { get(run).placement = { ...placement }; calls.push('place'); },
    async motion(run, _request) { get(run); calls.push('motion'); },
    async capture(run) {
      const { request, placement } = get(run);
      calls.push('capture');
      const viewport = { width: placement.width, height: placement.height, deviceScaleFactor: 1 };
      return { status: 'ok', value: { ...request, viewport, captureDigest: await jcsDigest({ request, viewport, synthetic: true }), evidence: 'synthetic' } };
    },
    async close(run) { runs.delete(run.id); calls.push('close'); },
  };
}
