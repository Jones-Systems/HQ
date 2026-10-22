import { Button, StateView } from '@hq/ui';
import { workspaceSnapshot } from '../core';
import { EXAMPLE_NOTICE, TOOL_GUIDES, groupTools } from './catalog';
import { useWorkbench } from './env';

/** RR-1: the service's eight tools grouped by delivered category, each with its delivered limit. */
export function Catalog() {
  const { port, session, state, navigate } = useWorkbench();
  const snapshot = workspaceSnapshot(state.workspace);
  return (
    <section className="sw-page" aria-labelledby="sw-catalog-title">
      <header className="sw-page-head">
        <p className="sw-eyebrow">Social · Workbenches</p>
        <h1 id="sw-catalog-title">Workbenches</h1>
        <p>Account-free workbenches backed by the native Social tools. Each analyzes material you supply and runs only when you choose Run.</p>
        <p className="sw-note">{EXAMPLE_NOTICE}</p>
      </header>
      {!snapshot ? (
        state.workspace.status === 'error'
          ? <StateView state="unavailable" title="The tool catalog isn't available" description="The Social service didn't answer, so its workbench list can't be shown." action={{ label: 'Try again', onAction: () => void session.load(port) }} />
          : <StateView state="loading" title="Loading workbenches" />
      ) : snapshot.tools.length === 0 ? (
        <StateView state="empty" title="No workbenches" description="The Social service listed no tools." />
      ) : groupTools(snapshot.tools).map((group) => (
        <section key={group.category} className="sw-group" aria-labelledby={`sw-group-${group.category}`}>
          <h2 id={`sw-group-${group.category}`} className="sw-group-title">{group.category}</h2>
          <ul className="sw-cards">
            {group.tools.map((tool) => {
              const guide = TOOL_GUIDES[tool.id];
              return (
                <li key={tool.id} className="sw-card">
                  <span className="sw-mark" aria-hidden="true">{tool.mark}</span>
                  <h3 className="sw-card-title">{tool.name}</h3>
                  <p className="sw-card-text">{tool.description}</p>
                  <p className="sw-card-limit"><b>Limit</b> {guide.limit}</p>
                  <p className="sw-card-meta">{guide.input === 'fields' ? 'Form fields' : 'Typed file import'} · Advanced JSON</p>
                  <Button size="sm" variant="secondary" onClick={() => navigate(`workbenches/${tool.id}`)} aria-label={`Open ${tool.name}`}>Open</Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
