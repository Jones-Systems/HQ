/**
 * LABELLED FAKES for tests and the local harness. Nothing here is a real shell,
 * store, or execution path; `fake: true` is visible on every object.
 */
import type { DesktopPort, DomainId, ProjectContext, ResolvedAppearance } from '@hq/contracts';
import type { ShellContextPort, ShellContextSnapshot, ShellThemeTokens, UiStatePort } from '../contract.ts';
import { FALLBACK_TOKENS } from './theme.ts';

export interface FakeStorage extends UiStatePort {
  readonly fake: true;
  readonly writes: { key: string; value: string }[];
  readonly data: Map<string, string>;
  failWrites: boolean;
}

export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const storage: FakeStorage = {
    fake: true, writes: [], data, failWrites: false,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (storage.failWrites) throw new Error('fake storage write failure');
      storage.writes.push({ key, value });
      data.set(key, value);
    },
  };
  return storage;
}

export const FAKE_DESKTOP: DesktopPort = Object.freeze({ platform: 'browser', versions: Object.freeze({ electron: null }) });

export interface FakeShell extends ShellContextPort {
  readonly fake: true;
  /** Every project switch Design asked for; the fake applies none automatically. */
  readonly projectRequests: string[];
  readonly requestProjectContext: (projectId: string) => void;
  domain: DomainId;
  readonly destinations: Record<DomainId, string>;
  readonly setAppearance: (appearance: ResolvedAppearance, tokens?: ShellThemeTokens) => void;
  readonly setContext: (context: ProjectContext) => void;
  readonly switchDomain: (domain: DomainId) => void;
  readonly onDomainChange: (listener: (from: DomainId, to: DomainId) => void) => () => void;
}

/**
 * Shell fake: domain switching, per-domain destinations, appearance with
 * tokens, and a recorded (never auto-applied) project-switch request.
 */
export function createFakeShell(context: ProjectContext, appearance: ResolvedAppearance = 'light'): FakeShell {
  let snapshot: ShellContextSnapshot = { context, appearance, tokens: FALLBACK_TOKENS[appearance], desktop: FAKE_DESKTOP };
  const listeners = new Set<() => void>();
  const domainListeners = new Set<(from: DomainId, to: DomainId) => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const shell: FakeShell = {
    fake: true, projectRequests: [], domain: 'design',
    destinations: { design: 'home', social: 'home', work: 'home' },
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    requestProjectContext: (projectId) => { shell.projectRequests.push(projectId); },
    setAppearance: (next, tokens = FALLBACK_TOKENS[next]) => { snapshot = { ...snapshot, appearance: next, tokens }; notify(); },
    setContext: (next) => { snapshot = { ...snapshot, context: next }; notify(); },
    switchDomain: (domain) => {
      const from = shell.domain;
      if (from === domain) return;
      shell.domain = domain;
      for (const listener of [...domainListeners]) listener(from, domain);
    },
    onDomainChange: (listener) => { domainListeners.add(listener); return () => { domainListeners.delete(listener); }; },
  };
  return shell;
}
