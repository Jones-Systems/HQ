import { useEffect, useRef, useState } from 'react';
import {
  Button, Dialog, IconButton, Menu, PreservedContent, SAVE_STATES, SaveIndicator, StateView, StatusChip, Tabs, Toast,
  ToastRegion, type ContentScheme, type PreservedContentKind, type StatusTone, type ViewState,
} from '../../src';

export type Appearance = 'light' | 'dark' | 'system';

/** Fictional raster capture drawn with plain rectangles, so its pixels are deterministic. */
function rasterCapture(scheme: ContentScheme): string {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 96;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const [bg, ink, soft] = scheme === 'light' ? ['#f4f1e6', '#2c4a7a', '#d9d2bd'] : ['#1b1d24', '#e8b04c', '#3a3d48'];
  g.fillStyle = bg; g.fillRect(0, 0, 160, 96);
  g.fillStyle = ink; g.fillRect(16, 16, 56, 64);
  g.fillStyle = soft; g.fillRect(88, 16, 56, 28); g.fillRect(88, 52, 56, 28);
  return canvas.toDataURL('image/png');
}

const FRAME_DOC = '<!doctype html><link rel="stylesheet" href="./frame-probe.css"><div class="swatch"></div>';

interface WellSpec {
  readonly id: string;
  readonly kind: PreservedContentKind;
  readonly content: 'raster' | 'svg' | 'frame';
  readonly matte?: 'checker';
}
const WELLS: readonly WellSpec[] = [
  { id: 'captured-img', kind: 'captured', content: 'raster' },
  { id: 'producer-srcdoc', kind: 'producer', content: 'frame' },
  { id: 'export-svg', kind: 'export', content: 'svg' },
  { id: 'export-svg-checker', kind: 'export', content: 'svg', matte: 'checker' },
];

function WellContent({ content, scheme, label }: { content: WellSpec['content']; scheme: ContentScheme; label: string }) {
  const [raster] = useState(() => rasterCapture(scheme));
  if (content === 'raster') return <img src={raster} width={160} height={96} alt={`${label}: fictional raster capture`} />;
  if (content === 'svg') return <img src="./scheme-probe.svg" width={160} height={96} alt={`${label}: fictional SVG export`} />;
  return <iframe srcDoc={FRAME_DOC} width={160} height={96} title={`${label}: fictional producer preview`} />;
}

function PreservedSection() {
  return (
    <section className="kit-section" aria-labelledby="kit-wells">
      <h2 id="kit-wells" className="kit-heading">Preserved content</h2>
      <p className="kit-note">Each well pins its recorded scheme. The controls in plain chrome follow the chrome scheme, which proves the probes are sensitive.</p>
      {(['light', 'dark'] as const).map((scheme) => (
        <div key={scheme} className="kit-wells">
          <span className="hq-meta kit-row-label">Recorded {scheme}</span>
          {WELLS.map((well) => (
            <figure key={well.id} className="kit-well">
              <PreservedContent kind={well.kind} recordedScheme={scheme} matte={well.matte} data-kit-id={`${well.id}-${scheme}`}>
                <WellContent content={well.content} scheme={scheme} label={`${well.id} recorded ${scheme}`} />
              </PreservedContent>
              <figcaption className="hq-meta">{well.kind} · {well.content}{well.matte ? ' · checker' : ''}</figcaption>
            </figure>
          ))}
        </div>
      ))}
      <div className="kit-wells">
        <span className="hq-meta kit-row-label">Control · unpinned</span>
        <figure className="kit-well"><div className="kit-control" data-kit-control="control-svg"><WellContent content="svg" scheme="light" label="control" /></div><figcaption className="hq-meta">chrome · svg</figcaption></figure>
        <figure className="kit-well"><div className="kit-control" data-kit-control="control-srcdoc"><WellContent content="frame" scheme="light" label="control" /></div><figcaption className="hq-meta">chrome · srcdoc</figcaption></figure>
      </div>
    </section>
  );
}

const TONES: readonly [StatusTone, string, string][] = [
  ['success', 'Fresh', 'observed 2 min ago'], ['warning', 'Stale', 'last observed 3 days ago'],
  ['danger', 'Failed', 'export rejected'], ['info', 'Other project', 'Atlas Weekend Market'],
  ['unknown', 'Unknown', 'dispatch not confirmed'], ['unavailable', 'Unavailable', 'host offline'], ['neutral', 'Draft', 'not shared'],
];
const VIEWS: readonly [ViewState, string, string, string?][] = [
  ['empty', 'Inbox is clear', 'Captured ideas land here until you sort them.', 'Capture'],
  ['loading', 'Loading references', ''],
  ['error', "Couldn't load drafts", 'The Social store did not respond. Nothing was changed.', 'Try again'],
  ['offline', "You're offline", 'Showing what was saved on this device at 14:02.', 'Retry connection'],
  ['unavailable', 'Planning service unavailable', 'No planning service is configured in this build.'],
  ['unknown', 'Result unknown', 'The last move may not have saved. Checking before any retry.', 'Check status'],
];
const PIN = <svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" /></svg>;

