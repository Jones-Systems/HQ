import { Button } from '@hq/ui';
import { useId, useRef, useState } from 'react';
import { APP_PLATFORMS } from '../../../references/src/contract.ts';
import { platformName } from '../../../references/src/provenance.ts';
import type { ReferencesEnvironment, ScreenshotDetails } from './env.ts';

export function ScreenshotImport({ env, disabled }: { readonly env: ReferencesEnvironment; readonly disabled: boolean }) {
  const id = useId();
  const chooser = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [sourceKind, setSourceKind] = useState<'url' | 'app'>('url');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<(typeof APP_PLATFORMS)[number]>('ios');
  const [appName, setAppName] = useState('');
  const [appId, setAppId] = useState('');
  const [screen, setScreen] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [captureEdited, setCaptureEdited] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const canSubmit = file !== null && title.trim() !== '' && (sourceKind === 'url' ? url.trim() !== '' : appName.trim() !== '' && appId.trim() !== '');
  const submit = async () => {
    if (!file || busy || disabled || needsReload) return;
    const captureDate = new Date(capturedAt);
    if (captureEdited && !Number.isFinite(captureDate.getTime())) { setFeedback({ error: true, message: 'Choose a valid capture date and time.' }); return; }
    setBusy(true); setFeedback(null);
    const details: ScreenshotDetails = { title, ...(captureEdited ? { capturedAt: captureDate.toISOString() } : {}), source: sourceKind === 'url' ? { kind: 'url', url: url.trim() }
      : { kind: 'app', platform, appName: appName.trim(), appId: appId.trim(), ...(screen.trim() ? { screen: screen.trim() } : {}) } };
    try {
      const result = await env.importScreenshot(file, details);
      if ('message' in result) { setFeedback({ error: true, message: result.message }); setNeedsReload(result.status === 'unknown'); }
      else {
        setFile(null);
        const message = result.status === 'saved' ? 'Screenshot saved to your library.'
          : result.status === 'tombstoned' ? 'This screenshot was previously removed. It has been kept removed.'
            : 'This screenshot is already in your library. Your title, notes and rights have been kept.';
        setFeedback({ error: false, message: result.graphReady ? message : `${message} Its site or app grouping could not be updated; the saved image is safe.` });
      }
    } catch { setNeedsReload(true); setFeedback({ error: true, message: 'The import outcome could not be confirmed. Reload the library before importing again.' }); }
    finally { setBusy(false); }
  };
  return <div className="hq-refs-import">
    <input ref={chooser} id={`${id}-file`} type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={disabled || busy || needsReload}
      aria-label="Choose a screenshot to import" onChange={(event) => {
        const selected = event.currentTarget.files?.[0] ?? null;
        setFile(selected); setFeedback(null);
        if (selected) {
          setTitle(selected.name.replace(/\.[^.]+$/u, '').slice(0, 300));
          const date = new Date(selected.lastModified);
          const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
          setCapturedAt(Number.isFinite(local.getTime()) ? local.toISOString().slice(0, 16) : '');
          setCaptureEdited(false);
        }
        event.currentTarget.value = '';
      }} />
    <Button variant="primary" disabled={disabled || busy || needsReload} onClick={() => chooser.current?.click()}>Import screenshots</Button>
    <div className="hq-refs-import-panel">
    {feedback && <p className="hq-refs-import-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
    {needsReload && <Button disabled={busy} onClick={() => {
      setBusy(true);
      void env.library.reload().then(() => { setNeedsReload(false); setFeedback({ error: false, message: 'Saved library reloaded. Check for your screenshot before importing again.' }); })
        .catch(() => setFeedback({ error: true, message: 'The saved library could not be reloaded. Import remains paused.' })).finally(() => setBusy(false));
    }}>Reload saved library</Button>}
    {file && <form className="hq-refs-import-form" aria-label="Import screenshot" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <header><h3>Import screenshot</h3><p>{file.name} · PNG, JPEG or WebP · up to 16 MiB</p></header>
      <label htmlFor={`${id}-title`}>Title<input id={`${id}-title`} required maxLength={300} value={title} onChange={(event) => setTitle(event.currentTarget.value)} disabled={busy} /></label>
      <label htmlFor={`${id}-capture`}>Captured at (local time)<input id={`${id}-capture`} type="datetime-local" required value={capturedAt}
        onChange={(event) => { setCapturedAt(event.currentTarget.value); setCaptureEdited(true); }} disabled={busy} /></label>
      <label htmlFor={`${id}-source`}>Design source<select id={`${id}-source`} value={sourceKind} onChange={(event) => setSourceKind(event.currentTarget.value as 'url' | 'app')} disabled={busy}>
        <option value="url">Website</option><option value="app">App</option>
      </select></label>
      {sourceKind === 'url' ? <label className="hq-refs-import-wide" htmlFor={`${id}-url`}>Website URL<input id={`${id}-url`} type="url" required maxLength={2048} placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.currentTarget.value)} disabled={busy} /></label> : <>
        <label htmlFor={`${id}-app`}>App name<input id={`${id}-app`} required maxLength={200} value={appName} onChange={(event) => setAppName(event.currentTarget.value)} disabled={busy} /></label>
        <label htmlFor={`${id}-platform`}>Platform<select id={`${id}-platform`} value={platform} onChange={(event) => setPlatform(event.currentTarget.value as typeof platform)} disabled={busy}>
          {APP_PLATFORMS.map((item) => <option key={item} value={item}>{platformName(item)}</option>)}
        </select></label>
        <label htmlFor={`${id}-bundle`}>Bundle or package ID<input id={`${id}-bundle`} required maxLength={200} placeholder="com.example.app" value={appId} onChange={(event) => setAppId(event.currentTarget.value)} disabled={busy} /></label>
        <label htmlFor={`${id}-screen`}>Screen (optional)<input id={`${id}-screen`} maxLength={300} value={screen} onChange={(event) => setScreen(event.currentTarget.value)} disabled={busy} /></label>
      </>}
      <p className="hq-refs-import-wide">Capture date starts with the file modification date; adjust it if needed. Publication rights start as unknown. This imports a static image; it does not run the app or website.</p>
      <div className="hq-refs-import-actions hq-refs-import-wide">
        <Button type="submit" variant="primary" busy={busy} busyLabel="Importing screenshot" disabled={busy || disabled || needsReload || !canSubmit}>Import image</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setFile(null)}>Cancel</Button>
      </div>
    </form>}
    </div>
  </div>;
}
