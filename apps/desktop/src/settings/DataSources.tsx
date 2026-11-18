import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ServiceConfigTransport } from '@hq/contracts/services';
import { validateIndexStatus } from '../../../../modules/wiki/contract/src/index';
import { CHECKING, UNAVAILABLE, checkedServiceStatus, serviceStatus, wikiStatus, type DataSource, type SourceStatus } from '../services/data-source-status';
const initial: Record<DataSource, SourceStatus> = { social: CHECKING, work: CHECKING, wiki: { text: 'Index not checked', tone: 'neutral' } };
type Sources = { statuses: Record<DataSource, SourceStatus>; busy: boolean; check: (source: DataSource) => Promise<void>; reload: () => void };
const Context = createContext<Sources | null>(null);
export function DataSourcesProvider({ children, config = window.hqServices?.config }: { children: ReactNode; config?: ServiceConfigTransport }) {
  const [statuses, setStatuses] = useState(initial);
  const [busy, setBusy] = useState(false);
  const activeCheck = useRef<number | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const reload = () => window.dispatchEvent(new Event('hq-connections-changed'));
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      const current = ++generation.current;
      const next = { ...initial };
      for (const source of ['social', 'work'] as const) {
        try { next[source] = serviceStatus(await config?.status(source)); } catch { next[source] = UNAVAILABLE; }
      }
      try {
        const services = window.hqServices;
        if (services?.wikiAdmin) {
          const response = await services.wikiAdmin.call('status', {});
          next.wiki = wikiStatus(response.ok ? response.value.sources.map(source => source.state) : undefined);
        } else {
          const response = await services?.wiki?.indexStatus();
          const result = response?.ok ? validateIndexStatus(response.value) : undefined;
          next.wiki = wikiStatus(result?.ok ? result.value.namespaces.map(source => source.state) : undefined);
        }
      } catch { next.wiki = wikiStatus(undefined); }
      if (alive.current && current === generation.current) setStatuses(next);
    };
    void load(); window.addEventListener('hq-connections-changed', load);
    return () => { alive.current = false; ++generation.current; window.removeEventListener('hq-connections-changed', load); };
  }, [config]);
  const check = async (source: DataSource) => {
    if (activeCheck.current !== null) return;
    setBusy(true);
    const current = ++generation.current;
    activeCheck.current = current;
    const release = () => { if (activeCheck.current === current) { activeCheck.current = null; if (alive.current) setBusy(false); } };
    const update = (status: SourceStatus) => { if (alive.current && current === generation.current) setStatuses(previous => ({ ...previous, [source]: status })); };
    update(CHECKING);
    let timedOut = false;
    const failure = source === 'wiki' ? wikiStatus(undefined) : checkedServiceStatus(false);
    const timer = window.setTimeout(() => { timedOut = true; update(failure); release(); }, 10000);
    try {
      if (source === 'wiki') {
        const result = await window.hqServices?.wikiAdmin?.call('recheck', {});
        if (!timedOut) update(wikiStatus(result?.ok ? result.value.sources.map(value => value.state) : undefined));
      } else {
        const configured = serviceStatus(await config?.status(source));
        if (configured.text !== 'Set up · not checked') { if (!timedOut) update(configured); return; }
        if (timedOut) return;
        const result = source === 'social' ? await window.hqServices?.social.call('workspace', {}) : await window.hqServices?.work.call('version', {});
        if (!timedOut) update(checkedServiceStatus(!!result?.ok && result.status >= 200 && result.status < 300));
      }
    } catch { if (!timedOut) update(failure); }
    finally { window.clearTimeout(timer); release(); }
  };
  return <Context.Provider value={{ statuses, busy, check, reload }}>{children}</Context.Provider>;
}
export function useDataSources(): Sources {
  const value = useContext(Context);
  if (!value) throw new Error('Data sources need their workspace provider');
  return value;
}
