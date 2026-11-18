import { canonicalJson, ContractError } from './canonical.js';
import {
  captureReceiptDigest, normalizeCaptureAcceptRequest, planCaptureAccept,
  type CaptureAcceptPlan, type CaptureAcceptRequest, type CaptureBinding,
} from './capture-evidence.js';
import { captureOperationKey, captureReceiptKey } from './keys.js';
import { documentRevision } from './projects-registry.js';

export type CaptureJson = null | boolean | number | string | readonly CaptureJson[]
  | { readonly [key: string]: CaptureJson };

export interface CaptureDocument {
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
}

export interface CaptureAcceptPut {
  readonly key: string;
  readonly expectedRevision: null;
  readonly value: CaptureJson;
}

/** The injected authoritative port must check all revisions and publish the pair atomically. */
export interface CaptureAcceptBacking {
  getDocument(key: string): Promise<CaptureDocument | null>;
  commitPuts(puts: readonly CaptureAcceptPut[]): Promise<readonly CaptureDocument[]>;
}

export type AcceptCaptureResult = Exclude<CaptureAcceptPlan, { readonly status: 'planned' }>
  | { readonly status: 'saved'; readonly result: CaptureBinding }
  | { readonly status: 'refused'; readonly reason: 'commit-conflict' }
  | { readonly status: 'unknown'; readonly phase: 'operation-read' | 'receipt-read' | 'commit' };

function invalid(error: unknown): { readonly status: 'invalid'; readonly reason: string } {
  return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid capture record' };
}

function checkDocument(document: CaptureDocument, key: string): CaptureDocument {
  if (document === null || typeof document !== 'object' || document.key !== key) {
    throw new ContractError('Stored capture document key mismatch');
  }
  documentRevision(document.revision);
  return document;
}

function isCommitConflict(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && 'name' in error && error.name === 'StoreError' && 'code' in error && error.code === 'conflict';
}

/** Uncomposed binding persistence only; construction does no I/O or clock work and attests no eligibility. */
export function createCaptureAcceptService(dependencies: {
  readonly backing: CaptureAcceptBacking;
  readonly now: () => unknown;
}): { accept(request: unknown): Promise<AcceptCaptureResult> } {
  const { backing, now } = dependencies;
  return {
    async accept(request) {
      let normalized: CaptureAcceptRequest;
      try { normalized = normalizeCaptureAcceptRequest(request); }
      catch (error) { return invalid(error); }

      const operationKey = captureOperationKey(normalized.operationId);
      let operation: CaptureDocument | null;
      try { operation = await backing.getDocument(operationKey); }
      catch { return { status: 'unknown', phase: 'operation-read' }; }
      if (operation !== null) {
        try {
          checkDocument(operation, operationKey);
          const replay = planCaptureAccept(normalized, {
            receipt: { digest: normalized.receiptDigest, value: null },
            operation: { status: 'present', value: operation.value }, now,
          });
          if (replay.status === 'planned') throw new ContractError('Unexpected capture replay plan');
          return replay;
        } catch (error) { return invalid(error); }
      }

      const receiptKey = captureReceiptKey(normalized.captureId);
      let receipt: CaptureDocument | null;
      try { receipt = await backing.getDocument(receiptKey); }
      catch { return { status: 'unknown', phase: 'receipt-read' }; }
      let evidence: { readonly digest: CaptureAcceptRequest['receiptDigest']; readonly value: unknown };
      try {
        if (receipt === null) throw new ContractError('Missing authoritative capture receipt');
        checkDocument(receipt, receiptKey);
        evidence = { digest: captureReceiptDigest(receipt.value), value: receipt.value };
      } catch (error) { return invalid(error); }
      const plan = planCaptureAccept(normalized, { receipt: evidence, operation: { status: 'absent' }, now });
      if (plan.status !== 'planned') return plan;

      // Retain expected bytes independently of the objects handed to the backing.
      const expected = plan.puts.map(put => ({ key: put.key, value: canonicalJson(put.value) }));
      const puts: readonly CaptureAcceptPut[] = expected.map(put => ({
        key: put.key, expectedRevision: null, value: JSON.parse(put.value) as CaptureJson,
      }));
      let committed: readonly CaptureDocument[];
      try { committed = await backing.commitPuts(puts); }
      catch (error) {
        return isCommitConflict(error) ? { status: 'refused', reason: 'commit-conflict' }
          : { status: 'unknown', phase: 'commit' };
      }
      try {
        if (!Array.isArray(committed) || committed.length !== 2) throw new ContractError('Incomplete capture commit response');
        for (const put of expected) {
          const matches = committed.filter(item => item?.key === put.key);
          if (matches.length !== 1) throw new ContractError('Capture commit response key mismatch');
          const saved = checkDocument(matches[0], put.key);
          if (saved.revision !== 1 || canonicalJson(saved.value) !== put.value) {
            throw new ContractError('Capture commit response mismatch');
          }
        }
      } catch { return { status: 'unknown', phase: 'commit' }; }
      return { status: 'saved', result: plan.result };
    },
  };
}
