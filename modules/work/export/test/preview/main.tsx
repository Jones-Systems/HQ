import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkExport, type WorkExportPort } from '../..';
import './preview.css';

// Synthetic test doubles only. No native dialog, filesystem or live transport is used.
function Preview() {
  const [mode, setMode] = useState('saved');
  const [calls, setCalls] = useState<string[]>([]);
  const port = useMemo<WorkExportPort | undefined>(() => mode === 'absent' ? undefined : {
    async export(format) {
      setCalls(previous => [...previous, format]);
      if (mode === 'pending') return new Promise<never>(() => {});
      if (mode === 'unavailable' || mode === 'unknown') return { ok: false, kind: mode };
      return { ok: true, status: mode === 'error' ? 503 : 200, body: { saved: mode === 'saved' }, replayed: false };
    },
  }, [mode]);
  return <main><h1>Synthetic Work export</h1><p>Source UI fixture only. No files are written. Native qualification and client injection remain later tasks.</p>
    <div className="fixture-controls">
      <label>Theme <select onChange={event => { document.documentElement.dataset.theme = event.target.value; }} defaultValue="light"><option>light</option><option>dark</option></select></label>
      <label>Fixture outcome <select value={mode} onChange={event => setMode(event.target.value)}>{['saved', 'cancelled', 'error', 'unavailable', 'unknown', 'absent', 'pending'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <WorkExport key={mode} port={port} />
    <p>Explicit export calls: {calls.length} · {calls.join(', ') || 'none'}</p>
  </main>;
}
document.documentElement.dataset.theme = 'light';
createRoot(document.getElementById('root')!).render(<Preview />);
