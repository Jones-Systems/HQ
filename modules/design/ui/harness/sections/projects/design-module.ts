// LABELLED FAKE section used only by tests and the harness. Not the real projects lane (T2).
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../../../contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'projects', title: 'Projects (fake)', nav: 'projects',
  view: async () => (await import('./View.tsx')).FakeProjects,
};
