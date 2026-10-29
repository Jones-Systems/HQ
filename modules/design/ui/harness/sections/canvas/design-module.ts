// LABELLED FAKE section used only by tests and the harness. Not the real canvas (T3).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'canvas', title: 'Canvas (fake)', nav: 'review', order: 10,
  commands: [{ id: 'fit', title: 'Reset viewport', keywords: ['zoom', 'fit'] }],
  view: async () => (await import('./View.tsx')).FakeCanvas,
};
