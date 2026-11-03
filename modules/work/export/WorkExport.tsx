import { useId, useRef, useState } from 'react';
import { Button } from '@hq/ui';
import type { WorkExportPort } from './port';
import './export.css';

type Outcome =
  | { kind: 'saved' | 'cancelled' | 'error'; status: number }
  | { kind: 'unavailable' | 'unknown' };

export interface WorkExportProps { readonly port?: WorkExportPort }

export function WorkExport({ port }: WorkExportProps) {
  const id = useId();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ owner: WorkExportPort; outcome: Outcome }>();
  const outcome = result?.owner === port ? result?.outcome : undefined;

  async function save(format: 'json' | 'markdown') {
    if (!port || locked.current) return;
    locked.current = true;
    setPending(true);
    setResult(undefined);
    try {
      const response = await port.export(format);
      // Retain only the closed status/saved result, never arbitrary response data or exception text.
      const next: Outcome = !response.ok ? { kind: response.kind }
        : !Number.isInteger(response.status) || response.status < 100 || response.status > 599 ? { kind: 'unavailable' }
          : response.status < 200 || response.status >= 300 ? { kind: 'error', status: response.status }
            : typeof response.body?.saved !== 'boolean' ? { kind: 'unavailable' }
              : { kind: response.body.saved ? 'saved' : 'cancelled', status: response.status };
      setResult({ owner: port, outcome: next });
    } catch {
      setResult({ owner: port, outcome: { kind: 'unavailable' } });
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  const message = !port ? 'Export unavailable. No Planner export connection is available.'
    : pending ? 'Export in progress. Complete or cancel the save dialog.'
      : !outcome ? 'Ready to export. Choose a format to open the save dialog.'
        : outcome.kind === 'saved' ? `Planner status ${outcome.status} · Saved.`
          : outcome.kind === 'cancelled' ? `Planner status ${outcome.status} · Cancelled. Nothing saved.`
            : outcome.kind === 'error' ? `Planner status ${outcome.status} · Export failed. Nothing saved.`
              : outcome.kind === 'unknown' ? 'Export outcome unknown. Check your destination before exporting again.'
                : 'Export unavailable. The Planner export connection did not respond successfully.';
  return <section className="work-export" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Export planning</h2>
    <p>Save a copy from the Planner as JSON or Markdown.</p>
    <div className="work-export-actions">
      <Button disabled={!port || pending} aria-describedby={`${id}-status`} onClick={() => void save('json')}>Export JSON</Button>
      <Button disabled={!port || pending} aria-describedby={`${id}-status`} onClick={() => void save('markdown')}>Export Markdown</Button>
    </div>
    <p id={`${id}-status`} role="status" aria-live="polite">{message}</p>
    <p className="work-export-hint">To import planning or replace-restore a backup, use the Planner’s own tools.</p>
  </section>;
}
