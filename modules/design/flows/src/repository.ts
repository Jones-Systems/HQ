import type { FlowDocument, FlowId, FlowStoragePort, ProjectId } from './contract.ts';
import { parseFlow } from './model.ts';

export const FLOW_KEY_PREFIX = 'design/flows/';
export const flowKey = (id: FlowId): string => `${FLOW_KEY_PREFIX}${encodeURIComponent(id)}`;

export type FlowLoad =
  | { readonly status: 'ok'; readonly flow: FlowDocument }
  | { readonly status: 'missing' }
  | { readonly status: 'unsupported'; readonly errors: readonly string[] }
  | { readonly status: 'invalid'; readonly errors: readonly string[] };

export interface FlowRepository {
  save(flow: FlowDocument): Promise<void>;
  load(id: FlowId): Promise<FlowLoad>;
  listForProject(projectId: ProjectId): Promise<readonly FlowDocument[]>;
}

/**
 * Flows live in the editable `workspace` namespace. Loading never repairs or rewrites a
 * stored document; future schemas and invalid records are reported and left untouched.
 */
export function createFlowRepository(storage: FlowStoragePort): FlowRepository {
  const load = async (id: FlowId): Promise<FlowLoad> => {
    const stored = await storage.getDocument('workspace', flowKey(id));
    if (stored === undefined || stored === null) return { status: 'missing' };
    const parsed = parseFlow(stored);
    if (parsed.ok) return parsed.flow.id === id ? { status: 'ok', flow: parsed.flow } : { status: 'invalid', errors: [`stored id ${parsed.flow.id} does not match key ${id}`] };
    return parsed.unsupportedSchema ? { status: 'unsupported', errors: parsed.errors } : { status: 'invalid', errors: parsed.errors };
  };
  return {
    async save(flow) {
      const parsed = parseFlow(structuredClone(flow));
      if (!parsed.ok) throw new TypeError(`Refusing to save invalid flow: ${parsed.errors.join('; ')}`);
      await storage.putDocument('workspace', flowKey(parsed.flow.id), structuredClone(parsed.flow));
    },
    load,
    async listForProject(projectId) {
      const flows: FlowDocument[] = [];
      for (const key of await storage.listKeys('workspace', FLOW_KEY_PREFIX)) {
        let id: FlowId;
        // A malformed key cannot name a flow; skip it rather than fail the whole listing.
        try { id = decodeURIComponent(key.slice(FLOW_KEY_PREFIX.length)) as FlowId; } catch { continue; }
        const result = await load(id);
        if (result.status === 'ok' && result.flow.projectId === projectId) flows.push(result.flow);
      }
      return flows;
    },
  };
}
