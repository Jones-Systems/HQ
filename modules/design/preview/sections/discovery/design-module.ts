// PREVIEW-LOCAL descriptor (not the production modules/design/discovery/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'discovery', title: 'Discovery', nav: 'projects', order: 20,
  view: async () => (await import('./View.tsx')).DiscoveryPreview,
};
