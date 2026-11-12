import type { IconName } from './parts';

export type SettingsCategory = 'overview' | 'services' | 'wiki' | 'projects' | 'appearance' | 'updates';
export interface CategoryInfo { readonly id: SettingsCategory; readonly label: string; readonly icon: IconName }
export interface CategoryGroup { readonly label: string; readonly items: readonly CategoryInfo[] }

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { label: 'Data sources', items: [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'services', label: 'Social & Work', icon: 'services' },
    { id: 'wiki', label: 'Local Wiki', icon: 'wiki' },
    { id: 'projects', label: 'Projects & Jones', icon: 'projects' },
  ] },
  { label: 'App', items: [
    { id: 'appearance', label: 'Appearance', icon: 'appearance' },
    { id: 'updates', label: 'Updates', icon: 'updates' },
  ] },
];
export const CATEGORIES: readonly CategoryInfo[] = CATEGORY_GROUPS.flatMap(group => group.items);
