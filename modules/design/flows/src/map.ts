import type { FlowDocument, ScreenId } from './contract.ts';
import { deriveEdges, indexFlow, screenDepths, type FlowEdge, type FlowIndex } from './edges.ts';

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 96;
const COLUMN_GAP = 96;
const ROW_GAP = 40;
const MARGIN = 24;
const STUB = 56;

export interface MapNode {
  readonly screenId: ScreenId;
  readonly title: string;
  readonly route: string;
  readonly state: string;
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly reachable: boolean;
  readonly isStart: boolean;
}

export interface Segment { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }

/** A map edge is the shared `FlowEdge` plus drawing geometry; orphan edges have no segment. */
export interface MapEdge extends FlowEdge { readonly segment: Segment | null }

export interface FlowMap {
  readonly index: FlowIndex;
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  readonly width: number;
  readonly height: number;
}

/**
 * Deterministic layered layout: columns are breadth-first depth from the start screen in
 * declaration order; unreachable screens share one trailing column. Browser-mode geometry
 * only; this does not prove rendered layout.
 */
export function layoutFlowMap(flow: FlowDocument): FlowMap {
  const index = indexFlow(flow);
  const edges = deriveEdges(flow, index);
  const depth = screenDepths(flow, index, edges);
  const trailing = depth.size === 0 ? 0 : Math.max(...depth.values()) + 1;
  const rows = new Map<number, number>();
  const nodes = flow.screens.map((screen): MapNode => {
    const column = depth.get(screen.id) ?? trailing;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      screenId: screen.id, title: screen.title, route: screen.route, state: screen.state, column, row,
      x: MARGIN + column * (NODE_WIDTH + COLUMN_GAP), y: MARGIN + row * (NODE_HEIGHT + ROW_GAP),
      reachable: depth.has(screen.id), isStart: screen.id === flow.start,
    };
  });
  const byId = new Map(nodes.map((node) => [node.screenId, node]));
  const stubs = new Map<ScreenId, number>();
  const mapEdges = edges.map((edge): MapEdge => {
    const source = byId.get(edge.from);
    if (!source) return { ...edge, segment: null };
    const x1 = source.x + NODE_WIDTH;
    const y1 = source.y + NODE_HEIGHT / 2;
    const target = edge.resolution.status === 'ok' ? byId.get(edge.resolution.to) : undefined;
    if (target && target.column > source.column) return { ...edge, segment: { x1, y1, x2: target.x, y2: target.y + NODE_HEIGHT / 2 } };
    // Backward and same-column edges leave from the left so they do not cross the source.
    if (target) return { ...edge, segment: { x1: source.x, y1: source.y + NODE_HEIGHT - 14, x2: target.x + (target === source ? 0 : NODE_WIDTH), y2: target.y + NODE_HEIGHT - 14 } };
    // Back, exit and broken edges end in a labelled stub so they stay visible on the map.
    const stub = stubs.get(edge.from) ?? 0;
    stubs.set(edge.from, stub + 1);
    const y = source.y + 14 + stub * 18;
    return { ...edge, segment: { x1, y1: y, x2: x1 + STUB, y2: y } };
  });
  const columns = Math.max(0, ...nodes.map((node) => node.column + 1));
  const tallest = Math.max(0, ...rows.values());
  return {
    index, nodes, edges: mapEdges,
    width: MARGIN * 2 + columns * NODE_WIDTH + Math.max(0, columns - 1) * COLUMN_GAP + STUB,
    height: MARGIN * 2 + tallest * NODE_HEIGHT + Math.max(0, tallest - 1) * ROW_GAP,
  };
}
