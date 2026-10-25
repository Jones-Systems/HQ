export const CAPABILITIES = Object.freeze({
  available: Object.freeze(['shell-navigation', 'appearance', 'rail-resize', 'work-example-create-edit', 'social-example-navigation', 'reset']),
  unavailable: Object.freeze(['design-desktop-preview', 'wiki', 'endpoint-settings', 'jones-code', 'project-sources', 'native-dialogs', 'live-services', 'persistence', 'clipboard-on-insecure-origin']),
});
export const ENTRIES = Object.freeze([
  { id: 'default', title: 'Example data', path: 'index.html' },
  { id: 'empty', title: 'Empty Work', path: 'empty.html' },
] as const);
export type PreviewEntry = typeof ENTRIES[number]['id'];
