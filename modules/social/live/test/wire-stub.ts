import { createFixtureWorkspace, type FixtureOptions, type FixtureWorkspace, type PortError, portErrorOf } from '../../core';
import type { ServiceResponse, SocialServiceParams, SocialServiceRoute, SocialServiceTransport } from '../transport';

/**
 * A fictional wire-codec bridge stub. It stands in for main process + Social service: the in-memory
 * fixture supplies the service behaviour, and this codec answers each closed route the way the recorded
 * Fieldnotes `server.py` source does, as a settled-seam envelope. Raw records on 200, `{ error }` with
 * 400/403/404/409, the workspace carrying `tools` and the workspace token, and no `features` key unless
 * capabilities are advertised. Every body crosses a JSON round trip. Nothing here touches a network.
 */

/** Fictional workspace token; the adapter must never surface it. */
export const STUB_WORKSPACE_TOKEN = 'stub-token-not-a-secret';

const STATUS: { readonly [K in Exclude<PortError['kind'], 'unavailable' | 'unknown'>]: number } = {
  invalid: 400, conflict: 409, not_found: 404, forbidden: 403,
};

export interface WireCall {
  readonly route: SocialServiceRoute;
  readonly params: unknown;
}

export interface WireStub {
  readonly transport: SocialServiceTransport;
  readonly service: FixtureWorkspace;
  readonly calls: WireCall[];
  callsTo(route: SocialServiceRoute): WireCall[];
}

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createWireStub(options: FixtureOptions & { readonly advertise?: boolean } = {}): WireStub {
  const service = createFixtureWorkspace(options);
  const { port } = service;
  const advertise = options.advertise ?? (options.features ?? []).length > 0;
  const calls: WireCall[] = [];

  async function answer<R extends SocialServiceRoute>(route: R, params: SocialServiceParams[R]): Promise<unknown> {
    const p = params as Record<string, unknown>;
    switch (route) {
      case 'workspace': {
        const { observedAt: _observedAt, features, ...rest } = await port.snapshot();
        return { ...rest, csrf: STUB_WORKSPACE_TOKEN, ...(advertise ? { features } : {}) };
      }
      case 'sample': return port.example(p.tool as never);
      case 'run': return port.run(p.id as string);
      case 'saveContent': return port.saveDraft(p as never);
      case 'addBrand': return port.addBrand(p.name as string);
      case 'submitRun': return port.submitRun(p.tool as never, p.input as Record<string, unknown>, p.is_example as boolean);
      default: throw new Error(`Route not in the closed set: ${String(route)}`);
    }
  }

  const transport: SocialServiceTransport = {
    async call(route, params) {
      calls.push({ route, params: wire(params) });
      try {
        return { ok: true, status: 200, body: wire(await answer(route, wire(params))), replayed: false };
      } catch (reason) {
        const error = portErrorOf(reason);
        if (!error) throw reason;
        if (error.kind === 'unavailable' || error.kind === 'unknown') return { ok: false, kind: error.kind } satisfies ServiceResponse;
        const message = 'message' in error ? error.message : error.kind === 'not_found' ? 'Run not found' : 'Reload the workspace before saving';
        return { ok: true, status: STATUS[error.kind], body: { error: message }, replayed: false } satisfies ServiceResponse;
      }
    },
  };

  return { transport, service, calls, callsTo: (route) => calls.filter((call) => call.route === route) };
}

/** A transport that answers from a script of exact exchanges, one per call, and records the requests. */
export function scriptedTransport(script: ReadonlyArray<ServiceResponse | Error | unknown>): { transport: SocialServiceTransport; calls: WireCall[] } {
  const queue = [...script];
  const calls: WireCall[] = [];
  return {
    calls,
    transport: {
      async call(route, params) {
        calls.push({ route, params: wire(params) });
        if (queue.length === 0) throw new Error(`Unscripted ${route} call`);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next as ServiceResponse;
      },
    },
  };
}
