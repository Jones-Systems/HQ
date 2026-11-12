import { createElement } from 'react';
import type { ComponentType } from 'react';
import { ErrorBoundary, InlineNotice } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';

/** Failure stays local to the mounted section and project; the section offers another try in place. */
export function withSectionErrorBoundary(View: ComponentType<DesignSectionProps>, preserveMount = false): ComponentType<DesignSectionProps> {
  return (props) => <ErrorBoundary key={preserveMount ? undefined : props.context.id} resetKeys={[props.context.id]}
    fallback={({ reset }) => <div className="hqd-section-failed">
      <InlineNotice tone="danger" live="assertive" title="This section could not be shown" actions={[{ label: 'Try again', onAction: reset }]}>
        Stored data was not replaced. The rest of Design keeps working.
      </InlineNotice>
    </div>}>
    {createElement(View, props)}
  </ErrorBoundary>;
}
