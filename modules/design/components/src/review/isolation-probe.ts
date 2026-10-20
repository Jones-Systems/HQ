import { scriptJson } from '../model/html.ts';
import { SANDBOX_CHANNEL } from './sandbox-document.ts';

/**
 * Review-only isolation probe. Appended to a sandbox document, it tries to
 * reach the host and reports each outcome. A runtime check passes when every
 * host reach is `blocked:*` or `absent` and the frame origin is opaque.
 */
export const PROBE_EXPECTATIONS: Readonly<Record<string, (result: string) => boolean>> = {
  'parent.document': (result) => result.startsWith('blocked:'),
  'parent.hqDesktop': (result) => result.startsWith('blocked:'),
  'top.hqDesktop': (result) => result.startsWith('blocked:'),
  'parent.location.href': (result) => result.startsWith('blocked:'),
  'self.hqDesktop': (result) => result === 'absent',
  'self.require': (result) => result === 'absent',
  'self.process': (result) => result === 'absent',
  frameElement: (result) => result === 'null',
  origin: (result) => result === 'null',
  cookie: (result) => result.startsWith('blocked:'),
  localStorage: (result) => result.startsWith('blocked:'),
  'window.open': (result) => result === 'null' || result.startsWith('blocked:'),
  fetch: (result) => result.startsWith('blocked:'),
};

export function isolationProbeScript(nonce: string): string {
  return `(async () => {
  const results = {};
  const reach = (name, read) => {
    try { read(); results[name] = 'reachable'; }
    catch (error) { results[name] = 'blocked:' + ((error && error.name) || 'Error'); }
  };
  const presence = (name, holder, key) => { results[name] = key in holder ? 'present' : 'absent'; };
  reach('parent.document', () => parent.document.title);
  reach('parent.hqDesktop', () => parent.hqDesktop.platform);
  reach('top.hqDesktop', () => top.hqDesktop.platform);
  reach('parent.location.href', () => parent.location.href);
  presence('self.hqDesktop', self, 'hqDesktop');
  presence('self.require', self, 'require');
  presence('self.process', self, 'process');
  results.frameElement = String(window.frameElement);
  results.origin = String(self.origin);
  reach('cookie', () => document.cookie);
  reach('localStorage', () => localStorage.length);
  try { results['window.open'] = String(window.open('about:blank')); }
  catch (error) { results['window.open'] = 'blocked:' + ((error && error.name) || 'Error'); }
  try { await fetch('https://hq-probe.invalid/'); results.fetch = 'reachable'; }
  catch (error) { results.fetch = 'blocked:' + ((error && error.name) || 'Error'); }
  parent.postMessage({ channel: ${scriptJson(SANDBOX_CHANNEL)}, nonce: ${scriptJson(nonce)}, type: 'probe', detail: results }, '*');
})();`;
}

export interface ProbeVerdict {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly missing: readonly string[];
}

export function judgeProbe(results: Readonly<Record<string, string>>): ProbeVerdict {
  const failures: string[] = [];
  const missing: string[] = [];
  for (const [name, expectation] of Object.entries(PROBE_EXPECTATIONS)) {
    const result = results[name];
    if (result === undefined) missing.push(name);
    else if (!expectation(result)) failures.push(`${name}=${result}`);
  }
  return { passed: failures.length === 0 && missing.length === 0, failures, missing };
}
