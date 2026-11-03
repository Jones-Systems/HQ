import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@hq/ui';
import { recordCalls } from '../../../core';
import { createWorkbenchFixture } from '../../fixtures/examples';
import { WorkbenchSection, isWorkbenchDestination } from '../../WorkbenchSection';
import './harness.css';

/**
 * Evidence harness for the Social workbench, on fictional fixture data only. The panel on the left stands in
 * for the Social domain's navigation; the fixture controls are test scaffolding, never product UI.
 * Query: ?theme=light|dark  &dest=<workbench destination>  &features=none (today's service: no hq-references-v1)
 */

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

const fixture = createWorkbenchFixture(params.get('features') === 'none' ? { features: [] } : {});
const recorded = recordCalls(fixture.port);
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version += 1; for (const listener of listeners) listener(); };
// Re-render the call counter after every recorded call settles.
const port = Object.fromEntries(Object.entries(recorded.port).map(([name, method]) => [name, async (...args: unknown[]) => {
  try {
    return await (method as (...a: unknown[]) => Promise<unknown>)(...args);
  } finally {
    bump();
  }
}])) as unknown as typeof recorded.port;

const CONTEXT = { id: 'fixture-project', name: 'Fixture project' };

function Harness() {
  const initial = params.get('dest');
  const [destination, setDestination] = useState(initial && isWorkbenchDestination(initial) ? initial : 'workbenches');
  const [unavailable, setUnavailable] = useState(false);
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => version);
  const counts = { execution: recorded.callsOf('execution').length, read: recorded.callsOf('read').length, content: recorded.callsOf('content').length };
  const nav = (target: string, label: string) => (
    <a
      href={`#${target}`} className="harness-nav-link" aria-current={destination.startsWith(target) ? 'page' : undefined}
      onClick={(event) => { event.preventDefault(); setDestination(target); }}
    >{label}</a>
  );
  return (
    <div className="harness">
      <aside className="harness-side" aria-label="Harness">
        <p className="harness-title">Social</p>
        <nav aria-label="Social sections (harness stand-in)">{nav('workbenches', 'Workbenches')}{nav('runs', 'Run history')}</nav>
        <section className="harness-controls" aria-label="Fixture controls (test scaffolding)">
          <p className="harness-label">Fixture controls · test only</p>
          <Button size="sm" onClick={() => { fixture.settle(); bump(); }}>Finish fixture runs</Button>
          <Button size="sm" onClick={() => fixture.controls.loseNextSubmitResponse()}>Lose next Run response</Button>
          <Button size="sm" onClick={() => { fixture.controls.setUnavailable(!unavailable); setUnavailable(!unavailable); }}>{unavailable ? 'Restore service' : 'Make service unreachable'}</Button>
          <dl className="harness-counts" data-testid="call-counts">
            <div><dt>execution</dt><dd id="harness-execution-count">{counts.execution}</dd></div>
            <div><dt>read</dt><dd>{counts.read}</dd></div>
            <div><dt>content</dt><dd>{counts.content}</dd></div>
          </dl>
          <p className="harness-label">Destination <code>{destination}</code></p>
        </section>
      </aside>
      <main className="harness-main">
        <WorkbenchSection port={port} context={CONTEXT} destination={destination} navigate={setDestination} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
