import { useEffect, useState } from 'react';
import { Button } from '@hq/ui';
import type { SourceStatus } from '@hq/contracts/catalog';
import type { JonesSelection, JonesStatus } from '@hq/contracts/jones-code';
const changed = () => window.dispatchEvent(new Event('hq-sources-changed'));
export function ProjectSources() {
  const sources = window.hqServices?.sources, jones = window.hqServices?.jonesCode;
  const [rows, setRows] = useState<readonly SourceStatus[]>([]), [status, setStatus] = useState<JonesStatus>();
  const [gallery, setGallery] = useState(''), [sourceLabel, setSourceLabel] = useState('Gallery');
  const [base, setBase] = useState(''), [receiverLabel, setReceiverLabel] = useState('Jones Code');
  const [choices, setChoices] = useState<readonly JonesSelection[]>([]), [project, setProject] = useState('');
  const [threads, setThreads] = useState<readonly JonesSelection[]>([]), [thread, setThread] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function refresh() {
    const [sourceResult, receiverResult] = await Promise.all([sources?.call('status', {}), jones?.call('jonesCode.status', {})]);
    if (sourceResult?.ok) setRows(sourceResult.value); if (receiverResult?.ok) setStatus(receiverResult.value);
  }
  useEffect(() => { void refresh().catch(() => setMessage('Native project settings unavailable.')); }, []);
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await action(); await refresh(); changed(); } catch { setMessage('Action unavailable. Recheck the source or connection; no work was sent.'); } finally { setBusy(false); } }
  return <section aria-label="Project sources" className="wiki-manager">
    <h3>Project sources</h3><p>Enroll local projects, an interactive gallery, or a Jones environment. Refresh reads project metadata; it never runs a project or sends a request.</p>
    {!sources ? <p>Native source enrollment is unavailable in this window.</p> : <>
      <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await sources.call('chooseLocal', {}); if (!result.ok) throw Error(); setRows(result.value); })}>Choose local projects folder…</Button>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const result = await sources.call('enrollGallery', { baseUrl: gallery, label: sourceLabel }); if (!result.ok) throw Error(); setGallery(''); setRows(result.value); }); }}>
        <label>Gallery label<input value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} maxLength={160} required /></label>
        <label>Gallery base URL<input type="url" value={gallery} onChange={event => setGallery(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
        <p>Use the gallery directory URL ending in /. HTTPS or loopback HTTP only. Saved addresses stay in the native app.</p>
        <Button type="submit" size="sm" disabled={busy}>Enroll gallery</Button>
      </form>
      {rows.map(row => <div className="wiki-manager-source" key={row.sourceId}><strong>{row.label}</strong><span>{row.kind} · {row.state} · generation {row.generation}</span>{row.detail && <span>{row.detail}</span>}
        <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await sources.call('refresh', { sourceId: row.sourceId }); if (!result.ok) throw Error(); setRows(result.value); })}>Refresh {row.label}</Button>
        <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await sources.call('remove', { sourceId: row.sourceId }); if (!result.ok) throw Error(); setRows(result.value); })}>Remove enrollment</Button>
      </div>)}
    </>}
    <h3>Jones change requests</h3><p>Connect explicitly in your browser. Credentials stay in protected native storage. Delivery stays unavailable until native qualification.</p>
    {!jones ? <p>Native Jones connection unavailable.</p> : <>
      <label>Saved Jones environment<select value={status?.profiles?.find(profile => profile.active)?.token ?? ''} disabled={busy} onChange={event => void run(async () => { const result = await jones.call('jonesCode.selectProfile', { token: event.target.value }); if (!result.ok) throw Error(); setStatus(result.value); setChoices([]); setThreads([]); })}><option value="">Choose environment</option>{status?.profiles?.map(profile => <option key={profile.token} value={profile.token}>{profile.label}</option>)}</select></label>
      <p role="status">{status?.state ?? 'Checking connection'} · {status?.descriptor.qualification.level ?? 'unqualified'}</p>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const result = await jones.call('jonesCode.configure', { baseUrl: base, label: receiverLabel }); if (!result.ok) throw Error(); setStatus(result.value); setBase(''); setChoices([]); setThreads([]); }); }}>
        <label>Environment label<input value={receiverLabel} onChange={event => setReceiverLabel(event.target.value)} required maxLength={160} /></label>
        <label>Jones server URL<input type="url" value={base} onChange={event => setBase(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
        <Button type="submit" size="sm" disabled={busy}>Save Jones connection</Button>
      </form>
      <Button size="sm" disabled={busy || status?.state === 'not-configured'} onClick={() => void run(async () => { const result = await jones.call('jonesCode.authorize', {}); if (!result.ok) throw Error(); setStatus(result.value); })}>Authorize in browser…</Button>
      <Button size="sm" disabled={busy || status?.state !== 'connected'} onClick={() => void run(async () => { const result = await jones.call('jonesCode.projects', {}); if (!result.ok) throw Error(); setChoices(result.value); setProject(''); setThreads([]); })}>Read Jones projects</Button>
      <Button size="sm" disabled={busy || status?.state !== 'connected' || !sources} onClick={() => void run(async () => { const result = await sources!.call('enrollJones', { label: receiverLabel }); if (!result.ok) throw Error(); setRows(result.value); })}>Enroll Jones projects</Button>
      {choices.length > 0 && <><label>Request destination project<select value={project} onChange={event => { setProject(event.target.value); setThreads([]); setThread(''); }}><option value="">Select project</option>{choices.map(choice => <option key={choice.token} value={choice.token}>{choice.label}</option>)}</select></label>
        <Button size="sm" disabled={busy || !project} onClick={() => void run(async () => { const result = await jones.call('jonesCode.bind', { token: project, mode: 'new-thread', label: choices.find(choice => choice.token === project)!.label }); if (!result.ok) throw Error(); setStatus(result.value); })}>Save new-thread destination</Button>
        <Button size="sm" disabled={busy || !project} onClick={() => void run(async () => { const result = await jones.call('jonesCode.listThreads', { token: project }); if (!result.ok) throw Error(); setThreads(result.value); })}>Read existing threads</Button>
      </>}
      {threads.length > 0 && <><label>Existing thread<select value={thread} onChange={event => setThread(event.target.value)}><option value="">Select thread</option>{threads.map(choice => <option key={choice.token} value={choice.token}>{choice.label}</option>)}</select></label>
        <Button size="sm" disabled={busy || !thread} onClick={() => void run(async () => { const result = await jones.call('jonesCode.bind', { token: thread, mode: 'existing-thread', label: threads.find(choice => choice.token === thread)!.label }); if (!result.ok) throw Error(); setStatus(result.value); })}>Save existing-thread destination</Button></>}
      {status?.destinations.map(destination => <p key={destination.destinationId}>{destination.label} · {destination.mode} · {destination.deliveryQualified ? destination.status : destination.deliveryReason}</p>)}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
