// PREVIEW-LOCAL descriptor (not the production modules/design/taste/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'taste', title: 'Taste', nav: 'review', order: 40,
  view: async () => (await import('./View.tsx')).TastePreview,
};
