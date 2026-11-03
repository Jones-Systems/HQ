import type { ServiceResponse, WorkServiceTransport } from '@hq/contracts/services';

/** Work's bytes and selected destination stay in main. Mounting this client performs no export. */
export function createWorkExportClient(transport: WorkServiceTransport) {
  return {
    async export(format: 'json' | 'markdown'): Promise<ServiceResponse<{ saved: boolean }>> {
      try {
        const result = await transport.call('export', { format });
        if (!result.ok) return result;
        if (!result.body || typeof result.body !== 'object' || typeof (result.body as { saved?: unknown }).saved !== 'boolean') return { ok: false, kind: 'unavailable' };
        return { ...result, body: { saved: (result.body as { saved: boolean }).saved } };
      } catch { return { ok: false, kind: 'unavailable' }; }
    },
  };
}
