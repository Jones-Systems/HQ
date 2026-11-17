// Production descriptor for the components section (HQD-INT-COMPOSE). PLACEMENT IS PROVISIONAL: `nav` and `order`
// are T14's suggested placement, put up for owner first-look review, not an owner-selected product decision.
// Cheap to evaluate: the view loads lazily, on first display.
// Fixed views are routing metadata only (parse, format, palette, navigation). The view does not consume `sub` yet:
// alternate layouts are separate, later work, and no section behaviour changes here.
import type { ComponentType } from 'react';
import type { DesignSectionDescriptor, DesignSectionProps } from '../ui/contract.ts';

export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: 'components', title: 'Components', nav: 'resources', order: 20,
  subRoutes: { fixed: [{ id: 'tokens', title: 'Tokens' }, { id: 'motion', title: 'Motion' }], navChildren: true, itemPrefix: 'item' },
  view: async () => (await import('../app/compose/views/ComponentsView.tsx')).ComponentsView,
};
