import { plainRecord, type CanonicalValue } from './canonical.js';
import { decodeCaptureReceipt, encodeCaptureReceipt } from './capture-evidence.js';
import { captureReceiptKey } from './keys.js';

/** Structural subset of WorkspaceBacking; no store is opened or bound here. */
export interface CaptureReceiptPersistBacking {
  putDocument(key: string, value: CanonicalValue, options: { readonly expectedRevision: null }): Promise<unknown>;
}

export interface CaptureReceiptPersistService {
  persist(receipt: unknown): Promise<boolean>;
}

/** Uncomposed protocol-evidence writer; persistence confers no producer trust or capture eligibility. */
export function createCaptureReceiptPersistService({ backing }: {
  readonly backing: CaptureReceiptPersistBacking;
}): CaptureReceiptPersistService {
  return {
    async persist(receipt: unknown): Promise<boolean> {
      try {
        const admitted = decodeCaptureReceipt(receipt);
        if (admitted.fixture.state !== 'unknown' || admitted.fixture.attestedBy !== null) return false;
        const key = captureReceiptKey(admitted.captureId);
        // This immutable expectation must precede any call into the injected backing.
        const expected = encodeCaptureReceipt(admitted);
        const detached: CanonicalValue = JSON.parse(expected);
        const ack = plainRecord(await backing.putDocument(key, detached, { expectedRevision: null }));
        return ack.key === key && ack.revision === 1 && encodeCaptureReceipt(ack.value) === expected;
      } catch {
        // False leaves a possibly completed write unresolved; the host owns orphan handling.
        return false;
      }
    },
  };
}
