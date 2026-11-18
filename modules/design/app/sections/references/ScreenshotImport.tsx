import { Button, FieldError, fieldErrorProps, IconButton, Presence, StatusIndicator, type StatusTone } from '@hq/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { APP_PLATFORMS } from '../../../references/src/contract.ts';
import { normalizeUrl, platformName } from '../../../references/src/provenance.ts';
import { defaultTitle, localDateTimeValue, queueCounts, QUEUE_STATUS_LABELS, type QueueItem, type QueueStatus } from './queue.ts';
import type { ImportFields, ScreenshotImporter } from './use-screenshot-importer.ts';

/** Mirrors the library's app-id rule so a mistake is caught beside its field; the library still validates on save. */
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

type FieldName = 'title' | 'capturedAt' | 'url' | 'appName' | 'appId';
type FieldErrors = Partial<Record<FieldName, string>>;
const FIELD_ORDER: readonly FieldName[] = ['title', 'capturedAt', 'url', 'appName', 'appId'];

const STATUS_TONES: Readonly<Record<QueueStatus, StatusTone>> = {
  waiting: 'neutral', importing: 'neutral', saved: 'success', 'kept-existing': 'info', failed: 'danger', unknown: 'unknown',
};

export interface ScreenshotImportProps {
  readonly importer: ScreenshotImporter;
  readonly disabled: boolean;
  /** Where bulk import (bundles, recordings, HTML) lives. Omit and the pointer to it is not shown. */
  readonly onOpenImports?: () => void;
}

