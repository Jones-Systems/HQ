// The renderer client: a `WikiService` over the seven-method host port.
//
// It is the renderer's half of the trust boundary. Requests are checked with the contract guards before they leave
// (so a forbidden or malformed request never reaches the host), and only the exact seven method names are ever read
// from the port, so an extra member such as a host-only `refresh` can neither be called nor surface. Every response
// is checked against the contract validators; anything else becomes a contract error. Failures are data: the client
// never throws and never repeats a thrown message.

import {
  INVALID_INPUT_REASONS,
  SERVICE_ERROR_REASONS,
  WIKI_SERVICE_METHODS,
  failWith,
  ok,
  serviceError,
  validateAliasResolution,
  validateBacklinkResult,
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateIndexStatus,
  validateListTopicsRequest,
  validatePage,
  validateResolveAliasRequest,
  validateSearchRequest,
  validateSearchResult,
  validateSourceDescriptor,
  validateTopicList,
  type PageKey,
  type SourceDescriptor,
  type WikiError,
  type WikiResult,
  type WikiService,
  type WikiServiceMethodName,
} from '../../contract/src/index.ts';
import type { WikiHostPort } from './port.ts';

const MAX_ERROR_MESSAGE = 500;

const UNREACHABLE: WikiError = serviceError('unavailable', 'source-unavailable', 'The Wiki host did not answer.');
const MALFORMED: WikiError = serviceError('internal', 'internal', 'The Wiki host sent a response that did not match the contract.');
const FAILED: WikiError = serviceError('internal', 'internal', 'The Wiki request could not be completed.');

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Rebuilds a host error from known fields only, or returns null when it is not a coherent contract error. */
function readError(value: unknown): WikiError | null {
  if (!isPlain(value) || !hasOnly(value, ['code', 'reason', 'message', 'path'])) return null;
  const { code, reason, message, path } = value;
  if (typeof message !== 'string' || message.length > MAX_ERROR_MESSAGE) return null;
  if (path !== undefined && (typeof path !== 'string' || path.length > MAX_ERROR_MESSAGE)) return null;
  const invalidReasons: readonly unknown[] = INVALID_INPUT_REASONS;
  const serviceReasons: readonly unknown[] = SERVICE_ERROR_REASONS;
  const coherent =
    code === 'invalid-input'
      ? invalidReasons.includes(reason)
      : (code === 'not-found' || code === 'unavailable' || code === 'internal') && serviceReasons.includes(reason);
  if (!coherent) return null;
  return { code, reason, message, ...(path === undefined ? {} : { path }) } as WikiError;
}

type Checked<T> = WikiResult<T>;

/** Reads the `{ ok, value } | { ok, error }` envelope and validates the success value. */
function readResult<T>(raw: unknown, validate: (value: unknown) => WikiResult<T>, accept: (value: T) => boolean): Checked<T> {
  if (!isPlain(raw)) return failWith(MALFORMED);
  if (raw['ok'] === true) {
    if (!hasOnly(raw, ['ok', 'value']) || !('value' in raw)) return failWith(MALFORMED);
    const checked = validate(raw['value']);
    return checked.ok && accept(checked.value) ? ok(checked.value) : failWith(MALFORMED);
  }
  if (raw['ok'] === false && hasOnly(raw, ['ok', 'error'])) {
    const error = readError(raw['error']);
    return error === null ? failWith(MALFORMED) : failWith(error);
  }
  return failWith(MALFORMED);
}

function sameKey(a: PageKey, b: PageKey): boolean {
  return a.namespace === b.namespace && a.path === b.path;
}

function checkSources(value: unknown): WikiResult<readonly SourceDescriptor[]> {
  if (!Array.isArray(value) || value.length > 16) return failWith(MALFORMED);
  const seen = new Set<string>();
  for (const item of value) {
    const checked = validateSourceDescriptor(item);
    if (!checked.ok || seen.has(checked.value.namespace)) return failWith(MALFORMED);
    seen.add(checked.value.namespace);
  }
  return ok(value as readonly SourceDescriptor[]);
}

/**
 * Builds the renderer's `WikiService`. `getPort` is read on every call, so a bridge that appears after load is used as
 * soon as it exists; `null` (no bridge) answers `unavailable` without throwing. The returned object has exactly the
 * seven contract methods.
 */
export function createWikiClient(getPort: () => WikiHostPort | null): WikiService {
  async function send<T>(
    method: WikiServiceMethodName,
    request: readonly unknown[],
    validate: (value: unknown) => WikiResult<T>,
    accept: (value: T) => boolean = () => true,
  ): Promise<WikiResult<T>> {
    try {
      const port = getPort();
      const call: unknown = port === null ? undefined : port[method];
      if (typeof call !== 'function') return failWith(UNREACHABLE);
      let raw: unknown;
      try {
        raw = await Reflect.apply(call, port, request);
      } catch {
        return failWith(UNREACHABLE);
      }
      return readResult(raw, validate, accept);
    } catch {
      return failWith(FAILED);
    }
  }

  // A request that fails the contract guards is answered locally; it never reaches the host.
  const refuse = <T>(error: WikiError): Promise<WikiResult<T>> => Promise.resolve(failWith(error));

  const service: WikiService = {
    listSources: () => send('listSources', [], checkSources),
    search(request) {
      const checked = validateSearchRequest(request);
      if (!checked.ok) return refuse(checked.error);
      const { query, namespaces, limit } = checked.value;
      return send('search', [{ query, namespaces: [...namespaces], limit }], validateSearchResult);
    },
    getPage(request) {
      const checked = validateGetPageRequest(request);
      if (!checked.ok) return refuse(checked.error);
      const key: PageKey = { namespace: checked.value.key.namespace, path: checked.value.key.path };
      return send('getPage', [{ key }], validatePage, (page) => sameKey(page.key, key));
    },
    resolveAlias(request) {
      const checked = validateResolveAliasRequest(request);
      if (!checked.ok) return refuse(checked.error);
      const { namespace, alias } = checked.value;
      return send('resolveAlias', [{ namespace, alias }], validateAliasResolution, (result) => {
        if (result.status === 'resolved') return result.target.namespace === namespace;
        if (result.status === 'ambiguous') return result.candidates.every((candidate) => candidate.namespace === namespace);
        return true;
      });
    },
    getBacklinks(request) {
      const checked = validateGetBacklinksRequest(request);
      if (!checked.ok) return refuse(checked.error);
      const key: PageKey = { namespace: checked.value.key.namespace, path: checked.value.key.path };
      return send('getBacklinks', [{ key, limit: checked.value.limit }], validateBacklinkResult, (result) => sameKey(result.target, key));
    },
    listTopics(request) {
      const checked = validateListTopicsRequest(request);
      if (!checked.ok) return refuse(checked.error);
      const { namespace } = checked.value;
      return send('listTopics', [{ namespace }], validateTopicList, (list) => list.namespace === namespace);
    },
    indexStatus: () => send('indexStatus', [], validateIndexStatus),
  };

  // Compile-time and runtime pins that the client exposes the contract's seven methods and nothing else.
  return Object.freeze(Object.fromEntries(WIKI_SERVICE_METHODS.map((name) => [name, service[name]])) as unknown as WikiService);
}
