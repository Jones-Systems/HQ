import type { DesignServiceTransport } from '@hq/contracts/services';
import { bridgeResultValue, DesignBridgeError } from './bridge-documents.ts';
import { toDesignOperationError } from './errors.ts';

export interface DesignExportReport {
  readonly documents: number; readonly blobs: number; readonly events: number;
  readonly omitted: readonly { readonly category: string; readonly count: number;
    readonly unit: 'documents' | 'streams' | 'blobs' | 'events' | 'records'; readonly reason: string }[];
}
export interface DesignExportPort {
  preview(exportedAt: string): Promise<DesignExportReport>;
  save(exportedAt: string): Promise<{ readonly saved: boolean }>;
}
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => typeof v === 'object' && v !== null
  && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
  && Reflect.ownKeys(v).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(v, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
  });
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
function report(v: unknown): v is DesignExportReport {
  return exact(v, ['documents', 'blobs', 'events', 'omitted']) && count(v.documents) && count(v.blobs) && count(v.events)
    && Array.isArray(v.omitted) && Array.from(v.omitted).every(item => exact(item, ['category', 'count', 'unit', 'reason'])
      && text(item.category) && count(item.count) && ['documents', 'streams', 'blobs', 'events', 'records'].includes(item.unit as string) && text(item.reason));
}
export function createDesignExportPort(transport: DesignServiceTransport | null): DesignExportPort {
  async function call(route: 'export.preview' | 'export.save', exportedAt: string): Promise<unknown> {
    const write = route === 'export.save', uncertain = write ? 'unknown' : 'unavailable';
    try {
      if (typeof exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(exportedAt)
        || !Number.isFinite(Date.parse(exportedAt))) throw new DesignBridgeError('invalid');
      if (transport === null) throw new DesignBridgeError('unavailable', 'disabled');
      let result: unknown;
      try { result = await transport.call(route, { exportedAt }); } catch { throw new DesignBridgeError(uncertain); }
      const value = bridgeResultValue(result, uncertain);
      if (write ? !exact(value, ['saved']) || typeof value.saved !== 'boolean' : !report(value)) throw new DesignBridgeError(uncertain);
      return write ? Object.freeze({ saved: (value as { saved: boolean }).saved })
        : Object.freeze({ ...(value as DesignExportReport), omitted: Object.freeze((value as DesignExportReport).omitted.map(item => Object.freeze({ ...item }))) });
    } catch (error) {
      throw toDesignOperationError(error, { section: 'storage', operation: write ? 'storage.export-save' : 'storage.export-preview',
        action: write ? 'save the Design export' : 'preview the Design export', write });
    }
  }
  return Object.freeze({ preview: async (at: string) => await call('export.preview', at) as DesignExportReport,
    save: async (at: string) => await call('export.save', at) as { readonly saved: boolean } });
}
