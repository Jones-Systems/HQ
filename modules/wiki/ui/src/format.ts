// Display helpers: namespace names, short commits and plain-language error text. Pure; no DOM.

import type { WikiError, WikiNamespace } from '../../contract/src/index.ts';

/** Accepted display map for the contract namespaces. */
export const NAMESPACE_LABELS: Readonly<Record<WikiNamespace, string>> = {
  bl: 'BusinessLessons',
  appdev: 'App Development',
};

export function namespaceLabel(namespace: string): string {
  return Object.hasOwn(NAMESPACE_LABELS, namespace) ? NAMESPACE_LABELS[namespace as WikiNamespace] : namespace;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

/** Bounded, control-free excerpt of untrusted text for a notice. Always rendered as a React text child. */
export function excerpt(text: string, max = 80): string {
  const points = Array.from(text.replace(CONTROL, '�'));
  return points.length > max ? `${points.slice(0, max).join('')}…` : points.join('');
}

export interface ErrorText {
  readonly title: string;
  readonly detail: string;
}

/** One plain-language heading per error code (and per `unavailable` reason). The service's own message is shown separately. */
export function describeError(error: WikiError): ErrorText {
  switch (error.code) {
    case 'invalid-input':
      return { title: 'Request rejected', detail: 'The Wiki rejected this request as invalid.' };
    case 'not-found':
      return { title: 'Not found', detail: 'This item is not in the pinned source.' };
    case 'unavailable':
      if (error.reason === 'source-unavailable') {
        return { title: 'Source unavailable', detail: 'The repository for this item could not be read.' };
      }
      if (error.reason === 'index-unavailable') {
        return { title: 'Index unavailable', detail: 'The search and link index is not ready yet.' };
      }
      return { title: 'Wiki unavailable', detail: 'The Wiki cannot answer right now.' };
    default:
      return { title: 'Something went wrong', detail: 'The Wiki failed unexpectedly.' };
  }
}

/** Synthesised when a response is malformed or fails the contract validators. */
export function invalidResponse(message: string): WikiError {
  return { code: 'internal', reason: 'internal', message };
}
