import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@hq/ui';
import { validateIndexStatus } from '../../../modules/wiki/contract/src/index';
import type { ServiceDomain } from '@hq/contracts/services';
import './connections/connections.css';

type Status = { text: string; tone: 'neutral' | 'good' | 'bad' };
const initial: Record<ServiceDomain | 'wiki', Status> = { social: { text: 'Not checked', tone: 'neutral' }, work: { text: 'Not checked', tone: 'neutral' }, wiki: { text: 'Index not checked', tone: 'neutral' } };
export function Connections({ onManage, compact = false }: { onManage: () => void; compact?: boolean }) {
  const [statuses, setStatuses] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      const current = ++generation.current;
      const services = window.hqServices;
      const next = { ...initial };
      for (const domain of ['social', 'work'] as const) {
        try {
          const status = await services?.config?.status(domain);
          next[domain] = { text: status?.configured ? 'Configured · not checked' : 'Not set up', tone: 'neutral' };
        } catch { next[domain] = { text: 'Configuration unavailable', tone: 'bad' }; }
      }
      try {
        const response = await services?.wiki?.indexStatus();
        const result = response?.ok ? validateIndexStatus(response.value) : undefined;
        next.wiki = !result?.ok ? { text: 'Index unavailable', tone: 'bad' } : result.value.namespaces.length === 0 ? { text: 'Not set up', tone: 'neutral' }
          : result.value.namespaces.every(value => value.state === 'ready') ? { text: 'Index ready', tone: 'good' }
          : { text: result.value.namespaces.some(value => value.state === 'stale') ? 'Index stale' : 'Index unavailable', tone: 'bad' };
      } catch { next.wiki = { text: 'Index unavailable', tone: 'bad' }; }
      if (alive.current && generation.current === current) setStatuses(next);
    };
    void load(); window.addEventListener('hq-connections-changed', load);
    return () => { alive.current = false; ++generation.current; window.removeEventListener('hq-connections-changed', load); };
  }, []);
  const recheck = async (domain: ServiceDomain | 'wiki') => {
    if (inflight.current) return;
    inflight.current = true; setBusy(true);
    const current = ++generation.current;
    const update = (status: Status) => { if (alive.current && current === generation.current) setStatuses(previous => ({ ...previous, [domain]: status })); };
    update({ text: 'Checking…', tone: 'neutral' });
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; update({ text: 'Check timed out', tone: 'bad' }); }, 10000);
    try {
      if (domain === 'wiki') {
        const result = await window.hqServices?.wikiAdmin?.call('recheck', {});
        if (!timedOut) update(!result?.ok ? { text: 'Index unavailable', tone: 'bad' } : result.value.sources.every(source => source.state === 'not-configured') ? { text: 'Not set up', tone: 'neutral' }
          : result.value.sources.filter(source => source.state !== 'not-configured').every(source => source.state === 'ready') ? { text: 'Index ready', tone: 'good' } : { text: 'Index unavailable', tone: 'bad' });
      } else {
        const configured = await window.hqServices?.config?.status(domain);
        if (!configured?.configured) { if (!timedOut) update({ text: 'Not set up', tone: 'neutral' }); return; }
        if (timedOut) return;
        const result = domain === 'social' ? await window.hqServices?.social.call('workspace', {}) : await window.hqServices?.work.call('version', {});
        if (!timedOut) update(result?.ok && result.status >= 200 && result.status < 300 ? { text: 'Reachable', tone: 'good' } : { text: 'Unreachable', tone: 'bad' });
      }
    } catch { if (!timedOut) update({ text: domain === 'wiki' ? 'Index unavailable' : 'Unreachable', tone: 'bad' }); }
    finally { window.clearTimeout(timer); inflight.current = false; if (alive.current) setBusy(false); }
  };
  return <section className={`connections${compact ? ' connections--compact' : ''}`} aria-label="Connections">
    {!compact && <div className="connections-heading"><span>Connections</span><IconButton label="Manage connections" icon="⚙" onClick={onManage} size="sm" /></div>}
    {(['social', 'work', 'wiki'] as const).map(domain => {
      const name = domain === 'wiki' ? 'Local Wiki' : domain === 'social' ? 'Social' : 'Work'; const status = statuses[domain];
      return <div key={domain} className={`connection-row connection-row--${status.tone}`} title={`${name}: ${status.text}`}>
        <span aria-hidden="true" className="connection-shape">{status.tone === 'good' ? '●' : status.tone === 'bad' ? '▲' : '○'}</span>
        <span className={compact ? 'connections-sr' : 'connection-copy'}><strong>{name}</strong><span role="status">{status.text}</span></span>
        <IconButton label={`Recheck ${name}: ${status.text}`} icon="↻" size="sm" disabled={busy} onClick={() => void recheck(domain)} />
      </div>;
    })}
    {compact && <IconButton label="Manage connections" icon="⚙" onClick={onManage} size="sm" />}
  </section>;
}
