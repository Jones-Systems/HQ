import { useEffect, useState } from 'react';
import { Button, Dialog, IconButton } from '@hq/ui';
import type { ServiceConfigStatus, ServiceConfigTransport, ServiceDomain } from '@hq/contracts/services';
import type { WikiAdminStatus, WikiAdminTransport, WikiSelection, WikiAdminNamespace } from '@hq/contracts/wiki-admin';
import './connections/connections.css';
const changed = () => window.dispatchEvent(new Event('hq-connections-changed'));
function DomainSettings({ domain, config }: { domain: ServiceDomain; config: ServiceConfigTransport }) {
  const [status, setStatus] = useState<ServiceConfigStatus | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void config.status(domain).then(value => { if (live) setStatus(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [domain, config]);
  return <form onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setFailed(false);
    try { setStatus(await config.set({ domain, baseUrl: input })); setInput(''); changed(); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }}>
    <h3>{domain === 'social' ? 'Social' : 'Work'}</h3>
    <p role="status">{failed ? 'Settings unavailable.' : !status ? 'Checking configuration…' : status.policy === 'rejected'
      ? 'Configuration rejected. Use HTTPS or HTTP on localhost, 127.0.0.1 or ::1, without credentials, query or fragment. The setting must also be saved successfully.'
      : status.configured ? 'Configured · not checked' : 'Not set up'}</p>
    <label htmlFor={`service-${domain}`}>New {domain} base URL</label>
    <input id={`service-${domain}`} type="url" autoComplete="off" spellCheck={false} value={input} onChange={event => setInput(event.target.value)} disabled={busy} required />
    <Button type="submit" size="sm" disabled={busy} busy={busy} busyLabel="Saving…">Save {domain} configuration</Button>
  </form>;
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
/** Explicitly opened; existing endpoints are never read back into this renderer. */
export function ServiceSettings({ config, onClose }: { config?: ServiceConfigTransport; onClose: () => void }) {
  return <Dialog open title="Service settings" onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
    <div className="connection-manager">
      {config ? <><DomainSettings domain="social" config={config} /><DomainSettings domain="work" config={config} /></> : <p role="status">Service configuration is unavailable in this window.</p>}
      <WikiSettings admin={window.hqServices?.wikiAdmin} />
    </div>
  </Dialog>;
}
