import type { ProjectContext } from '@hq/contracts';
import type { PreviewTransport } from '@hq/contracts/preview';
import type { JonesStatus, JonesTransport } from '@hq/contracts/jones-code';
import type { RunsConnection } from '../../../modules/design/app/sections/runs/env.ts';
import type { TransportPort, EvidenceReadbackPort } from '../../../modules/design/connector/src/contract.ts';
import type { HostCatalog } from '../../../modules/design/connector/src/host-catalog.ts';

export type ProjectNavigation = 'restore-saved' | 'preserve-design';
const listeners = new Set<(project: ProjectContext, navigation: ProjectNavigation) => void>();
export function selectDesktopProject(project: { id: string; label: string; navigation?: 'preserve-design' }) {
  for (const listener of listeners) listener({ id: project.id, name: project.label }, project.navigation ?? 'restore-saved');
}
export function subscribeDesktopProject(listener: (project: ProjectContext, navigation: ProjectNavigation) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const desktopPreview: PreviewTransport = {
  async call(route, params) {
    const transport = window.hqServices?.preview;
    return transport ? transport.call(route, params) : { ok: false, kind: 'unavailable' };
  },
};
export async function deactivateDesktopPreview() { await desktopPreview.call('deactivate', {}); }
export async function overlayDesktopPreview(hidden: boolean) { await desktopPreview.call('overlay', { hidden }); }
export function createJonesConnection(transport: JonesTransport | undefined): { connection: RunsConnection; refresh(): Promise<void> } {
  let current: JonesStatus = { state: 'not-configured', destinations: [], descriptor: { kind: 'jones-code', label: 'Jones Code', provenance: 'jones', modes: ['existing-thread'], qualification: { level: 'unqualified', reason: 'Jones Code is disconnected' } } };
  let generation = 0;
  const getCatalog = (): HostCatalog => ({ schema: 'hq.design.host-catalog/v1', generation, complete: true, observedAt: new Date().toISOString(), destinations: current.destinations.filter(destination => destination.deliveryQualified) });
  async function invoke<R extends Parameters<JonesTransport['call']>[0]>(route: R, params: import('@hq/contracts/jones-code').JonesParams[R]) {
    if (!transport) throw Error('Jones Code is disconnected');
    const result = await transport.call(route, params);
    if (!result.ok) throw Error(result.kind === 'unknown' ? 'Receiver effect unknown; use readback' : 'Jones Code unavailable');
    return result.value;
  }
  const port: TransportPort & EvidenceReadbackPort = {
    get descriptor() { return current.descriptor; },
    identify: (endpoint) => invoke('jonesCode.identify', { locator: endpoint.locator }),
    send: (handoff, endpoint) => invoke('jonesCode.send', { locator: endpoint.locator, handoff }),
    lookup: (query) => invoke('jonesCode.lookup', { locator: query.endpoint.locator, idempotencyKey: query.idempotencyKey }),
    fence: (query) => invoke('jonesCode.fence', { locator: query.endpoint.locator, idempotencyKey: query.idempotencyKey }),
    readEvidence: (query) => invoke('jonesCode.readEvidence', { locator: query.endpoint.locator, idempotencyKey: query.idempotencyKey, dispatchId: query.dispatchId, attemptId: query.attemptId, receiptId: query.receiptId }),
  };
  return { connection: { getCatalog, transports: { 'jones-code': port }, readback: { 'jones-code': port } },
    async refresh() { if (!transport) return; const result = await transport.call('jonesCode.status', {}); if (result.ok) { current = result.value; generation++; } },
  };
}
