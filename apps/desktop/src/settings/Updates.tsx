import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@hq/ui';
import type { UpdateErrorCode, UpdatePhase, UpdateResult, UpdateStatus, UpdatesPort } from '@hq/contracts/updates';
import './updates.css';

type UpdateAction = 'check' | 'download' | 'cancel-download' | 'preferences' | 'schedule' | 'cancel-scheduled';

const PHASE_LABELS: Record<UpdatePhase, string> = {
  unavailable: 'Updates unavailable',
  idle: 'No update available',
  checking: 'Checking for updates…',
  available: 'Update available',
  downloading: 'Downloading update…',
  verifying: 'Verifying download…',
  ready: 'Ready to install',
  scheduled: 'Installation scheduled',
  held: 'Installation on hold',
  error: 'Update needs attention',
};

const ERROR_MESSAGES: Record<UpdateErrorCode, string> = {
  unavailable: 'Updates are unavailable for this installation.',
  invalid: 'HQ could not accept this update request. Refresh the status before trying again.',
  busy: 'Another update action is in progress. Wait for it to finish before trying again.',
  'stale-candidate': 'The update candidate changed. Review the current version and choose the action again.',
  network: 'HQ could not reach the update service. Check your connection and try again.',
  'rate-limited': 'The update service is limiting requests. Wait before checking again.',
  provenance: 'The update’s source could not be verified. It cannot be installed.',
  integrity: 'The download could not be verified. It cannot be installed.',
  incompatible: 'This update is not compatible with the current installation.',
  space: 'There is not enough free space to prepare this update.',
  cancelled: 'The download was cancelled. No installation was scheduled by this action.',
  permission: 'HQ could not access its update files. The update was not completed.',
  'recovery-required': 'Installation is on hold. Read the recovery status before proceeding.',
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function Timestamp({ value, empty }: { value: string | null; empty: string }) {
  if (!value) return <>{empty}</>;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? <>Unknown</> : <time dateTime={value}>{dateFormatter.format(date)}</time>;
}

function formatBytes(value: number) {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  const unit = bytes >= 1_000_000_000 ? 'GB' : bytes >= 1_000_000 ? 'MB' : bytes >= 1_000 ? 'KB' : 'B';
  const divisor = unit === 'GB' ? 1_000_000_000 : unit === 'MB' ? 1_000_000 : unit === 'KB' ? 1_000 : 1;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`;
}

function phaseDescription(status: UpdateStatus) {
  switch (status.phase) {
    case 'unavailable': return 'This platform, channel or development build does not support updates.';
    case 'idle': return status.lastCheckedAt ? 'No newer compatible HQ update was found at the last check.' : 'Check for updates to see whether a compatible version is available.';
    case 'checking': return 'HQ is looking for a compatible update. You can keep working.';
    case 'available': return 'Download this version to prepare it for installation.';
    case 'downloading': return 'The update is downloading in the background. You can cancel the download.';
    case 'verifying': return 'HQ is checking the downloaded update before it can be scheduled.';
    case 'ready': return 'The download is verified. Choose Install on next launch to accept this exact update.';
    case 'scheduled': return 'This update will install the next time HQ starts, after this session ends. You can cancel before then.';
    case 'held': return 'Installation is paused until the recovery state is resolved.';
    case 'error': return 'The update action did not complete. Review the message below.';
  }
}

export function Updates({ port = window.hqUpdates }: { port?: UpdatesPort }) {
  const id = useId();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(port));
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<UpdateAction[]>([]);
  const lifecycle = useRef(0);
  const statusRevision = useRef(0);
  const latestIntent = useRef(0);
  const inFlight = useRef(new Set<UpdateAction>());
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const generation = ++lifecycle.current;
    let live = true;
    let subscriptionReady = false;
    let unsubscribe: (() => void) | undefined;
    setStatus(null);
    setLoading(Boolean(port));
    setStatusUnknown(false);
    setMessage(null);
    setPending([]);
    inFlight.current.clear();
    const current = () => live && lifecycle.current === generation;
    const receive = (next: UpdateStatus) => {
      if (!current()) return;
      statusRevision.current += 1;
      setStatus(next);
      setLoading(false);
      setStatusUnknown(false);
      setMessage(null);
    };
    const load = async () => {
      if (!port || !current()) return;
      setLoading(true);
      const revision = statusRevision.current;
      try {
        if (!subscriptionReady) {
          unsubscribe = port.subscribe(receive);
          subscriptionReady = true;
        }
        const next = await port.status();
        // A notification can arrive before the initial status request resolves.
        if (current() && revision === statusRevision.current) receive(next);
      } catch {
        if (current() && revision === statusRevision.current) {
          setStatusUnknown(true);
          setMessage('Update status is unavailable. Refresh the status before taking another action.');
        }
      } finally {
        if (current()) setLoading(false);
      }
    };
    refresh.current = () => { void load(); };
    void load();
    return () => {
      live = false;
      lifecycle.current += 1;
      refresh.current = () => {};
      unsubscribe?.();
    };
  }, [port]);

  const run = async (action: UpdateAction, invoke: () => Promise<UpdateResult>) => {
    if (inFlight.current.has(action)) return;
    const cancellingDownload = action === 'cancel-download' && [...inFlight.current].every(item => item === 'download');
    if (inFlight.current.size && !cancellingDownload) return;
    const generation = lifecycle.current;
    const revision = statusRevision.current;
    const intent = ++latestIntent.current;
    inFlight.current.add(action);
    setPending([...inFlight.current]);
    setMessage(null);
    try {
      const result = await invoke();
      if (lifecycle.current !== generation) return;
      if (revision === statusRevision.current) {
        statusRevision.current += 1;
        setStatus(result.status);
        setStatusUnknown(false);
      }
      if (!result.ok && intent === latestIntent.current) setMessage(ERROR_MESSAGES[result.code]);
    } catch {
      if (lifecycle.current === generation && intent === latestIntent.current) {
        setStatusUnknown(true);
        setMessage('HQ could not confirm the result. Refresh the status before taking another action.');
      }
    } finally {
      if (lifecycle.current === generation) {
        inFlight.current.delete(action);
        setPending([...inFlight.current]);
      }
    }
  };

  const busy = pending.length > 0;
  const supported = Boolean(port && status?.supported && status.phase !== 'unavailable');
  const disabled = !supported || loading || statusUnknown || busy;
  const transferring = status?.phase === 'downloading' || status?.phase === 'verifying';
  const cancelDisabled = !supported || statusUnknown || pending.some(action => action !== 'download');
  const candidate = status?.candidate;
  const progress = status?.progress;
  const percentage = progress && progress.total > 0 ? Math.min(100, Math.max(0, Math.round(progress.received / progress.total * 100))) : undefined;
  const progressText = progress ? `${formatBytes(progress.received)}${progress.total > 0 ? ` of ${formatBytes(progress.total)}` : ' downloaded'}` : 'Waiting for download progress…';

  return <section className="updates-settings" aria-labelledby={`${id}-heading`}>
    <div className="settings-section-heading">
      <h2 id={`${id}-heading`}>Updates</h2>
      <p>Prepare an update while you keep working. You choose the exact update to install on a later launch.</p>
      <p>Checking, downloading and scheduling leave HQ open and remote work running.</p>
    </div>

    {!port ? <div className="settings-group"><div className="settings-row"><div className="settings-row-copy">
      <h3>Updates unavailable</h3>
      <p role="status">Update controls and installed identity are unavailable in this window. Browser previews and development windows do not install updates.</p>
    </div></div></div> : <>
      {!status && loading && <p role="status">Loading update status…</p>}
      {message && <div className="updates-notice" role="alert"><p>{message}</p></div>}
      {statusUnknown && <div className="updates-actions"><Button size="sm" disabled={loading || busy} busy={loading} busyLabel="Refreshing…" onClick={() => refresh.current()}>Refresh update status</Button></div>}

      {status && <>
        <div className="settings-group">
          <div className="settings-row">
            <div className="settings-row-copy"><h3>Installed HQ</h3><p>Version {status.installed.version}</p></div>
            <div className="settings-row-control"><Button size="sm" disabled={disabled || transferring || status.phase === 'checking'} busy={pending.includes('check') || status.phase === 'checking'} busyLabel="Checking…" onClick={() => void run('check', () => port.check())}>Check for updates</Button></div>
          </div>
          <dl className="updates-details">
            <div><dt>Source</dt><dd>{status.installed.sourceSha ? <code>{status.installed.sourceSha}</code> : 'Not recorded for this installation'}</dd></div>
            <div><dt>Channel</dt><dd>{status.installed.channel === 'preview' ? 'Preview' : 'Stable'}</dd></div>
            <div><dt>Last checked</dt><dd><Timestamp value={status.lastCheckedAt} empty="Not checked yet" /></dd></div>
          </dl>
        </div>

        <div className="settings-group">
          <div className="settings-row"><div className="settings-row-copy">
            <h3>{status.phase === 'idle' && !status.lastCheckedAt ? 'Ready to check' : PHASE_LABELS[status.phase]}</h3>
            <p role="status">{phaseDescription(status)}</p>
          </div></div>
          {candidate && <div className="updates-candidate">
            <h4>HQ {candidate.version}</h4>
            <dl className="updates-details">
              <div><dt>Source</dt><dd><code>{candidate.sourceSha}</code></dd></div>
              <div><dt>Download</dt><dd>{formatBytes(candidate.size)}</dd></div>
              <div><dt>Published</dt><dd><Timestamp value={candidate.publishedAt} empty="Unknown" /></dd></div>
            </dl>
            {status.phase === 'available' && <div className="updates-actions"><Button size="sm" variant="primary" disabled={disabled} busy={pending.includes('download')} busyLabel="Starting download…" onClick={() => void run('download', () => port.download(candidate.candidateId))}>Download update</Button></div>}
            {status.phase === 'ready' && <div className="updates-actions"><Button size="sm" variant="primary" disabled={disabled} busy={pending.includes('schedule')} busyLabel="Scheduling…" aria-describedby={`${id}-install-note`} onClick={() => void run('schedule', () => port.schedule(candidate.candidateId))}>Install on next launch</Button></div>}
            {(status.phase === 'ready' || status.phase === 'scheduled') && <p id={`${id}-install-note`} className="updates-install-note">Keep working now. Installation starts on the next launch after this session ends. On macOS, an ad-hoc signed update may prompt for Keychain access again.</p>}
          </div>}
          {transferring && <div className="updates-transfer">
            <progress aria-label={status.phase === 'verifying' ? 'Update verification' : 'Update download'} max={100} value={status.phase === 'verifying' ? undefined : percentage} aria-valuetext={status.phase === 'verifying' ? 'Verifying downloaded update' : percentage === undefined ? progressText : `${percentage}% · ${progressText}`} />
            <p>{status.phase === 'verifying' ? 'The download is not ready to install until verification finishes.' : `${percentage === undefined ? '' : `${percentage}% · `}${progressText}`}</p>
            <div className="updates-actions"><Button size="sm" disabled={cancelDisabled} busy={pending.includes('cancel-download')} busyLabel="Cancelling…" onClick={() => void run('cancel-download', () => port.cancelDownload())}>Cancel download</Button></div>
          </div>}
          {status.phase === 'scheduled' && <div className="updates-cancel"><Button size="sm" disabled={disabled} busy={pending.includes('cancel-scheduled')} busyLabel="Cancelling…" onClick={() => void run('cancel-scheduled', () => port.cancelScheduled())}>Cancel scheduled installation</Button></div>}
          {status.error && <div className="updates-notice updates-notice--inline" role="alert"><p>{status.error.message}</p></div>}
          {status.recovery && <div className="updates-recovery" role="status"><h4>Recovery</h4><p>{status.recovery.message}</p><p className="updates-recovery-state">State: {status.recovery.state}</p></div>}
        </div>

        <div className="settings-group" role="group" aria-label="Update preferences">
          <div className="settings-row">
            <div className="settings-row-copy"><h3><label htmlFor={`${id}-automatic`}>Check for updates automatically</label></h3><p id={`${id}-automatic-note`}>Check periodically while HQ is open. You can also check manually.</p>
              {status.preferences.automaticChecks && status.nextCheckAt && <p>Next check: <Timestamp value={status.nextCheckAt} empty="Not scheduled" /></p>}
            </div>
            <div className="settings-row-control"><input id={`${id}-automatic`} type="checkbox" aria-describedby={`${id}-automatic-note`} checked={status.preferences.automaticChecks} disabled={disabled} onChange={event => { const automaticChecks = event.target.checked; void run('preferences', () => port.setPreferences({ ...status.preferences, automaticChecks })); }} /></div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy"><h3><label htmlFor={`${id}-background`}>Download updates in the background</label></h3><p id={`${id}-background-note`}>Download available updates automatically. Installation still requires your choice of an exact update.</p></div>
            <div className="settings-row-control"><input id={`${id}-background`} type="checkbox" aria-describedby={`${id}-background-note`} checked={status.preferences.backgroundDownload} disabled={disabled} onChange={event => { const backgroundDownload = event.target.checked; void run('preferences', () => port.setPreferences({ ...status.preferences, backgroundDownload })); }} /></div>
          </div>
        </div>
      </>}
    </>}
  </section>;
}
