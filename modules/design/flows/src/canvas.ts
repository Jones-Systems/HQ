import type { CanvasItemDescriptor, CanvasItemProvider, FlowDocument, FlowId } from './contract.ts';
import { jcsDigest } from './jcs.ts';
import { layoutFlowMap } from './map.ts';
import type { FlowRepository } from './repository.ts';

export const FLOWS_PROVIDER_ID = 'hq.design.flows';
export const FLOW_ITEM_KINDS = ['flow-map', 'flow-player'] as const;
export type FlowItemKind = (typeof FLOW_ITEM_KINDS)[number];

const PLAYER_FALLBACK = { width: 390, height: 844 };

export const flowItemKey = (kind: FlowItemKind, id: FlowId): string => `${FLOWS_PROVIDER_ID}/${kind}/${encodeURIComponent(id)}`;

export function parseFlowItemKey(key: string): { readonly kind: FlowItemKind; readonly flowId: FlowId } | null {
  const match = /^hq\.design\.flows\/(flow-map|flow-player)\/([^/]+)$/u.exec(key);
  if (!match) return null;
  try { return { kind: match[1] as FlowItemKind, flowId: decodeURIComponent(match[2]!) as FlowId }; } catch { return null; }
}

async function describe(flow: FlowDocument, kind: FlowItemKind): Promise<CanvasItemDescriptor> {
  const start = flow.screens.find((screen) => screen.id === flow.start);
  const map = kind === 'flow-map' ? layoutFlowMap(flow) : null;
  return {
    key: flowItemKey(kind, flow.id), providerId: FLOWS_PROVIDER_ID, kind, entityId: flow.id, projectId: flow.projectId,
    title: kind === 'flow-map' ? `${flow.title} — flow map` : `${flow.title} — prototype`,
    sourceRevision: await jcsDigest(flow),
    intrinsicSize: map ? { width: map.width, height: map.height } : start ? { width: start.viewport.w, height: start.viewport.h } : PLAYER_FALLBACK,
    evidence: 'web-approximation',
  };
}

/**
 * Canvas provider for HQD-02. It describes items only: arrangement belongs to the canvas,
 * and nothing here writes flow documents.
 */
export function createFlowCanvasProvider(repository: Pick<FlowRepository, 'load' | 'listForProject'>): CanvasItemProvider {
  return {
    providerId: FLOWS_PROVIDER_ID,
    kinds: FLOW_ITEM_KINDS,
    async listItems(projectId) {
      const items: CanvasItemDescriptor[] = [];
      for (const flow of await repository.listForProject(projectId)) {
        for (const kind of FLOW_ITEM_KINDS) items.push(await describe(flow, kind));
      }
      return items;
    },
    async resolveItem(key) {
      const parsed = parseFlowItemKey(key);
      const loaded = parsed ? await repository.load(parsed.flowId) : null;
      return parsed && loaded?.status === 'ok' ? { status: 'ok', item: await describe(loaded.flow, parsed.kind) } : { status: 'missing', key };
    },
  };
}
