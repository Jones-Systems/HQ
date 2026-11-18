import type { ClockPort, ComponentStoragePort } from '../contract.ts';

/**
 * LABELLED FAKES. These stand in for root-wired adapters during independent
 * development and tests. They are not durable and grant no capability.
 */

export interface StorageWrite {
  readonly namespace: string;
  readonly key: string;
}

export interface MemoryStorage extends ComponentStoragePort {
  readonly label: 'FAKE in-memory StoragePort (not durable)';
  /** Every write in order, for spies. */
  readonly writes: StorageWrite[];
  /** Raw stored JSON text by key, for byte-level comparisons. */
  raw(key: string): string | undefined;
  /** Test-only tamper hook: replaces stored JSON without going through writeDocument. */
  tamper(key: string, json: string): void;
}

export function createMemoryStorage(): MemoryStorage {
  const documents = new Map<string, string>();
  const writes: StorageWrite[] = [];
  return {
    label: 'FAKE in-memory StoragePort (not durable)',
    writes,
    async readDocument(_namespace, key) {
      const text = documents.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async writeDocument(namespace, key, value) {
      writes.push({ namespace, key });
      documents.set(key, JSON.stringify(value));
    },
    async listKeys(_namespace, prefix) {
      return [...documents.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    raw: (key) => documents.get(key),
    tamper: (key, json) => { documents.set(key, json); },
  };
}

export interface FakeClock extends ClockPort {
  readonly label: 'FAKE manual clock';
  advance(ms: number): void;
  set(ms: number): void;
}

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  return {
    label: 'FAKE manual clock',
    now: () => current,
    advance: (ms) => { current += ms; },
    set: (ms) => { current = ms; },
  };
}

export const performanceClock: ClockPort = { now: () => globalThis.performance.now() };
