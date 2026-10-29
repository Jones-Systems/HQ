// PREVIEW-LOCAL descriptor (not the production modules/design/imports/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'imports', title: 'Imports', nav: 'requests', order: 20,
  view: async () => (await import('./View.tsx')).ImportsPreview,
};
