// PREVIEW-LOCAL descriptor (not the production modules/design/canvas/design-module.ts).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'canvas', title: 'Canvas', nav: 'review', order: 10,
  view: async () => (await import('./View.tsx')).CanvasPreview,
};
