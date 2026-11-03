// Shared test fixtures: a spying service, controllable async, and a persisting-shell host.

import { act, createElement, useState, type ComponentType, type ReactElement } from 'react';
import {
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateListTopicsRequest,
  validateResolveAliasRequest,
  validateSearchRequest,
  WIKI_SERVICE_METHODS,
  type WikiError,
  type WikiResult,
  type WikiService,
} from '../../contract/src/index.ts';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiView, type WikiViewProps } from '../src/index.ts';
import { dom } from './dom.ts';
import { mount, settle, type Mounted } from './render.ts';

export interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Records every property the view reads from the service and every method it calls. */
export function spy(base: WikiService = createSyntheticService()): { service: WikiService; calls: Call[]; touched: Set<string> } {
  const calls: Call[] = [];
  const touched = new Set<string>();
  const service = new Proxy(base, {
    get(target, property, receiver) {
      touched.add(String(property));
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { service, calls, touched };
}

export function override(base: WikiService, patch: Partial<WikiService>): WikiService {
  return { ...base, ...patch };
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Settles a controlled request inside act() so React commits the result before the next assertion. */
export async function release<T>(pending: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value);
  });
  await settle();
}

export type Failure = { readonly ok: false; readonly error: WikiError };

export const fail = (code: WikiError['code'], reason: WikiError['reason'], message = 'synthetic failure'): Failure => ({
  ok: false,
  error: { code, reason, message },
});

/** Every error shape the contract allows a service to return. */
export const ERROR_CASES: readonly { readonly name: string; readonly result: Failure; readonly title: RegExp }[] = [
  { name: 'invalid-input', result: fail('invalid-input', 'out-of-range'), title: /Request rejected/ },
  { name: 'not-found', result: fail('not-found', 'not-found'), title: /Not found/ },
  { name: 'source-unavailable', result: fail('unavailable', 'source-unavailable'), title: /Source unavailable/ },
  { name: 'index-unavailable', result: fail('unavailable', 'index-unavailable'), title: /Index unavailable/ },
  { name: 'internal', result: fail('internal', 'internal'), title: /Something went wrong/ },
];

/** Wraps a service and records any request the contract's own validators would reject. */
export function validating(base: WikiService): { service: WikiService; rejected: string[] } {
  const rejected: string[] = [];
  const check = (method: string, outcome: WikiResult<unknown>): void => {
    if (!outcome.ok) rejected.push(`${method}: ${outcome.error.reason} at ${outcome.error.path ?? '$'}`);
  };
  const service: WikiService = {
    listSources: () => base.listSources(),
    indexStatus: () => base.indexStatus(),
    search: (request) => (check('search', validateSearchRequest(request)), base.search(request)),
    getPage: (request) => (check('getPage', validateGetPageRequest(request)), base.getPage(request)),
    resolveAlias: (request) => (check('resolveAlias', validateResolveAliasRequest(request)), base.resolveAlias(request)),
    getBacklinks: (request) => (check('getBacklinks', validateGetBacklinksRequest(request)), base.getBacklinks(request)),
    listTopics: (request) => (check('listTopics', validateListTopicsRequest(request)), base.listTopics(request)),
  };
  return { service, rejected };
}

export const SERVICE_METHODS: readonly string[] = WIKI_SERVICE_METHODS;

interface ShellProps {
  readonly View: ComponentType<WikiViewProps>;
  readonly initial: string;
  readonly appearance: 'light' | 'dark';
  readonly log: string[];
  /** Destinations longer than this are not persisted, like the mounted shell's 512-character limit. */
  readonly persistLimit: number;
  readonly control: { set: (destination: string) => void; current: string };
}

function Shell(props: ShellProps): ReactElement {
  const [destination, setDestination] = useState(props.initial);
  props.control.current = destination;
  props.control.set = setDestination;
  return createElement(props.View, {
    destination,
    appearance: props.appearance,
    navigate: (requested: string) => {
      props.log.push(requested);
      if (requested.length <= props.persistLimit) setDestination(requested);
    },
  });
}

export interface Launched {
  readonly m: Mounted<ShellProps>;
  readonly container: HTMLElement;
  /** Every destination the view asked the shell to persist. */
  readonly requested: string[];
  /** What the shell currently holds. */
  shell(): string;
  /** An external navigation (e.g. a sidebar click) that the view did not request. */
  external(destination: string): Promise<void>;
  rerenderAppearance(appearance: 'light' | 'dark'): Promise<void>;
  unmount(): Promise<void>;
}

export async function launch(options: { destination?: string; service?: WikiService; appearance?: 'light' | 'dark'; persistLimit?: number } = {}): Promise<Launched> {
  const requested: string[] = [];
  const control = { set: (_destination: string): void => {}, current: options.destination ?? 'home' };
  let props: ShellProps = {
    View: createWikiView(options.service ?? createSyntheticService()),
    initial: options.destination ?? 'home',
    appearance: options.appearance ?? 'light',
    log: requested,
    persistLimit: options.persistLimit ?? 512,
    control,
  };
  const m = await mount(Shell, props);
  await settle();
  return {
    m,
    container: m.container,
    requested,
    shell: () => control.current,
    external: async (destination) => {
      await act(async () => {
        control.set(destination);
      });
      await settle();
    },
    rerenderAppearance: async (appearance) => {
      props = { ...props, appearance };
      await m.rerender(props);
      await settle();
    },
    unmount: () => m.unmount(),
  };
}

/** Failing the test on any attempt to reach outside the process. */
export function trapEgress(): { calls: string[]; restore(): void } {
  const calls: string[] = [];
  const target = dom as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const name of ['open', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    saved.set(name, target[name]);
    target[name] = (..._args: unknown[]) => {
      calls.push(name);
      throw new Error(`${name} must not be used`);
    };
  }
  const globals = globalThis as unknown as Record<string, unknown>;
  const savedFetch = globals['fetch'];
  globals['fetch'] = () => {
    calls.push('fetch');
    throw new Error('fetch must not be used');
  };
  return {
    calls,
    restore: () => {
      for (const [name, value] of saved) target[name] = value;
      globals['fetch'] = savedFetch;
    },
  };
}
