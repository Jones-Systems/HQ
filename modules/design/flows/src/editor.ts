import type { FlowDocument, Hotspot, HotspotId, RouteDeclaration, Screen, ScreenId, Transition } from './contract.ts';
import { deriveEdges } from './edges.ts';
import { parseFlow, type ParseResult } from './model.ts';

/**
 * Pure authoring operations. Each returns a new structurally validated document and never
 * mutates its input. Referential breakage is allowed and stays reported by `validateFlow`.
 */
const revise = (flow: FlowDocument, changes: Partial<FlowDocument>): ParseResult => parseFlow(structuredClone({ ...flow, ...changes }));

export const declareRoute = (flow: FlowDocument, declaration: RouteDeclaration): ParseResult =>
  revise(flow, { routes: [...flow.routes.filter((route) => route.route !== declaration.route), declaration] });

export const addScreen = (flow: FlowDocument, screen: Screen): ParseResult => revise(flow, { screens: [...flow.screens, screen] });

export const addHotspot = (flow: FlowDocument, hotspot: Hotspot): ParseResult => revise(flow, { hotspots: [...flow.hotspots, hotspot] });

export const retargetHotspot = (flow: FlowDocument, id: HotspotId, transition: Transition): ParseResult =>
  revise(flow, { hotspots: flow.hotspots.map((hotspot) => hotspot.id === id ? { ...hotspot, transition } : hotspot) });

export const setStart = (flow: FlowDocument, start: ScreenId): ParseResult => revise(flow, { start });

export interface ScreenRemoval {
  readonly result: ParseResult;
  /** Hotspots that belonged to the removed screen and left with it. */
  readonly removedHotspots: readonly HotspotId[];
  /** Hotspots elsewhere that targeted it; they are kept and now report a broken target. */
  readonly brokenIncoming: readonly HotspotId[];
}

export function removeScreen(flow: FlowDocument, id: ScreenId): ScreenRemoval {
  const incoming = deriveEdges(flow).filter((edge) => edge.from !== id && edge.resolution.status === 'ok' && edge.resolution.to === id);
  return {
    result: revise(flow, { screens: flow.screens.filter((screen) => screen.id !== id), hotspots: flow.hotspots.filter((hotspot) => hotspot.screenId !== id) }),
    removedHotspots: flow.hotspots.filter((hotspot) => hotspot.screenId === id).map((hotspot) => hotspot.id),
    brokenIncoming: incoming.map((edge) => edge.hotspotId),
  };
}
