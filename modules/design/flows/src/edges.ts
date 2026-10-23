import type { Animation, FlowDocument, HotspotId, Screen, ScreenId, TransitionTarget } from './contract.ts';

export type BrokenReason = 'missing-screen' | 'undeclared-route' | 'undeclared-state' | 'no-screen-for-state' | 'ambiguous-route';

export type EdgeResolution =
  | { readonly status: 'ok'; readonly to: ScreenId }
  | { readonly status: 'back' }
  | { readonly status: 'exit'; readonly url: string }
  | { readonly status: 'broken'; readonly reason: BrokenReason; readonly detail: string };

/** One edge per hotspot. The flow map and the prototype player both consume this derivation. */
export interface FlowEdge {
  readonly id: HotspotId;
  readonly hotspotId: HotspotId;
  readonly from: ScreenId;
  readonly fromExists: boolean;
  readonly label: string;
  readonly animation: Animation;
  readonly durationMs: number;
  readonly resolution: EdgeResolution;
}

export interface FlowIndex {
  readonly screensById: ReadonlyMap<ScreenId, Screen>;
  readonly states: ReadonlyMap<string, readonly string[]>;
  readonly screensByRouteState: ReadonlyMap<string, readonly Screen[]>;
}

export const routeStateKey =(route: string, state: string): string => `${route}\u0000${state}`;

export function indexFlow(flow: FlowDocument): FlowIndex {
  const screensByRouteState = new Map<string, Screen[]>();
  for (const screen of flow.screens) {
    const key = routeStateKey(screen.route, screen.state);
    screensByRouteState.set(key, [...(screensByRouteState.get(key) ?? []), screen]);
  }
  return {
    screensById: new Map(flow.screens.map((screen) => [screen.id, screen])),
    states: new Map(flow.routes.map((route) => [route.route, route.states])),
    screensByRouteState,
  };
}

export function resolveTarget(index: FlowIndex, target: TransitionTarget): EdgeResolution {
  switch (target.kind) {
    case 'back': return { status: 'back' };
    case 'external': return { status: 'exit', url: target.url };
    case 'screen':
      return index.screensById.has(target.screenId)
        ? { status: 'ok', to: target.screenId }
        : { status: 'broken', reason: 'missing-screen', detail: `screen ${target.screenId} does not exist` };
    case 'route': {
      const states = index.states.get(target.route);
      if (!states) return { status: 'broken', reason: 'undeclared-route', detail: `route ${target.route} is not declared` };
      const state = target.state ?? states[0]!;
      if (!states.includes(state)) return { status: 'broken', reason: 'undeclared-state', detail: `state ${state} is not declared for ${target.route}` };
      const screens = index.screensByRouteState.get(routeStateKey(target.route, state)) ?? [];
      if (screens.length === 0) return { status: 'broken', reason: 'no-screen-for-state', detail: `no screen renders ${target.route} (${state})` };
      if (screens.length > 1) return { status: 'broken', reason: 'ambiguous-route', detail: `${target.route} (${state}) matches screens ${screens.map((screen) => screen.id).join(', ')}` };
      return { status: 'ok', to: screens[0]!.id };
    }
  }
}

export function deriveEdges(flow: FlowDocument, index: FlowIndex = indexFlow(flow)): readonly FlowEdge[] {
  return flow.hotspots.map((hotspot) => ({
    id: hotspot.id,
    hotspotId: hotspot.id,
    from: hotspot.screenId,
    fromExists: index.screensById.has(hotspot.screenId),
    label: hotspot.label,
    animation: hotspot.transition.animation,
    durationMs: hotspot.transition.durationMs,
    resolution: resolveTarget(index, hotspot.transition.target),
  }));
}

/** Human description of where an edge goes, shared by map and player text. */
export function describeResolution(resolution: EdgeResolution, index: FlowIndex): string {
  switch (resolution.status) {
    case 'ok': return index.screensById.get(resolution.to)?.title ?? resolution.to;
    case 'back': return 'Previous screen';
    case 'exit': return `Leaves prototype: ${resolution.url}`;
    case 'broken': return `Broken: ${resolution.detail}`;
  }
}

/** Breadth-first depth from the start screen through resolved edges; absent ids are unreachable. */
export function screenDepths(flow: FlowDocument, index: FlowIndex, edges: readonly FlowEdge[]): ReadonlyMap<ScreenId, number> {
  const depth = new Map<ScreenId, number>();
  if (!index.screensById.has(flow.start)) return depth;
  depth.set(flow.start, 0);
  const queue: ScreenId[] = [flow.start];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const edge of edges) {
      if (edge.from === from && edge.resolution.status === 'ok' && !depth.has(edge.resolution.to)) {
        depth.set(edge.resolution.to, depth.get(from)! + 1);
        queue.push(edge.resolution.to);
      }
    }
  }
  return depth;
}
