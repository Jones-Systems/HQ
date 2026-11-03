/**
 * LOCAL structural mirror of the Social half of the desktop domain-service bridge
 * (spec.hq-social-work#iface.service-bridge.001), using the envelope settled for both domains
 * (`523104b#iface.work-live-transport.001`). No canonical shared contract exists yet; when one is
 * assigned, this file is replaced by an import of it. It declares shapes only and reaches nothing.
 *
 * The renderer names a closed route and its parameters. The main process owns the endpoint, method,
 * path, headers, workspace token (including its single 403 refresh), timeouts and size caps.
 */

export const SOCIAL_SERVICE_ROUTES = ['workspace', 'sample', 'run', 'saveContent', 'addBrand', 'submitRun'] as const;
export type SocialServiceRoute = (typeof SOCIAL_SERVICE_ROUTES)[number];

/** Parameters per route. Mutation parameters are the exact JSON request body the service reads. */
export interface SocialServiceParams {
  readonly workspace: Record<string, never>;
  readonly sample: { readonly tool: string };
  readonly run: { readonly id: string };
  readonly saveContent: Readonly<Record<string, unknown>>;
  readonly addBrand: { readonly name: string };
  readonly submitRun: { readonly tool: string; readonly input: Record<string, unknown>; readonly is_example: boolean };
}

/**
 * `ok: true` means only that an HTTP response arrived, including every 4xx and 5xx: always branch on
 * `status`. `body` is the decoded JSON, or null when the response was empty. `replayed` is required
 * by the seam and is ignored by Social. `ok: false` is a transport failure with no HTTP response.
 */
export type ServiceResponse =
  | { readonly ok: true; readonly status: number; readonly body: unknown; readonly replayed: boolean }
  | { readonly ok: false; readonly kind: 'unavailable' | 'unknown' };

export interface SocialServiceTransport {
  call<R extends SocialServiceRoute>(route: R, params: SocialServiceParams[R]): Promise<ServiceResponse>;
}

/** Structural check for `window.hqServices.social`: an object with a `call` function. */
export function isSocialServiceTransport(value: unknown): value is SocialServiceTransport {
  return typeof value === 'object' && value !== null && typeof (value as { call?: unknown }).call === 'function';
}

/** The preload's Social transport when present and structurally valid; otherwise null. Reads only. */
export function socialServiceBridge(scope: unknown = globalThis): SocialServiceTransport | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const services = (scope as { hqServices?: unknown }).hqServices;
  if (typeof services !== 'object' || services === null) return null;
  const social = (services as { social?: unknown }).social;
  return isSocialServiceTransport(social) ? social : null;
}
