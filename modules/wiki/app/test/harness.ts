// Assembly harness: the real core host over the committed synthetic corpus, a simulated preload bridge, and the
// module's own renderer client and domain. Nothing here is a mock of the code under test.

import { createMemoryIndexStore, createNodeGitObjectSource, createWikiHost, type Clock, type WikiHost } from '../../core/src/index.ts';
import { WIKI_SERVICE_METHODS, type WikiService } from '../../contract/src/index.ts';
import { createWikiClient } from '../src/client.ts';
import { createWikiDomain, type WikiDomain } from '../src/domain.ts';
import type { WikiHostPort, WikiModulePort } from '../src/port.ts';
import { CLOCK_MS, buildCorpus, type SyntheticCorpus } from './corpus.ts';
import { createScratch } from './scratch.ts';

export const clock: Clock = { now: () => CLOCK_MS };

export interface PortCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface Bridge {
  /** Exactly the seven methods; arguments and results cross `structuredClone`, like Electron's IPC. */
  readonly port: WikiHostPort;
  readonly calls: PortCall[];
}

/**
 * Simulates the preload bridge over a host's service. The service object is read only through the seven method names,
 * so even a host-only `refresh` cannot be reached from here; `calls` records everything the renderer sent.
 */
export function bridgeOver(service: WikiService, calls: PortCall[] = []): Bridge {
  const entries = WIKI_SERVICE_METHODS.map((method) => {
    const handler = async (...args: unknown[]): Promise<unknown> => {
      const sent = structuredClone(args);
      calls.push({ method, args: sent });
      const result: unknown = await (service[method] as (...a: unknown[]) => Promise<unknown>)(...sent);
      return structuredClone(result);
    };
    return [method, handler] as const;
  });
  return { port: Object.freeze(Object.fromEntries(entries)) as unknown as WikiHostPort, calls };
}

export interface Assembly {
  readonly corpus: SyntheticCorpus;
  readonly host: WikiHost;
  readonly bridge: Bridge;
  readonly client: WikiService;
  readonly domain: WikiDomain;
  /** Removes the scratch repositories. Idempotent. */
  cleanup(): void;
}

/** Real committed bare repositories, the real node Git adapter, an indexed host, and the module on top. */
export async function assemble(label: string): Promise<Assembly> {
  const scratch = createScratch(label);
  try {
    const corpus = buildCorpus(scratch.root);
    const sources = {
      bl: createNodeGitObjectSource(corpus.profiles[0]),
      appdev: createNodeGitObjectSource(corpus.profiles[1]),
    };
    const host = createWikiHost({ profiles: corpus.profiles, sources, store: createMemoryIndexStore(), clock });
    const refreshed = await host.refresh();
    if (!refreshed.ok) throw new Error(`synthetic corpus failed to index: ${refreshed.error.reason}`);
    const bridge = bridgeOver(host.service);
    const client = createWikiClient(() => bridge.port);
    const domain = createWikiDomain({ getPort: () => bridge.port });
    return { corpus, host, bridge, client, domain, cleanup: scratch.cleanup };
  } catch (error) {
    scratch.cleanup();
    throw error;
  }
}

export function modulePort(overrides: Partial<WikiModulePort> = {}): WikiModulePort {
  return {
    context: { id: 'project-synthetic', name: 'Synthetic Project' },
    destination: 'home',
    appearance: 'light',
    desktop: { platform: 'browser', versions: { electron: null } },
    navigate: () => {},
    ...overrides,
  };
}
