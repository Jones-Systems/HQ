import { useDesignProject, useDesignWorkspace } from '../workspace-context.tsx';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { ErrorBoundary, InlineNotice } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';

/** Failure stays local to the mounted section and project; the section offers another try in place. */
export function withSectionErrorBoundary(View: ComponentType<DesignSectionProps>, preserveMount = false): ComponentType<DesignSectionProps> {
  return (props) => {
    const workspace = useDesignWorkspace();
    const project = useDesignProject(props.context);
    return <ErrorBoundary key={preserveMount ? undefined : project.id} resetKeys={[project.id]}
    fallback={({ reset }) => <div className="hqd-section-failed">
      <InlineNotice tone="danger" live="assertive" title="This section could not be shown" actions={[{ label: 'Try again', onAction: () => { workspace.retry(project.id); reset(); } }]}>
        Stored data was not replaced. The rest of Design keeps working.
      </InlineNotice>
    </div>}>
    {createElement(View, props)}
  </ErrorBoundary>;
  };
}
