import type { FlowStoragePort, ScreenPreviewPort } from './contract.ts';

/** In-memory storage for tests and unintegrated views. Not durable; root wires the real store. */
export interface FakeFlowStorage extends FlowStoragePort {
  readonly writes: readonly { readonly namespace: string; readonly key: string }[];
}

export function createFakeFlowStorage(): FakeFlowStorage {
  const documents = new Map<string, string>();
  const writes: { namespace: string; key: string }[] = [];
  return {
    label: 'FAKE in-memory flow storage (not durable)',
    writes,
    async getDocument(namespace, key) {
      const value = documents.get(`${namespace}:${key}`);
      return value === undefined ? undefined : JSON.parse(value);
    },
    async putDocument(namespace, key, value) {
      writes.push({ namespace, key });
      documents.set(`${namespace}:${key}`, JSON.stringify(value));
    },
    async listKeys(namespace, prefix) {
      return [...documents.keys()].filter((key) => key.startsWith(`${namespace}:${prefix}`)).map((key) => key.slice(namespace.length + 1)).sort();
    },
  };
}

/** Placeholder previews: no captures are fetched, so screens render as labelled frames. */
export const FAKE_PREVIEWS: ScreenPreviewPort = Object.freeze({
  label: 'FAKE preview port (no captures)',
  previewUrl: () => null,
});
