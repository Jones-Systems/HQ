// Production descriptor. PLACEMENT IS PROVISIONAL: T14 suggested placement, pending owner review.
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'connector', title: 'Runs', nav: 'runs', order: 10,
  view: async () => (await import('../app/compose/closure-views.tsx')).mountRuns((await import('../app/sections/runs/View.tsx')).RunsSection),
};
