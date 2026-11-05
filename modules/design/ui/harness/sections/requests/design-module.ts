// LABELLED FAKE section used only by tests and the harness. Not the real requests lane (T6).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'requests', title: 'Draft (fake)', nav: 'requests',
  view: async () => (await import('./View.tsx')).FakeDraft,
};
