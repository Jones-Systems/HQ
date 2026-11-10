/**
 * Browser-side request observation for the preview page. It records what this
 * document loads (Resource Timing) and what its CSP blocks, and classifies each
 * URL as loopback/same-origin, inline data, or UNEXPECTED. It observes; it does
 * not block or wrap any API. Frames, workers and browser-internal traffic are
 * outside its view, so it supports the observed session only and is not a
 * network-isolation proof.
 */

export type EgressClass = 'same-origin' | 'loopback' | 'inline' | 'unexpected';

export interface EgressEntry {
  readonly url: string;
  readonly initiator: string;
  readonly kind: 'resource' | 'csp-violation';
  readonly classification: EgressClass;
  readonly directive?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function classifyUrl(url: string, origin: string): EgressClass {
  if (url === '' || url === 'inline' || url === 'eval' || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:srcdoc') return 'inline';
  let parsed: URL;
  try { parsed = new URL(url, origin); } catch { return 'unexpected'; }
  if (parsed.origin === origin) return 'same-origin';
  if ((parsed.protocol === 'ws:' || parsed.protocol === 'http:') && LOOPBACK_HOSTS.has(parsed.hostname)) return 'loopback';
  return 'unexpected';
}

export interface EgressLog {
  readonly entries: () => readonly EgressEntry[];
  readonly unexpected: () => readonly EgressEntry[];
  readonly subscribe: (listener: () => void) => () => void;
}

export function observeEgress(target: Window): EgressLog {
  const entries: EgressEntry[] = [];
  const listeners = new Set<() => void>();
  const origin = target.location.origin;
  const push = (entry: EgressEntry) => {
    entries.push(entry);
    if (entry.classification === 'unexpected') console.error('[hqd-preview] UNEXPECTED request', entry);
    for (const listener of [...listeners]) listener();
  };
  const observer = new PerformanceObserver((list) => {
    for (const item of list.getEntries() as PerformanceResourceTiming[]) {
      push({ url: item.name, initiator: item.initiatorType, kind: 'resource', classification: classifyUrl(item.name, origin) });
    }
  });
  observer.observe({ type: 'resource', buffered: true });
  target.document.addEventListener('securitypolicyviolation', (event) => {
    push({
      url: event.blockedURI, initiator: event.sourceFile || 'document', kind: 'csp-violation',
      classification: classifyUrl(event.blockedURI, origin), directive: event.effectiveDirective,
    });
  });
  return {
    entries: () => entries,
    unexpected: () => entries.filter((entry) => entry.classification === 'unexpected'),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