function PrimitivesSection() {
  const [dialog, setDialog] = useState(false);
  const [toasts, setToasts] = useState(['Moved “Write menu card copy” to Active']);
  const [log, setLog] = useState('No action yet');
  const [pinned, setPinned] = useState(false);
  return (
    <section className="kit-section" aria-labelledby="kit-primitives">
      <h2 id="kit-primitives" className="kit-heading">Primitives</h2>
      <p className="kit-note" role="status">Last action: {log}</p>
      <div className="kit-row">
        <Button variant="primary" onClick={() => setLog('Capture')}>Capture</Button>
        <Button variant="secondary" onClick={() => setLog('Compare')}>Compare</Button>
        <Button variant="ghost" onClick={() => setLog('Check')}>Check</Button>
        <Button variant="danger" onClick={() => setDialog(true)}>Remove board</Button>
        <Button variant="primary" disabled>Capture</Button>
        <Button variant="secondary" busy busyLabel="Saving">Save</Button>
        <Button size="sm" variant="secondary" onClick={() => setLog('Small')}>Small</Button>
        <IconButton label="Pin board" pressed={pinned} onClick={() => setPinned((p) => !p)} icon={PIN} />
        <Menu trigger="Card actions" items={[
          { id: 'rename', label: 'Rename', onSelect: () => setLog('Rename') },
          { id: 'move', label: 'Move to list', onSelect: () => setLog('Move'), disabled: true },
          { id: 'archive', label: 'Archive', onSelect: () => setLog('Archive'), tone: 'danger' },
        ]} />
      </div>
      <Tabs label="Work views" tabs={[
        { id: 'board', label: 'Board', panel: <p className="kit-note">Board view panel (fictional).</p> },
        { id: 'list', label: 'List', panel: <p className="kit-note">List view panel (fictional).</p> },
        { id: 'review', label: 'Review', panel: <p className="kit-note">Review view panel (fictional).</p> },
      ]} />
      <div className="kit-grid">
        {TONES.map(([tone, label, detail]) => <StatusChip key={tone} tone={tone} label={label} detail={detail} />)}
      </div>
      <div className="kit-grid">
        {SAVE_STATES.map((state) => <SaveIndicator key={state} state={state} savedAt="14:02" onRetry={() => setLog('Retry save')} onCheck={() => setLog('Check save')} />)}
      </div>
      <div className="kit-panels">
        {VIEWS.map(([state, title, description, action]) => (
          <div key={state} className="kit-panel">
            <StateView state={state} title={title} description={description || undefined} action={action ? { label: action, onAction: () => setLog(action) } : undefined} />
          </div>
        ))}
      </div>
      <Dialog open={dialog} onClose={() => setDialog(false)} role="alertdialog" title="Remove this board?"
        description="Cards stay in the Planner; only this fictional board view is removed."
        actions={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="danger" onClick={() => { setDialog(false); setLog('Removed'); }}>Remove</Button></>} />
      <ToastRegion label="Notifications">
        {toasts.map((message) => (
          <Toast key={message} message={message} meta="Planning change only · no run started"
            action={{ label: 'Undo', onAction: () => { setLog('Undo'); setToasts([]); } }} onDismiss={() => setToasts([])} />
        ))}
      </ToastRegion>
    </section>
  );
}

function resolve(appearance: Appearance, osDark: boolean): ContentScheme {
  return appearance === 'system' ? (osDark ? 'dark' : 'light') : appearance;
}

export function KitPage({ initial, only }: { initial: Appearance; only?: 'wells' | 'primitives' }) {
  const [appearance, setAppearance] = useState<Appearance>(initial);
  const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const setRef = useRef(setAppearance);
  setRef.current = setAppearance;

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setOsDark(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  // Same contract as T0's shell: the resolved scheme is written to <html data-theme>.
  useEffect(() => { document.documentElement.dataset.theme = resolve(appearance, osDark); }, [appearance, osDark]);
  useEffect(() => { window.hqKit = { ...window.hqKit, setAppearance: (a: Appearance) => setRef.current(a) }; }, []);

  return (
    <main className="kit-page">
      <header className="kit-head">
        <div>
          <span className="hq-meta">@hq/ui kit evidence · fictional content</span>
          <h1 className="kit-title">Kit page</h1>
        </div>
        <div className="kit-appearance" role="radiogroup" aria-label="Appearance">
          {(['light', 'dark', 'system'] as const).map((a) => (
            <Button key={a} size="sm" variant={a === appearance ? 'primary' : 'ghost'} role="radio" aria-checked={a === appearance} onClick={() => setAppearance(a)}>
              {a[0]!.toUpperCase() + a.slice(1)}
            </Button>
          ))}
        </div>
        <span className="hq-meta" data-kit-resolved>{`appearance ${appearance} · chrome ${resolve(appearance, osDark)}`}</span>
      </header>
      {only !== 'primitives' && <PreservedSection />}
      {only !== 'wells' && <PrimitivesSection />}
    </main>
  );
}

declare global {
  interface Window { hqKit?: { setAppearance?: (appearance: Appearance) => void; probe?: () => Promise<unknown> } }
}
