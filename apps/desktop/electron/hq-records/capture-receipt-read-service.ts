import { closedRecord, isDigest, plainRecord, type Digest } from './canonical.js';
import { captureReceiptDigest, decodeCaptureReceipt, staticCaptureEligible, type CaptureReceipt, type StaticCaptureEligibility } from './capture-evidence.js';
import { captureReceiptKey, opaqueSegment } from './keys.js';

/** Structurally accepts Readonly<Pick<WorkspaceBacking, 'getDocument'>>; observations remain untrusted. */
export interface CaptureReceiptReadBacking {
  readonly getDocument: (key: string) => Promise<unknown>;
}

export type CaptureReceiptReadResult =
  | { readonly status: 'invalid'; readonly reason: 'request-invalid' | 'receipt-invalid' }
  | { readonly status: 'absent' }
  | { readonly status: 'unknown'; readonly phase: 'receipt-read' }
  | { readonly status: 'conflict'; readonly reason: 'receipt-digest-mismatch' }
  | { readonly status: 'observed'; readonly revision: number; readonly receiptDigest: Digest;
    readonly receipt: CaptureReceipt; readonly eligibility: StaticCaptureEligibility };

/**
 * Reads stored CAP-1 evidence only. Eligibility issues no host/fixture attestation or producer trust,
 * native qualification or consumer capability, even for a synthetic receipt reporting eligible:true.
 * Parsed values and protocol digests are not original-file-byte evidence. This service neither
 * publishes nor accepts a capture, materializes a StaticCapture/version, nor changes Compare captures:[].
 */
export function createCaptureReceiptReadService(options: { readonly backing: CaptureReceiptReadBacking }) {
  return {
    async read(request: unknown): Promise<CaptureReceiptReadResult> {
      let captureId: string, expectedDigest: Digest, key: string;
      try {
        const admitted = closedRecord(request, ['captureId', 'receiptDigest']);
        captureId = opaqueSegment(admitted.captureId);
        const digest = admitted.receiptDigest;
        if (!isDigest(digest)) return { status: 'invalid', reason: 'request-invalid' };
        expectedDigest = digest;
        key = captureReceiptKey(captureId);
      } catch {
        return { status: 'invalid', reason: 'request-invalid' };
      }

      let observed: unknown;
      try {
        observed = await options.backing.getDocument(key);
      } catch {
        return { status: 'unknown', phase: 'receipt-read' };
      }
      if (observed === null) return { status: 'absent' };
      try {
        const document = plainRecord(observed);
        const revision = document.revision;
        if (document.key !== key || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
          return { status: 'invalid', reason: 'receipt-invalid' };
        }
        const receipt = decodeCaptureReceipt(document.value);
        if (receipt.captureId !== captureId) return { status: 'invalid', reason: 'receipt-invalid' };
        const receiptDigest = captureReceiptDigest(receipt);
        if (receiptDigest !== expectedDigest) return { status: 'conflict', reason: 'receipt-digest-mismatch' };
        return { status: 'observed', revision, receiptDigest, receipt, eligibility: staticCaptureEligible(receipt) };
      } catch {
        return { status: 'invalid', reason: 'receipt-invalid' };
      }
    },
  };
}
