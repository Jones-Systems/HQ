import type { FlowDocument, FlowPlatform, Hotspot, HotspotId, Point, ScreenId, WebApproximation } from './contract.ts';
import { deriveEdges, indexFlow, type BrokenReason, type FlowEdge, type FlowIndex } from './edges.ts';

const PLATFORM_NAMES: Readonly<Record<FlowPlatform, string>> = { web: 'a web', ios: 'an iOS', android: 'an Android', desktop: 'a desktop' };

/** The only evidence label a player step can carry. */
export function webApproximation(platform: FlowPlatform): WebApproximation {
  const label = platform === 'web'
    ? 'Web approximation — prototype playback, not native evidence'
    : `Web approximation of ${PLATFORM_NAMES[platform]} design — not native evidence`;
  return Object.freeze({ kind: 'web-approximation', nativeEvidence: false, declaredPlatform: platform, label });
}

export type StepOutcome =
  | { readonly kind: 'entered'; readonly to: ScreenId }
  | { readonly kind: 'navigated'; readonly to: ScreenId }
  | { readonly kind: 'back'; readonly to: ScreenId }
  | { readonly kind: 'back-unavailable' }
  | { readonly kind: 'exit'; readonly url: string }
  | { readonly kind: 'broken'; readonly reason: BrokenReason; readonly detail: string };

export interface PlayerStep {
  readonly index: number;
  readonly from: ScreenId | null;
  /** The activated hotspot, or null for player chrome (start, Back button). */
  readonly edgeId: HotspotId | null;
  readonly outcome: StepOutcome;
  readonly evidence: WebApproximation;
}

export type PlayerNotice =
  | { readonly kind: 'missing-start'; readonly screenId: ScreenId }
  | { readonly kind: 'miss'; readonly point: Point }
  | { readonly kind: 'not-on-screen'; readonly hotspotId: HotspotId };

export interface PlayerState {
  readonly current: ScreenId | null;
  readonly history: readonly ScreenId[];
  readonly steps: readonly PlayerStep[];
  readonly notice: PlayerNotice | null;
}

export type PlayerAction =
  | { readonly type: 'start'; readonly screenId?: ScreenId }
  | { readonly type: 'activate'; readonly hotspotId: HotspotId }
  | { readonly type: 'click'; readonly point: Point }
  | { readonly type: 'back' };

export interface Player {
  readonly flow: FlowDocument;
  readonly index: FlowIndex;
  readonly edges: readonly FlowEdge[];
  readonly evidence: WebApproximation;
  initial(): PlayerState;
  reduce(state: PlayerState, action: PlayerAction): PlayerState;
  hotspotsOn(screenId: ScreenId): readonly Hotspot[];
  hitTest(screenId: ScreenId, point: Point): Hotspot | null;
  edgeFor(hotspotId: HotspotId): FlowEdge | undefined;
}

const EMPTY: PlayerState = Object.freeze({ current: null, history: [], steps: [], notice: null });

/**
 * Pure prototype player. It never opens external URLs or touches the network; an exit is
 * recorded as a step. Broken and unavailable transitions are recorded and leave the
 * current screen unchanged.
 */
export function createPlayer(flow: FlowDocument): Player {
  const index = indexFlow(flow);
  const edges = deriveEdges(flow, index);
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const evidence = webApproximation(flow.platform);
  const hotspotsByScreen = new Map<ScreenId, Hotspot[]>();
  for (const hotspot of flow.hotspots) hotspotsByScreen.set(hotspot.screenId, [...(hotspotsByScreen.get(hotspot.screenId) ?? []), hotspot]);

  const record = (state: PlayerState, from: ScreenId | null, edgeId: HotspotId | null, outcome: StepOutcome,
    current: ScreenId | null, history: readonly ScreenId[]): PlayerState => ({
    current, history, notice: null,
    steps: [...state.steps, { index: state.steps.length, from, edgeId, outcome, evidence }],
  });

  const start = (state: PlayerState, screenId: ScreenId): PlayerState => index.screensById.has(screenId)
    ? record(state, null, null, { kind: 'entered', to: screenId }, screenId, [])
    : { ...state, current: null, history: [], notice: { kind: 'missing-start', screenId } };

  const back = (state: PlayerState, from: ScreenId, edgeId: HotspotId | null): PlayerState => {
    const previous = state.history.at(-1);
    return previous === undefined
      ? record(state, from, edgeId, { kind: 'back-unavailable' }, from, state.history)
      : record(state, from, edgeId, { kind: 'back', to: previous }, previous, state.history.slice(0, -1));
  };

  const activate = (state: PlayerState, hotspotId: HotspotId): PlayerState => {
    const edge = edgesById.get(hotspotId);
    const from = state.current;
    if (from === null || !edge || edge.from !== from) return { ...state, notice: { kind: 'not-on-screen', hotspotId } };
    const resolution = edge.resolution;
    switch (resolution.status) {
      case 'ok': return record(state, from, edge.id, { kind: 'navigated', to: resolution.to }, resolution.to, [...state.history, from]);
      case 'back': return back(state, from, edge.id);
      case 'exit': return record(state, from, edge.id, { kind: 'exit', url: resolution.url }, from, state.history);
      case 'broken': return record(state, from, edge.id, { kind: 'broken', reason: resolution.reason, detail: resolution.detail }, from, state.history);
    }
  };

  const hitTest = (screenId: ScreenId, point: Point): Hotspot | null => {
    const candidates = hotspotsByScreen.get(screenId) ?? [];
    // Later declarations are on top, matching the overlap warning in validateFlow.
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const { x, y, width, height } = candidates[i]!.rect;
      if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) return candidates[i]!;
    }
    return null;
  };

  return {
    flow, index, edges, evidence,
    initial: () => start(EMPTY, flow.start),
    hotspotsOn: (screenId) => hotspotsByScreen.get(screenId) ?? [],
    hitTest,
    edgeFor: (hotspotId) => edgesById.get(hotspotId),
    reduce(state, action) {
      switch (action.type) {
        case 'start': return start(state, action.screenId ?? flow.start);
        case 'activate': return activate(state, action.hotspotId);
        case 'click': {
          if (state.current === null) return state;
          const hotspot = hitTest(state.current, action.point);
          return hotspot ? activate(state, hotspot.id) : { ...state, notice: { kind: 'miss', point: action.point } };
        }
        case 'back': return state.current === null ? state : back(state, state.current, null);
      }
    },
  };
}
