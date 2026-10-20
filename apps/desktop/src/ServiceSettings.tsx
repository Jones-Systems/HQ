import { useEffect, useState } from 'react';
import { Dialog } from '@hq/ui';
import type { ServiceConfigStatus, ServiceConfigTransport, ServiceDomain } from '@hq/contracts/services';

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
    event.preventDefault(); setBusy(true); setFailed(false);
    try { setStatus(await config.set({ domain, baseUrl: input })); setInput(''); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }}>
    <h3>{domain === 'social' ? 'Social' : 'Work'}</h3>
    <p role="status">{failed ? 'Settings unavailable.' : !status ? 'Checking configuration…' : status.policy === 'rejected'
      ? 'Configuration rejected. Use HTTPS or HTTP on localhost, 127.0.0.1 or ::1, without credentials, query or fragment. The setting must also be saved successfully.'
      : status.configured ? `Configured (${status.transport === 'https' ? 'HTTPS' : 'loopback HTTP'}).` : 'Not connected.'}</p>
    <label htmlFor={`service-${domain}`}>New {domain} base URL</label>
    <input id={`service-${domain}`} type="url" autoComplete="off" spellCheck={false} value={input} onChange={event => setInput(event.target.value)} disabled={busy} required />
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : `Save ${domain} configuration`}</button>
  </form>;
}
/** Explicitly opened; existing endpoints are never read back into this renderer. */
export function ServiceSettings({ config, onClose }: { config: ServiceConfigTransport; onClose: () => void }) {
  return <Dialog open title="Service settings" onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
    <DomainSettings domain="social" config={config} />
    <DomainSettings domain="work" config={config} />
  </Dialog>;
}
