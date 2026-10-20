// PREVIEW-LOCAL descriptor (not the production modules/design/flows/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'flows', title: 'Flows', nav: 'resources', order: 30,
  view: async () => (await import('./View.tsx')).FlowsPreview,
};
