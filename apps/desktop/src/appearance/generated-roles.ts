/** Colour roles a theme tile draws with. */
export const TILE_ROLES = ['--hq-canvas', '--hq-nav', '--hq-surface', '--hq-surface-raised', '--hq-border', '--hq-text', '--hq-text-muted', '--hq-accent', '--hq-surface-selected', '--hq-text-selected'] as const;

/**
 * The generated `light-dark()` token strings for `names`, as the stylesheet declares them. While a dark palette is
 * applied, `<html>` carries inline overrides, so those are lifted for one synchronous read and put back before
 * anything paints. Copying a string onto a subtree that sets `color-scheme: light` draws the real light colours.
 * Returns an empty record where computed custom properties are not available.
 */
export function readGeneratedRoles(names: readonly string[] = TILE_ROLES, root: HTMLElement = document.documentElement): Record<string, string> {
  const inline = names.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const);
  for (const [name] of inline) root.style.removeProperty(name);
  try {
    const computed = getComputedStyle(root);
    const roles: Record<string, string> = {};
    for (const name of names) {
      const value = computed.getPropertyValue(name).trim();
      if (value) roles[name] = value;
    }
    return roles;
  } finally {
    for (const [name, value, priority] of inline) if (value) root.style.setProperty(name, value, priority);
  }
}
