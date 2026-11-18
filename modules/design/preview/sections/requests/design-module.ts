// PREVIEW-LOCAL descriptor (not the production modules/design/requests/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'requests', title: 'Requests', nav: 'requests', order: 10,
  view: async () => (await import('./View.tsx')).RequestsPreview,
};
