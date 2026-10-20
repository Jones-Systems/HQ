import {
  MESSAGES, PortFailure, checkBrandName, checkDraft, checkRunSubmission, isJsonObject, isRunId, isToolId,
  type Brand, type Draft, type PortError, type RunRecord, type SocialWorkspacePort, type WorkspaceSnapshot,
} from '../core';
import { errorText, guardBrand, guardDraft, guardRun, guardSample, guardWorkspace } from './guards';
import type { ServiceResponse, SocialServiceParams, SocialServiceRoute, SocialServiceTransport } from './transport';

/**
 * The live SocialWorkspacePort (task.social-live-adapter.001) over an injected, closed transport. It
 * validates before sending with the same rules as the fixture, sends one call per port call and never
 * retries. An uncertain outcome (thrown or lost call, malformed envelope or result, 5xx or unmapped status)
 * is `unavailable` on a read route and `unknown` on a mutation route, whose effect is not proved.
 */

const READ_ROUTES: ReadonlySet<SocialServiceRoute> = new Set(['workspace', 'sample', 'run']);

export interface LiveSocialPortOptions {
  /** Client clock for `observedAt` and `attemptedAt`. */
  readonly now?: () => Date;
}

function fail(error: PortError): never {
  throw new PortFailure(error);
}

/**
 * The PortError for a received non-2xx response. The error text is shown only when it is a string;
 * otherwise, and for 5xx or any unmapped status, it is the caller's `uncertain` error.
 */
export function httpError(status: number, body: unknown, uncertain: PortError): PortError {
  const message = errorText(body);
  if (message === null) return uncertain;
  if (status === 400 || status === 422) return { kind: 'invalid', message };
  if (status === 409) return { kind: 'conflict', message };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 404) return { kind: 'not_found' };
  return uncertain;
}

function isEnvelope(value: unknown): value is ServiceResponse {
  if (!isJsonObject(value)) return false;
  if (value.ok === true) {
    // `replayed` is required by the seam and ignored here; absent is tolerated, a non-boolean is not.
    return typeof value.status === 'number' && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
      && 'body' in value && (value.replayed === undefined || typeof value.replayed === 'boolean');
  }
  return value.ok === false && (value.kind === 'unavailable' || value.kind === 'unknown');
}

export function createLiveSocialPort(transport: SocialServiceTransport, options: LiveSocialPortOptions = {}): SocialWorkspacePort {
  const clock = options.now ?? (() => new Date());
  const stamp = () => clock().toISOString();
  // Capabilities from the last snapshot gate proposed fields. Null until a snapshot is read.
  let features: readonly string[] | null = null;

  /** Exactly one transport call. Resolves the 2xx body; rejects every other outcome as a PortError. */
  async function call<R extends SocialServiceRoute>(route: R, params: SocialServiceParams[R]): Promise<{ body: unknown; uncertain: PortError }> {
    const uncertain: PortError = READ_ROUTES.has(route) ? { kind: 'unavailable' } : { kind: 'unknown', attemptedAt: stamp() };
    let response: unknown;
    try {
      response = await transport.call(route, params);
    } catch {
      fail(uncertain);
    }
    if (!isEnvelope(response)) fail(uncertain);
    if (!response.ok) fail(response.kind === 'unavailable' ? { kind: 'unavailable' } : uncertain);
    if (response.status < 200 || response.status > 299) fail(httpError(response.status, response.body, uncertain));
    return { body: response.body, uncertain };
  }

  /** A 2xx body that fails its guard is uncertain: a read is `unavailable`, a mutation `unknown`. */
  function guarded<T>(result: { body: unknown; uncertain: PortError }, guard: (body: unknown) => T | null): T {
    const value = guard(result.body);
    if (value === null) fail(result.uncertain);
    return value;
  }

  async function readWorkspace() {
    const workspace = guarded(await call('workspace', {}), guardWorkspace);
    features = workspace.features;
    return workspace;
  }

  return {
    async snapshot(): Promise<WorkspaceSnapshot> {
      return { ...(await readWorkspace()), observedAt: stamp() };
    },

    async saveDraft(draft): Promise<Draft> {
      // A JSON round trip models the wire: undefined keys vanish as they would in a request.
      const wire: unknown = JSON.parse(JSON.stringify(draft));
      // Links are gated by a capability; learn it with one read only when a draft carries links.
      const carriesLinks = isJsonObject(wire) && Array.isArray(wire.links) && wire.links.length > 0;
      if (features === null && carriesLinks) {
        // A failed pre-read makes no mutation.
        try {
          await readWorkspace();
        } catch {
          fail({ kind: 'unavailable' });
        }
      }
      const checked = checkDraft(wire, { features: features ?? [] });
      if (!checked.ok) fail(checked.error);
      const { fields, target, links } = checked.value;
      const body = { ...fields, ...(target ? { id: target.id, version: target.version } : {}), ...(links ? { links } : {}) };
      return guarded(await call('saveContent', body), guardDraft);
    },

    async addBrand(name): Promise<Brand> {
      const checked = checkBrandName(name);
      if (!checked.ok) fail(checked.error);
      return guarded(await call('addBrand', { name: checked.value }), guardBrand);
    },

    async example(tool): Promise<Record<string, unknown>> {
      if (!isToolId(tool)) fail({ kind: 'invalid', message: MESSAGES.unknownTool });
      return guarded(await call('sample', { tool }), guardSample);
    },

    async run(id): Promise<RunRecord> {
      if (!isRunId(id)) fail({ kind: 'invalid', message: MESSAGES.runId });
      return guarded(await call('run', { id }), guardRun);
    },

    async submitRun(tool, input, isExample): Promise<RunRecord> {
      const checked = checkRunSubmission(tool, input, isExample);
      if (!checked.ok) fail(checked.error);
      // EXECUTION class: one call, never retried. A lost or malformed result is `unknown`.
      return guarded(await call('submitRun', { tool: checked.value.tool, input: checked.value.input, is_example: checked.value.isExample }), guardRun);
    },
  };
}
