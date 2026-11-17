import { createCaptureReceiptPersistService } from './hq-records/capture-receipt-persist-service.js';

export const CAPTURE_RECEIPTS_ENABLED = false as const;

export function createCaptureReceiptPersister(backing: {
  putDocument(key: string, value: unknown, options: { expectedRevision: null }): Promise<unknown>;
}): (receipt: Readonly<Record<string, unknown>>) => Promise<boolean> {
  return async receipt => {
    try { return await createCaptureReceiptPersistService({ backing }).persist(receipt); }
    catch { return false; }
  };
}
