import { ProjectSources } from './settings/ProjectSources';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@hq/ui';
import type { Appearance } from '@hq/contracts';
import type { ServiceConfigTransport, ServiceDomain } from '@hq/contracts/services';
import type { WikiAdminStatus, WikiAdminTransport, WikiSelection, WikiAdminNamespace } from '@hq/contracts/wiki-admin';
import { SOURCE_NAMES, type DataSource } from './services/data-source-status';
import { useDataSources } from './settings/DataSources';
import './connections/connections.css';
import './settings/settings.css';
const changed = () => window.dispatchEvent(new Event('hq-connections-changed'));
function DomainSettings({ domain, config, selected }: { domain: ServiceDomain; config?: ServiceConfigTransport; selected: boolean }) {
  const { statuses, busy: checking, check, reload } = useDataSources();
  const status = statuses[domain];
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = SOURCE_NAMES[domain];
  return <section id={`settings-${domain}`} className={`settings-source${selected ? ' is-target' : ''}`} aria-label={`${name} data source`}>
    <div className="settings-row">
      <div className="settings-row-copy"><h3>{name}</h3>
        <p>{domain === 'social' ? 'Content, drafts and calendar planning through the Social service.' : 'Tasks and planning through the Work service.'}</p>
        <p role="status" className={`source-status source-status--${status.tone}`}>{status.text}</p>
      </div>
      <div className="settings-row-control"><Button size="sm" disabled={!config || busy || checking || status.text === 'Checking…'} onClick={() => void check(domain)} aria-label={`Check ${name} connection`}>Check connection</Button></div>
    </div>
    {!config ? <p className="settings-row-note" role="status">Service configuration is unavailable in this window.</p> : <div className="settings-source-edit">
      <Button size="sm" variant="ghost" aria-expanded={editing} aria-controls={`address-form-${domain}`} onClick={() => setEditing(value => !value)}>Change {name} address</Button>
      {editing && <form id={`address-form-${domain}`} onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setFailed(false);
        try { await config.set({ domain, baseUrl: input }); setInput(''); reload(); }
        catch { setFailed(true); }
        finally { setBusy(false); }
      }}>
        <label htmlFor={`service-${domain}`}>New {domain} base URL</label>
        <input id={`service-${domain}`} type="url" autoComplete="off" spellCheck={false} value={input} onChange={event => setInput(event.target.value)} disabled={busy} required />
        <p>Use HTTPS, or HTTP on localhost, 127.0.0.1 or ::1. Addresses must not include credentials, a query or a fragment. Saved addresses stay in the native app.</p>
        <Button type="submit" size="sm" disabled={busy} busy={busy} busyLabel="Saving…">Save {domain} configuration</Button>
        {failed && <p role="status">Settings unavailable. Check configuration before trying again.</p>}
      </form>}
      {status.text === 'Address rejected' && <p role="status">Address rejected. Use an allowed address and save it successfully.</p>}
    </div>}
  </section>;
}
const labels = { ready: 'Index ready', stale: 'Index stale', indexing: 'Indexing', 'index-unavailable': 'Index unavailable', 'source-unavailable': 'Source unavailable', 'not-configured': 'Not set up' };
function WikiSettings({ admin }: { admin?: WikiAdminTransport }) {
  const [status, setStatus] = useState<WikiAdminStatus>();
  const [selection, setSelection] = useState<WikiSelection>();
  const [confirm, setConfirm] = useState<WikiAdminNamespace>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void admin?.call('status', {}).then(result => { if (live) { if (result.ok) setStatus(result.value); else setMessage('Wiki settings unavailable. Recheck to reopen.'); } }, () => { if (live) setMessage('Wiki settings unavailable. Recheck to reopen.'); });
    return () => { live = false; };
  }, [admin]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage('');
    try { await action(); } catch { setMessage('Wiki settings unavailable. Recheck before trying again.'); }
    finally { setBusy(false); }
  };
  const failure = (kind: string) => setMessage(kind === 'conflict' ? 'Configuration changed. Recheck, then select the source again.' : kind === 'source-unavailable' ? 'Source unavailable. Check that the selected bare repository matches the profile’s remote and branch.' : 'Could not complete this action. Recheck, then import or choose the source again.');
  return <section className="wiki-manager" aria-label="Wiki source settings">
    <h3>Local Wiki</h3>
    <p>Uses local bare Git repositories. Remote VPS and Mac Mini Wiki transports are not supported. An unavailable index does not indicate a host outage.</p>
    {!admin ? <p role="status">Native Wiki management is unavailable in this window.</p> : <>
      <div className="wiki-manager-actions">
        <Button size="sm" disabled={busy} onClick={() => void run(async () => {
          const result = await admin.call('importProfile', {}); if (result.ok) { if (result.value) setSelection(result.value); } else failure(result.kind);
        })}>Import source profile…</Button>
        <IconButton label="Recheck local Wiki sources" icon="↻" disabled={busy} onClick={() => void run(async () => {
          setSelection(undefined); const result = await admin.call('recheck', {}); if (result.ok) { setStatus(result.value); changed(); } else failure(result.kind);
        })} />
      </div>
      <p>Import a complete source profile JSON to preserve its namespace, remote, branch and field mappings. Paths stay in the native app.</p>
      {selection && <div className="wiki-manager-source"><span>Selected {selection.namespace}: {selection.label}</span>
        <Button size="sm" disabled={busy} onClick={() => void run(async () => {
          const result = await admin.call('chooseRepository', { namespace: selection.namespace, token: selection.token }); if (result.ok) { if (result.value) setSelection(result.value); } else { setSelection(undefined); failure(result.kind); }
        })}>Choose repository…</Button>
        <Button size="sm" variant="primary" disabled={busy || !status} onClick={() => void run(async () => {
          if (!status) return; const result = await admin.call('saveSource', { expectedRevision: status.revision, token: selection.token }); setSelection(undefined);
          if (result.ok) { setStatus(result.value); changed(); } else failure(result.kind);
        })}>Save source</Button>
      </div>}
      {status?.sources.map(source => <div className="wiki-manager-source" key={source.namespace}>
        <span><strong>{source.namespace}</strong> · {labels[source.state]}</span>
        {source.state !== 'not-configured' && <>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await admin.call('chooseRepository', { namespace: source.namespace }); if (result.ok) { if (result.value) setSelection(result.value); } else failure(result.kind); })}>Choose repository…</Button>
          <IconButton label={`Reindex ${source.namespace}`} icon="↻" disabled={busy} onClick={() => void run(async () => { const result = await admin.call('reindex', { namespace: source.namespace }); if (result.ok) { setStatus(result.value); changed(); } else failure(result.kind); })} />
          <Button size="sm" disabled={busy} onClick={() => setConfirm(source.namespace)}>Remove source</Button>
        </>}
      </div>)}
      {confirm && <div role="group" aria-label={`Confirm removal of ${confirm}`}><p>Remove {confirm} from HQ? Repository files remain on disk.</p><div className="wiki-manager-actions">
        <Button variant="danger" size="sm" disabled={busy || !status} onClick={() => void run(async () => { if (!status) return; const result = await admin.call('removeSource', { namespace: confirm, expectedRevision: status.revision, confirmed: true }); setConfirm(undefined); setSelection(undefined); if (result.ok) { setStatus(result.value); changed(); } else failure(result.kind); })}>Confirm remove source</Button>
        <Button size="sm" disabled={busy} onClick={() => setConfirm(undefined)}>Cancel</Button>
      </div></div>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
type SettingsCategory = 'sources' | 'appearance';
const CATEGORIES: readonly { id: SettingsCategory; label: string }[] = [{ id: 'sources', label: 'Data sources' }, { id: 'appearance', label: 'Appearance' }];
/** Existing endpoint values stay in native configuration and are never read into this page. */
export function ServiceSettings({ config, onClose, returnLabel = 'Design', target = null, appearance = 'system', onAppearanceChange }: {
  config?: ServiceConfigTransport; onClose: () => void; returnLabel?: string; target?: DataSource | 'appearance' | null;
  appearance?: Appearance; onAppearanceChange?: (value: Appearance) => void;
}) {
  const [category, setCategory] = useState<SettingsCategory>(target === 'appearance' ? 'appearance' : 'sources');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    setCategory(target === 'appearance' ? 'appearance' : 'sources');
  }, [target]);
  useEffect(() => {
    if (target && target !== 'appearance' && category === 'sources') document.getElementById(`settings-${target}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [target, category]);
  return <section className="settings-page" role="region" aria-label="Settings page" onKeyDown={event => {
    const element = event.target;
    if (event.key === 'Escape' && !event.defaultPrevented && !(element instanceof HTMLElement && element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) {
      event.preventDefault(); onClose();
    }
  }}>
    <header className="settings-header"><div><span>{returnLabel}</span><span aria-hidden="true"> / </span><h1 ref={heading} tabIndex={-1}>Settings</h1></div><Button size="sm" variant="ghost" onClick={onClose}>← Back to {returnLabel}</Button></header>
    <div className="settings-layout">
      <nav className="settings-categories" aria-label="Settings categories">{CATEGORIES.map(item => <button key={item.id} aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
      <div className="settings-scroll"><div className="settings-content">
        {category === 'sources' ? <>
          <div className="settings-section-heading"><h2>Data sources</h2><p>Choose where HQ gets its data. Social and Work use service addresses; Local Wiki uses repositories on this device. These are data sources, not device, SSH or environment connections.</p><p>Without a configured service, Social and Work show sample data kept only in this window. Local Wiki has no sample-data mode. After changing a service address, reload HQ to use it in that domain.</p></div>
          <div className="settings-group"><DomainSettings domain="social" config={config} selected={target === 'social'} /><DomainSettings domain="work" config={config} selected={target === 'work'} /></div>
          <div className="settings-group"><ProjectSources /></div>
          <div id="settings-wiki" className={`settings-group${target === 'wiki' ? ' is-target' : ''}`}><WikiSettings admin={window.hqServices?.wikiAdmin} /></div>
        </> : <>
          <div className="settings-section-heading"><h2>Appearance</h2><p>Choose a light or dark workspace, or follow your device. Captured designs keep their own appearance.</p></div>
          <div className="settings-group"><div className="settings-row"><div className="settings-row-copy"><h3>Color theme</h3><p>System follows changes to your device’s appearance.</p></div><div className="settings-row-control"><div className="settings-theme-options" role="group" aria-label="Color theme">{(['light', 'dark', 'system'] as const).map(mode => <Button key={mode} size="sm" aria-pressed={appearance === mode} onClick={() => onAppearanceChange?.(mode)}>{mode[0]!.toUpperCase() + mode.slice(1)}</Button>)}</div></div></div></div>
        </>}
      </div></div>
    </div>
  </section>;
}
