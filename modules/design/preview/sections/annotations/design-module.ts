// PREVIEW-LOCAL descriptor (not the production modules/design/annotations/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'annotations', title: 'Annotations', nav: 'review', order: 30,
  view: async () => (await import('./View.tsx')).AnnotationsPreview,
};
