/**
 * Names of the T2 visual-system tokens copied into `tokens/hq-tokens.css` (spec `iface.ui-kit.001`).
 * Values live only in that CSS; `test/tokens.test.ts` proves this list equals its declarations.
 */

/** 39 colour roles, each a `light-dark()` pair resolved by the `[data-theme]` / OS colour scheme. */
export const HQ_COLOR_ROLES = [
  '--hq-canvas', '--hq-nav', '--hq-surface', '--hq-surface-raised', '--hq-surface-overlay', '--hq-surface-sunken',
  '--hq-surface-hover', '--hq-surface-pressed', '--hq-surface-selected',
  '--hq-border', '--hq-border-strong', '--hq-border-control',
  '--hq-text', '--hq-text-muted', '--hq-text-subtle', '--hq-text-disabled',
  '--hq-accent', '--hq-accent-hover', '--hq-accent-pressed', '--hq-accent-edge', '--hq-on-accent', '--hq-accent-text',
  '--hq-accent-strong', '--hq-accent-soft', '--hq-focus', '--hq-selection',
  '--hq-success', '--hq-success-soft', '--hq-warning', '--hq-warning-soft',
  '--hq-danger', '--hq-danger-soft', '--hq-danger-fill', '--hq-on-danger', '--hq-info', '--hq-info-soft',
  '--hq-skeleton', '--hq-skeleton-sheen', '--hq-scrim',
] as const;

/** Theme-invariant artwork tokens: identical in every chrome theme, never `light-dark()`. */
export const HQ_ARTWORK_TOKENS = [
  '--hq-artwork-matte', '--hq-artwork-checker-a', '--hq-artwork-checker-b', '--hq-artwork-checker-size',
] as const;

export const HQ_TYPE_TOKENS = [
  '--hq-font-family-sans', '--hq-font-family-mono',
  '--hq-font-weight-regular', '--hq-font-weight-medium', '--hq-font-weight-semibold',
  '--hq-type-display', '--hq-type-display-tracking', '--hq-type-title', '--hq-type-title-tracking',
  '--hq-type-heading', '--hq-type-heading-tracking', '--hq-type-body', '--hq-type-body-tracking',
  '--hq-type-small', '--hq-type-small-tracking', '--hq-type-label', '--hq-type-label-tracking',
  '--hq-type-rail', '--hq-type-rail-tracking', '--hq-type-eyebrow', '--hq-type-eyebrow-tracking',
  '--hq-type-meta', '--hq-type-meta-tracking',
] as const;

export const HQ_SPACE_TOKENS = [
  '--hq-space-3xs', '--hq-space-2xs', '--hq-space-xs', '--hq-space-sm', '--hq-space-md',
  '--hq-space-lg', '--hq-space-xl', '--hq-space-2xl', '--hq-space-3xl', '--hq-space-4xl',
] as const;

export const HQ_RADIUS_TOKENS = [
  '--hq-radius-xs', '--hq-radius-sm', '--hq-radius-md', '--hq-radius-lg', '--hq-radius-sheet', '--hq-radius-pill',
] as const;

export const HQ_SIZE_TOKENS = [
  '--hq-size-titlebar-height', '--hq-size-titlebar-inset-mac', '--hq-size-titlebar-inset-other',
  '--hq-size-rail-width', '--hq-size-rail-item-width', '--hq-size-rail-item-height', '--hq-size-rail-indicator',
  '--hq-size-secnav-width', '--hq-size-secnav-width-medium', '--hq-size-drawer-width', '--hq-size-inspector-width',
  '--hq-size-control-sm', '--hq-size-control-md', '--hq-size-control-lg',
  '--hq-size-icon-sm', '--hq-size-icon-md', '--hq-size-icon-lg', '--hq-size-hit-min',
  '--hq-size-focus-width', '--hq-size-focus-offset', '--hq-size-content-max',
  '--hq-size-window-min-width', '--hq-size-window-min-height',
] as const;

/** Durations collapse to 0ms under `prefers-reduced-motion: reduce`. */
export const HQ_MOTION_TOKENS = [
  '--hq-duration-fast', '--hq-duration-base', '--hq-duration-slow', '--hq-ease-standard', '--hq-ease-exit',
] as const;

export const HQ_LAYER_TOKENS = [
  '--hq-z-sticky', '--hq-z-drawer', '--hq-z-popover', '--hq-z-dialog', '--hq-z-toast', '--hq-z-tooltip',
] as const;

/** Component roles alias a colour role; see `component` in `tokens/hq-tokens.json`. */
export const HQ_COMPONENT_TOKENS = [
  '--hq-rail-item-fg', '--hq-rail-item-fg-hover', '--hq-rail-item-fg-selected', '--hq-rail-item-bg-hover',
  '--hq-rail-item-bg-selected', '--hq-rail-item-indicator', '--hq-rail-item-fg-unavailable',
  '--hq-nav-item-fg', '--hq-nav-item-fg-selected', '--hq-nav-item-bg-selected', '--hq-nav-item-indicator',
  '--hq-button-primary-bg', '--hq-button-primary-bg-hover', '--hq-button-primary-bg-pressed', '--hq-button-primary-fg',
  '--hq-button-primary-edge', '--hq-button-secondary-bg', '--hq-button-secondary-fg', '--hq-button-secondary-edge',
  '--hq-button-ghost-fg', '--hq-button-danger-bg', '--hq-button-danger-fg',
  '--hq-input-bg', '--hq-input-edge', '--hq-input-edge-invalid',
  '--hq-card-bg', '--hq-card-edge', '--hq-card-edge-selected', '--hq-toast-bg',
] as const;

/** Shadows switch through explicit scheme blocks because `light-dark()` accepts only colours. */
export const HQ_SHADOW_TOKENS = ['--hq-shadow-raised', '--hq-shadow-overlay', '--hq-shadow-drag'] as const;

/** Set by a preserved-content owner through CSSOM to the content's recorded scheme; see `PreservedContent`. */
export const HQ_CONTENT_SCHEME_PROPERTY = '--hq-content-scheme';

export const HQ_TOKEN_NAMES = [
  ...HQ_COLOR_ROLES, ...HQ_ARTWORK_TOKENS, ...HQ_TYPE_TOKENS, ...HQ_SPACE_TOKENS, ...HQ_RADIUS_TOKENS,
  ...HQ_SIZE_TOKENS, ...HQ_MOTION_TOKENS, ...HQ_LAYER_TOKENS, ...HQ_COMPONENT_TOKENS, ...HQ_SHADOW_TOKENS,
] as const;

export type HqColorRole = (typeof HQ_COLOR_ROLES)[number];
export type HqTokenName = (typeof HQ_TOKEN_NAMES)[number];
