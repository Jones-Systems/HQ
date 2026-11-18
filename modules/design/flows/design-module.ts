// Production descriptor for the flows section (HQD-INT-COMPOSE). PLACEMENT IS PROVISIONAL: `nav` and `order`
// are T14's suggested placement, put up for owner first-look review, not an owner-selected product decision.
// Cheap to evaluate: the view loads lazily, on first display.
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'flows', title: 'Flows', nav: 'resources', order: 30,
  view: async () => (await import('../app/compose/views/FlowsView.tsx')).FlowsView,
};
