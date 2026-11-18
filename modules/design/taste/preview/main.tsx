import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TasteClientPort } from '../src/contract.ts';
import { TastePanel } from '../src/ui/TastePanel.tsx';
import { PREVIEW_PROJECT, PREVIEW_SUBJECT, createPreviewTaste, type PreviewTaste } from './fake-client.ts';

/** REVIEW HARNESS ONLY: not part of the shipped Design module. */
function Harness() {
  const [preview, setPreview] = useState<PreviewTaste | null>(null);
  const [client, setClient] = useState<TasteClientPort | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [generation, setGeneration] = useState(0);

  useEffect(() => { void createPreviewTaste().then((value) => { setPreview(value); setClient(value.client); }); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  return <>
    <div className="harness-bar">
      <strong>Taste review harness</strong>
      <span>{client?.label ?? 'Loading'} · synthetic data</span>
      <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Theme: {theme}</button>
      <button type="button" disabled={!preview} onClick={async () => {
        if (!preview) return;
        preview.fs.arm({ kind: 'short-write', bytes: 9 });
      }}>Arm torn write</button>
      <button type="button" disabled={!preview} onClick={async () => {
        if (!preview) return;
        setClient(await preview.reopen());
        setGeneration(generation + 1);
      }}>Reopen journal</button>
    </div>
    <main>{client && <TastePanel key={generation} client={client} subject={PREVIEW_SUBJECT}
      projectId={PREVIEW_PROJECT} projectName="Synthetic project" />}</main>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
