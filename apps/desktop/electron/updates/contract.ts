import { createRequire } from 'node:module';
import type { BuildReceipt, InstallationRecord, PreparedCandidate, UpdateErrorCode, UpdateManifest } from '@hq/contracts/updates';

interface RuntimeContract {
  candidateId(manifest: UpdateManifest): string;
  validateManifest(value: unknown): UpdateManifest;
  validateInstallation(value: unknown): InstallationRecord;
  validateBuildReceipt(value: unknown): BuildReceipt;
  validatePreparedCandidate(value: unknown): PreparedCandidate;
  receiptOf(manifest: UpdateManifest): BuildReceipt;
  readBuildReceipt(bundlePath: string): Promise<BuildReceipt>;
  atomicWrite(path: string, value: unknown): Promise<void>;
  readJson(path: string, options?: { maxBytes?: number }): Promise<unknown>;
  MAX_ARCHIVE_BYTES: number;
  MAX_EXPANDED_BYTES: number;
  MAX_FILE_COUNT: number;
}

const require = createRequire(import.meta.url);
export const contract = require('../../../../tools/updater/contract.cjs') as RuntimeContract;

export function nativeVerifier() {
  const { createNativeAdapter } = require('../../../../tools/updater/native.cjs') as {
    createNativeAdapter(): { verifyBundle(path: string, receipt: BuildReceipt): Promise<BuildReceipt> };
  };
  return createNativeAdapter();
}

export function isCandidateRetained(stateRoot: string, candidateId: string): Promise<boolean> {
  const transaction = require('../../../../tools/updater/transaction.cjs') as {
    isCandidateRetained(stateRoot: string, candidateId: string): Promise<boolean>;
  };
  return transaction.isCandidateRetained(stateRoot, candidateId);
}

export class UpdateFailure extends Error {
  constructor(readonly code: UpdateErrorCode) { super(code); }
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new UpdateFailure('cancelled');
}

export const REPOSITORY = Object.freeze({ name: 'Jones-Systems/HQ', id: 1426280211, ownerId: 320115260 });
export const REPOSITORY_URL = `https://github.com/${REPOSITORY.name}`;
export const API_ROOT = `https://api.github.com/repos/${REPOSITORY.name}`;
export const WORKFLOW = '.github/workflows/hq-desktop-package.yml';

export function receiptOf(manifest: UpdateManifest): BuildReceipt {
  return contract.receiptOf(manifest);
}
