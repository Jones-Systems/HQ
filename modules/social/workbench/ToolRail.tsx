import { useId } from 'react';
import { workspaceSnapshot, type ToolId } from '../core';
import { groupTools } from './catalog';
import { useWorkbench } from './env';

/**
 * The master list of the workbench pages: the service's tools grouped by delivered category, with the open one marked.
 * It stays beside the catalog overview and every tool page, so choosing another tool never costs a scroll back to a
 * list. Choosing is navigation only (`workbenches/<toolId>`); it never loads, runs or sends anything.
 */
export function ToolRail({ selected }: { readonly selected: ToolId | null }) {
  const { state, navigate } = useWorkbench();
  const id = useId();
  const snapshot = workspaceSnapshot(state.workspace);
  if (!snapshot) return <nav className="sw-rail" aria-label="Workbenches" />;
  return (
    <nav className="sw-rail" aria-label="Workbenches">
      {groupTools(snapshot.tools).map((group) => (
        <div key={group.category} className="sw-rail-group" role="group" aria-labelledby={`${id}-${group.category}`}>
          <p className="sw-rail-label" id={`${id}-${group.category}`}>{group.category}</p>
          <ul className="sx-list">
            {group.tools.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button" className="sx-row sw-rail-item" aria-current={tool.id === selected ? 'page' : undefined}
                  onClick={() => navigate(`workbenches/${tool.id}`)}
                >
                  <span className="sx-mark" aria-hidden="true">{tool.mark}</span>
                  <span className="sx-row-title">{tool.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