export function ScreenshotImport({ importer, disabled, onOpenImports }: ScreenshotImportProps) {
  const id = useId();
  const chooser = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { items, current, busy, needsReload } = importer;
  // The title and capture date belong to one queued file; a new current file starts from its own defaults.
  const [draft, setDraft] = useState({ forId: '', title: '', capturedAt: '', edited: false });
  const [sourceKind, setSourceKind] = useState<'url' | 'app'>('url');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<(typeof APP_PLATFORMS)[number]>('ios');
  const [appName, setAppName] = useState('');
  const [appId, setAppId] = useState('');
  const [screen, setScreen] = useState('');
  const [applyToRest, setApplyToRest] = useState(false);
  // While a "use these details for the rest" run is going, the queue rows are the progress; the form steps aside.
  const [batching, setBatching] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const own = current !== undefined && draft.forId === current.id ? draft : null;
  const title = own ? own.title : current ? defaultTitle(current.name) : '';
  const capturedAt = own ? own.capturedAt : current ? localDateTimeValue(current.file.lastModified) : '';
  const captureEdited = own?.edited ?? false;
  const remaining = items.filter((item) => item.status === 'waiting' && item.id !== current?.id).length;
  const rest = applyToRest && remaining > 0;
  const blocked = disabled || needsReload;

  useEffect(() => { if (!busy) setBatching(false); }, [busy]);

  const clearError = (field: FieldName) => setErrors((previous) => previous[field] === undefined ? previous : { ...previous, [field]: undefined });
  const edit = (patch: Partial<typeof draft>) => {
    if (current) setDraft({ forId: current.id, title, capturedAt, edited: captureEdited, ...patch });
  };

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (title.trim() === '') found.title = 'Add a title for this image.';
    if (captureEdited && !Number.isFinite(new Date(capturedAt).getTime())) found.capturedAt = 'Choose a valid capture date and time.';
    if (sourceKind === 'url') {
      if (url.trim() === '') found.url = 'Add the address of the website this came from.';
      else if (normalizeUrl(url.trim()) === null) found.url = 'Use a full address that starts with http:// or https://, for example https://example.com.';
    } else {
      if (appName.trim() === '') found.appName = 'Add the name of the app.';
      if (appId.trim() === '') found.appId = 'Add the bundle or package ID.';
      else if (!APP_ID.test(appId.trim())) found.appId = 'Use letters, numbers, dots, hyphens or underscores, for example com.example.app.';
    }
    return found;
  };

  const submit = () => {
    if (!current || busy || blocked) return;
    const found = validate();
    setErrors(found);
    const invalid = FIELD_ORDER.find((field) => found[field] !== undefined);
    if (invalid) { document.getElementById(`${id}-${invalid}`)?.focus(); return; }
    const fields: ImportFields = {
      title,
      ...(captureEdited ? { capturedAt: new Date(capturedAt).toISOString() } : {}),
      source: sourceKind === 'url' ? { kind: 'url', url: url.trim() }
        : { kind: 'app', platform, appName: appName.trim(), appId: appId.trim(), ...(screen.trim() ? { screen: screen.trim() } : {}) },
    };
    if (rest) { setBatching(true); setApplyToRest(false); }
    void importer.run(fields, rest);
  };

  const counts = queueCounts(items);
  const working = busy || counts.importing > 0;

  return <div className="hq-refs-import">
    <input ref={chooser} id={`${id}-file`} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" disabled={blocked}
      aria-label="Choose a screenshot to import" onChange={(event) => {
        importer.addFiles(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = '';
      }} />
    <Button variant="primary" disabled={blocked} onClick={() => chooser.current?.click()}>Import screenshots</Button>
    <div className="hq-refs-import-panel">
      {needsReload && <StatusIndicator tone="unknown" label="Importing is paused" detail="the last save is unconfirmed"
        action={{ label: 'Reload saved library', onAction: importer.reload }} />}
      <Presence show={items.length > 0} motion="collapse">
        <div className="hq-refs-queue-wrap">
          <section className="hq-refs-queue-card" aria-label="Import queue">
            <header className="hq-refs-queue-head">
              <h3>Import queue</h3>
              <span className="hq-refs-muted">{counts.total} {counts.total === 1 ? 'image' : 'images'}{counts.saved > 0 ? ` · ${counts.saved} saved` : ''}</span>
              <Button size="sm" variant="ghost" disabled={working} onClick={importer.clear}>Clear</Button>
            </header>
            <ul className="hq-refs-queue">
              {items.map((item) => <QueueRow key={item.id} item={item} current={item.id === current?.id} locked={working || needsReload}
                onRemove={importer.remove} onRetry={importer.retry} onReload={importer.reload} />)}
            </ul>
            <Presence show={current !== undefined && !batching} motion="collapse">
              {current && <form ref={form} className="hq-refs-import-form" aria-label="Import screenshot" noValidate
              onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <header>
                <h3>Import screenshot</h3>
                <p>{current.name} · PNG, JPEG or WebP · up to 16 MiB</p>
              </header>
              <div className="hq-refs-field">
                <label htmlFor={`${id}-title`}>Title</label>
                <input id={`${id}-title`} required maxLength={300} value={title} disabled={busy} {...fieldErrorProps(`${id}-title-error`, errors.title)}
                  onChange={(event) => { edit({ title: event.currentTarget.value }); clearError('title'); }} />
                <FieldError id={`${id}-title-error`}>{errors.title}</FieldError>
              </div>
              <div className="hq-refs-field">
                <label htmlFor={`${id}-capturedAt`}>Captured at (local time)</label>
                <input id={`${id}-capturedAt`} type="datetime-local" required value={capturedAt} disabled={busy}
                  {...fieldErrorProps(`${id}-capturedAt-error`, errors.capturedAt)}
                  onChange={(event) => { edit({ capturedAt: event.currentTarget.value, edited: true }); clearError('capturedAt'); }} />
                <FieldError id={`${id}-capturedAt-error`}>{errors.capturedAt}</FieldError>
              </div>
              <div className="hq-refs-field">
                <label htmlFor={`${id}-source`}>Design source</label>
                <select id={`${id}-source`} value={sourceKind} disabled={busy} onChange={(event) => { setSourceKind(event.currentTarget.value as 'url' | 'app'); setErrors({}); }}>
                  <option value="url">Website</option><option value="app">App</option>
                </select>
              </div>
              {sourceKind === 'url'
                ? <div className="hq-refs-field">
                  <label htmlFor={`${id}-url`}>Website URL</label>
                  <input id={`${id}-url`} type="url" required maxLength={2048} placeholder="https://example.com" value={url} disabled={busy}
                    {...fieldErrorProps(`${id}-url-error`, errors.url)} onChange={(event) => { setUrl(event.currentTarget.value); clearError('url'); }} />
                  <FieldError id={`${id}-url-error`}>{errors.url}</FieldError>
                </div>
                : <>
                  <div className="hq-refs-field">
                    <label htmlFor={`${id}-appName`}>App name</label>
                    <input id={`${id}-appName`} required maxLength={200} value={appName} disabled={busy} {...fieldErrorProps(`${id}-appName-error`, errors.appName)}
                      onChange={(event) => { setAppName(event.currentTarget.value); clearError('appName'); }} />
                    <FieldError id={`${id}-appName-error`}>{errors.appName}</FieldError>
                  </div>
                  <div className="hq-refs-field">
                    <label htmlFor={`${id}-platform`}>Platform</label>
                    <select id={`${id}-platform`} value={platform} disabled={busy} onChange={(event) => setPlatform(event.currentTarget.value as typeof platform)}>
                      {APP_PLATFORMS.map((item) => <option key={item} value={item}>{platformName(item)}</option>)}
                    </select>
                  </div>
                  <div className="hq-refs-field">
                    <label htmlFor={`${id}-appId`}>Bundle or package ID</label>
                    <input id={`${id}-appId`} required maxLength={200} placeholder="com.example.app" value={appId} disabled={busy}
                      {...fieldErrorProps(`${id}-appId-error`, errors.appId)} onChange={(event) => { setAppId(event.currentTarget.value); clearError('appId'); }} />
                    <FieldError id={`${id}-appId-error`}>{errors.appId}</FieldError>
                  </div>
                  <div className="hq-refs-field">
                    <label htmlFor={`${id}-screen`}>Screen (optional)</label>
                    <input id={`${id}-screen`} maxLength={300} value={screen} disabled={busy} onChange={(event) => setScreen(event.currentTarget.value)} />
                  </div>
                </>}
              {remaining > 0 && <label className="hq-refs-check hq-refs-import-wide">
                <input type="checkbox" checked={applyToRest} disabled={busy} onChange={(event) => setApplyToRest(event.currentTarget.checked)} />
                <span>Use these source details for the rest <span className="hq-refs-muted">({remaining} more, titled from their file names)</span></span>
              </label>}
              <p className="hq-refs-import-wide">Capture date starts with the file modification date; adjust it if needed. Publication rights start as unknown. This imports a static image; it does not run the app or website.</p>
              <div className="hq-refs-import-actions hq-refs-import-wide">
                <Button type="submit" variant="primary" busy={busy} busyLabel="Importing screenshot" disabled={busy || blocked}>
                  {rest ? `Import ${remaining + 1} images` : 'Import image'}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => importer.remove(current.id)}>{remaining > 0 ? 'Skip this one' : 'Cancel'}</Button>
              </div>
              {onOpenImports && <p className="hq-refs-import-wide hq-refs-cross">Importing a bundle, recordings or HTML? <button type="button" className="hq-refs-link" onClick={onOpenImports}>Use Imports</button></p>}
            </form>}
            </Presence>
          </section>
        </div>
      </Presence>
    </div>
  </div>;
}

