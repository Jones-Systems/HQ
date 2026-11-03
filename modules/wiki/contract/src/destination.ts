// Logical destinations: the only navigation targets the Wiki shell accepts.
//   page/<namespace>/<encoded path>   search?q=<encoded query>   topics/<namespace>
// Path segments are percent-encoded individually (encodeURIComponent) and joined with `/`.
// Parsing is strict and canonical: a string parses only if formatting the result reproduces it
// exactly, so each destination has one spelling and encoded traversal cannot slip through.

import { hasControlChar } from './guard.ts';
import { MAX_DESTINATION_LENGTH, checkQuery } from './limits.ts';
import { checkNamespace, type WikiNamespace } from './namespace.ts';
import { checkPagePath, type PageKey } from './page-key.ts';
import { failWith, invalid, ok, type WikiResult } from './result.ts';

export type Destination =
  | { readonly kind: 'page'; readonly key: PageKey }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'topics'; readonly namespace: WikiNamespace };

const SCHEME_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function formatChecked(destination: Destination): WikiResult<string> {
  switch (destination.kind) {
    case 'page': {
      const error = checkNamespace(destination.key.namespace, '$.key.namespace') ?? checkPagePath(destination.key.path, '$.key.path');
      if (error !== null) return failWith(error);
      return ok(`page/${destination.key.namespace}/${destination.key.path.split('/').map(encodeURIComponent).join('/')}`);
    }
    case 'search': {
      const error = checkQuery(destination.query, '$.query');
      return error === null ? ok(`search?q=${encodeURIComponent(destination.query)}`) : failWith(error);
    }
    case 'topics': {
      const error = checkNamespace(destination.namespace, '$.namespace');
      return error === null ? ok(`topics/${destination.namespace}`) : failWith(error);
    }
    default:
      return failWith(invalid('invalid-destination', 'unknown destination kind'));
  }
}

/** Format a destination; fails when its key, namespace or query does not validate. */
export function formatDestination(destination: Destination): WikiResult<string> {
  return formatChecked(destination);
}

function decodeSegments(encoded: string): WikiResult<string> {
  try {
    return ok(encoded.split('/').map(decodeURIComponent).join('/'));
  } catch {
    return failWith(invalid('non-canonical', 'malformed percent-encoding'));
  }
}

function parseUnchecked(text: string): WikiResult<Destination> {
  if (text.startsWith('page/')) {
    const rest = text.slice('page/'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return failWith(invalid('invalid-destination', 'page destinations need page/<namespace>/<path>'));
    const namespace = rest.slice(0, slash);
    const nsError = checkNamespace(namespace);
    if (nsError !== null) return failWith(nsError);
    const decoded = decodeSegments(rest.slice(slash + 1));
    if (!decoded.ok) return decoded;
    const pathError = checkPagePath(decoded.value);
    if (pathError !== null) return failWith(pathError);
    return ok({ kind: 'page', key: { namespace: namespace as WikiNamespace, path: decoded.value } });
  }
  if (text.startsWith('search?q=')) {
    const encoded = text.slice('search?q='.length);
    let query: string;
    try {
      query = decodeURIComponent(encoded);
    } catch {
      return failWith(invalid('non-canonical', 'malformed percent-encoding'));
    }
    const error = checkQuery(query);
    return error === null ? ok({ kind: 'search', query }) : failWith(error);
  }
  if (text.startsWith('topics/')) {
    const namespace = text.slice('topics/'.length);
    const error = checkNamespace(namespace);
    return error === null ? ok({ kind: 'topics', namespace: namespace as WikiNamespace }) : failWith(error);
  }
  return failWith(invalid('invalid-destination', 'expected page/<namespace>/<path>, search?q=<query> or topics/<namespace>'));
}

/** Parse a destination string. Scheme-like, absolute, non-canonical and malformed forms fail. */
export function parseDestination(text: unknown): WikiResult<Destination> {
  if (typeof text !== 'string') return failWith(invalid('wrong-type', 'destination must be a string'));
  if (text.length === 0) return failWith(invalid('empty', 'destination is empty'));
  if (text.length > MAX_DESTINATION_LENGTH) return failWith(invalid('too-long', `destination exceeds ${MAX_DESTINATION_LENGTH} characters`));
  if (text.includes('\u0000')) return failWith(invalid('nul', 'destination contains NUL'));
  if (hasControlChar(text)) return failWith(invalid('control-character', 'destination contains a control character'));
  if (text.includes('\\')) return failWith(invalid('backslash', 'destination contains a backslash'));
  if (SCHEME_LIKE.test(text)) return failWith(invalid('scheme', 'scheme-like destinations are not navigable'));
  if (text.startsWith('/')) return failWith(invalid('absolute-path', 'destination is absolute'));

  const parsed = parseUnchecked(text);
  if (!parsed.ok) return parsed;
  const canonical = formatChecked(parsed.value);
  if (!canonical.ok) return canonical;
  return canonical.value === text ? parsed : failWith(invalid('non-canonical', 'destination is not in canonical form'));
}

