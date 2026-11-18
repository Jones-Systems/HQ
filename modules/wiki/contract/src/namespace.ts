import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

/** Schema identifier carried by every source descriptor. */
export const SOURCE_SCHEMA_ID = 'hq.wiki.source/v1';

/** `bl` = BusinessLessons, `appdev` = the App-Development research corpus. Records never merge across namespaces. */
export const NAMESPACES = ['bl', 'appdev'] as const;

export type WikiNamespace = (typeof NAMESPACES)[number];

export function isNamespace(value: unknown): value is WikiNamespace {
  return typeof value === 'string' && (NAMESPACES as readonly string[]).includes(value);
}

export function checkNamespace(value: unknown, path: string = '$'): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'namespace must be a string', path);
  if (!isNamespace(value)) return invalid('unknown-namespace', `namespace must be one of ${NAMESPACES.join(', ')}`, path);
  return null;
}

export function validateNamespace(value: unknown): WikiResult<WikiNamespace> {
  return resultOf(checkNamespace(value), value as WikiNamespace);
}
