import { Button, StateView, StatusChip } from '@hq/ui';
import { isActiveRun, workspaceSnapshot, type RunRecord } from '../core';
import { PageHeader, SocialIcon } from '../ui';
import { EXAMPLE_NOTICE, TOOL_GUIDES, groupTools } from './catalog';
import { useWorkbench } from './env';
import { RUN_STATUS_VIEW } from './format';
import { ToolRail } from './ToolRail';

function dayOf(run: RunRecord): string {
  return (run.finished_at ?? run.created_at).slice(0, 10);
}

/**
 * RR-1: the service's tools grouped by delivered category, each with its delivered limit and its last run. The tool
 * rail sits beside this overview, as it does on every tool page, so the layout does not jump when a tool opens.
 */
export function Catalog() {
  const { port, session, state, navigate } = useWorkbench();
  const snapshot = workspaceSnapshot(state.workspace);
  const stale = state.workspace.status === 'error';
  return (
    <section className="sw-page sx-page" aria-labelledby="sw-catalog-title">
      <PageHeader
        headingId="sw-catalog-title" title="Workbenches"
        description="Account-free workbenches backed by the native Social tools. Each analyzes material you supply and runs only when you choose Run."
      >
        <p className="sw-note">{EXAMPLE_NOTICE}</p>
      </PageHeader>
      {!snapshot ? (
        state.workspace.status === 'error'
          ? <StateView state="unavailable" title="The tool catalog isn't available" description="The Social service didn't answer, so its workbench list can't be shown." action={{ label: 'Try again', onAction: () => void session.load(port) }} />
          : <StateView state="loading" title="Loading workbenches" />
      ) : snapshot.tools.length === 0 ? (
        <StateView state="empty" title="No workbenches" description="The Social service listed no tools." />
      ) : (
        <div className="sw-layout">
          <ToolRail selected={null} />
          <div className="sw-main sw-hub">
            {groupTools(snapshot.tools).map((group) => (
              <section key={group.category} className="sw-group" aria-labelledby={`sw-group-${group.category}`}>
                <h2 id={`sw-group-${group.category}`} className="sw-group-title">{group.category}</h2>
                <ul className="sw-cards hq-stagger">
                  {group.tools.map((tool) => {
                    const guide = TOOL_GUIDES[tool.id];
                    // Runs are newest first. A run last seen active while the service is unreachable is Unknown.
                    const last = snapshot.runs.find((run) => run.tool === tool.id);
                    const status = last ? RUN_STATUS_VIEW[stale && isActiveRun(last) ? 'unknown' : last.status] : null;
                    return (
                      <li key={tool.id} className="sw-card hq-lift">
                        <div className="sw-card-head">
                          <span className="sx-mark" aria-hidden="true">{tool.mark}</span>
                          <h3 className="sw-card-title">{tool.name}</h3>
                        </div>
                        <p className="sw-card-text">{tool.description}</p>
                        <p className="sw-card-limit"><b>Limit</b> {guide.limit}</p>
                        <p className="sw-card-meta">{guide.input === 'fields' ? 'Form fields' : 'Typed file import'} · Advanced JSON</p>
                        <div className="sw-card-foot">
                          {last && status
                            ? <span className="sw-card-last"><StatusChip tone={status.tone} label={status.label} /><span className="sw-hint">last run {dayOf(last)}</span></span>
                            : <span className="sw-hint">No runs yet</span>}
                          <Button size="sm" variant="secondary" onClick={() => navigate(`workbenches/${tool.id}`)} aria-label={`Open ${tool.name}`}>Open<SocialIcon name="arrow-right" /></Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