function QueueRow({ item, current, locked, onRemove, onRetry, onReload }: {
  readonly item: QueueItem;
  readonly current: boolean;
  readonly locked: boolean;
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
  readonly onReload: () => void;
}) {
  const label = QUEUE_STATUS_LABELS[item.status];
  const problem = item.status === 'failed' || item.status === 'unknown';
  return <li className="hq-refs-queue-row" data-status={item.status} aria-current={current ? 'step' : undefined}>
    <span className="hq-refs-queue-thumb" aria-hidden="true">
      {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span>▧</span>}
    </span>
    <span className="hq-refs-queue-name">
      <span className="hq-refs-queue-title" title={item.name}>{item.name}</span>
      {item.message !== null && item.status !== 'saved' ? <span className="hq-refs-queue-note">{item.message}</span> : null}
    </span>
    <StatusIndicator tone={STATUS_TONES[item.status]} label={label} busy={item.status === 'importing'} live={false}
      action={item.status === 'unknown' ? { label: 'Check', onAction: onReload } : undefined} />
    <span className="hq-refs-queue-actions">
      {problem ? <Button size="sm" variant="ghost" disabled={locked} onClick={() => onRetry(item.id)}>Retry</Button> : null}
      {item.status === 'waiting' || problem
        ? <IconButton size="sm" icon="×" label={`Remove ${item.name} from the queue`} disabled={locked} onClick={() => onRemove(item.id)} /> : null}
    </span>
  </li>;
}
