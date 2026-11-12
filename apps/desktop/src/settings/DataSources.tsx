import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ServiceConfigTransport } from '@hq/contracts/services';
import { validateIndexStatus } from '../../../../modules/wiki/contract/src/index';
import { probePlanner } from '../../../../modules/work/live/health';
import { CHECKING, plannerHealthStatus, NOT_CHECKED, UNAVAILABLE, WIKI_NOT_CHECKED, serviceStatus, type DataSource, type SourceStatus } from '../services/data-source-status';
import { describe, observedStatus, useObservedSnapshot, type ObservedStatusStore, type SourceWording } from '../services/observed-status';
const initial: Record<DataSource, SourceStatus> = { social: CHECKING, work: CHECKING, wiki: WIKI_NOT_CHECKED };
const SOURCES = ['social', 'work', 'wiki'] as const;
/** `statuses` are already described: configuration here, observations from the shared observed-status store. */
type Sources = { statuses: Record<DataSource, SourceWording>; busy: boolean; check: (source: DataSource) => Promise<void>; reload: () => void };
const Context = createContext<Sources | null>(null);
export function DataSourcesProvider({ children, config = window.hqServices?.config, store = observedStatus }: { children: ReactNode; config?: ServiceConfigTransport; store?: ObservedStatusStore }) {
  // Configuration (or a check in progress) per source. What traffic and checks observed lives in `store`.
  const [configured, setConfigured] = useState(initial);
  const [busy, setBusy] = useState(false);
  const activeCheck = useRef<number | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const observed = useObservedSnapshot(store);
  const statuses = useMemo(() => Object.fromEntries(SOURCES.map(source =>
    [source, describe(source, { config: configured[source], observed: observed[source] })])) as Record<DataSource, SourceWording>, [configured, observed]);
  const reload = () => window.dispatchEvent(new Event('hq-connections-changed'));
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      const current = ++generation.current;
      const next = { ...initial };
      for (const source of ['social', 'work'] as const) {
        try { next[source] = serviceStatus(await config?.status(source)); } catch { next[source] = UNAVAILABLE; }
      }
      let wiki: readonly string[] | undefined;
      try {
        const services = window.hqServices;
        if (services?.wikiAdmin) {
          const response = await services.wikiAdmin.call('status', {});
          wiki = response.ok ? response.value.sources.map(source => source.state) : undefined;
        } else {
          const response = await services?.wiki?.indexStatus();
          const result = response?.ok ? validateIndexStatus(response.value) : undefined;
          wiki = result?.ok ? result.value.namespaces.map(source => source.state) : undefined;
        }
      } catch { wiki = undefined; }
      if (alive.current && current === generation.current) { setConfigured(next); store.recordWiki(wiki); }
    };
    void load(); window.addEventListener('hq-connections-changed', load);
    return () => { alive.current = false; ++generation.current; window.removeEventListener('hq-connections-changed', load); };
  }, [config, store]);
  const check = async (source: DataSource) => {
    if (activeCheck.current !== null) return;
    setBusy(true);
    const current = ++generation.current;
    activeCheck.current = current;
    const before = configured[source];
    const release = () => { if (activeCheck.current === current) { activeCheck.current = null; if (alive.current) setBusy(false); } };
    const valid = () => alive.current && current === generation.current;
    const update = (status: SourceStatus) => { if (valid()) setConfigured(previous => ({ ...previous, [source]: status })); };
    /** A finished check is an observation: it lands in the shared store, so every surface shows the same result. */
    const observe = (reachable: boolean) => { if (valid()) store.record(source as 'social' | 'work', reachable ? 'reachable' : 'unreachable'); };
    update(CHECKING);
    let timedOut = false;
    /** The saved configuration, once read; until then a failure means configuration itself was unavailable. */
    let status: SourceStatus | undefined;
    const fail = () => {
      if (source === 'wiki') { update(before); if (valid()) store.recordWiki(undefined); }
      else if (status) { update(status); observe(false); }
      else update(UNAVAILABLE);
    };
    const timer = window.setTimeout(() => { timedOut = true; fail(); release(); }, 10000);
    try {
      if (source === 'wiki') {
        const result = await window.hqServices?.wikiAdmin?.call('recheck', {});
        if (!timedOut) { update(before); if (valid()) store.recordWiki(result?.ok ? result.value.sources.map(value => value.state) : undefined); }
      } else {
        const saved = serviceStatus(await config?.status(source));
        if (saved.text !== NOT_CHECKED.text) { if (!timedOut) update(saved); return; }
        status = saved;
        if (timedOut) return;
        if (source === 'work') {
          const work = window.hqServices?.work;
          if (!work) { if (!timedOut) { update(saved); observe(false); } return; }
          const health = await probePlanner(work);
          if (!timedOut) {
            update(saved);
            if (valid()) store.record('work', health.status === 'unavailable' && health.httpStatus === undefined ? 'unreachable' : 'reachable', plannerHealthStatus(health));
          }
          return;
        }
        const result = await window.hqServices?.social.call('workspace', {});
        if (!timedOut) { update(saved); observe(!!result?.ok && result.status >= 200 && result.status < 300); }
      }
    } catch { if (!timedOut) fail(); }
    finally { window.clearTimeout(timer); release(); }
  };
  return <Context.Provider value={{ statuses, busy, check, reload }}>{children}</Context.Provider>;
}
export function useDataSources(): Sources {
  const value = useContext(Context);
  if (!value) throw new Error('Data sources need their workspace provider');
  return value;
}
