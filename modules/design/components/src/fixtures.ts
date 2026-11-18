/**
 * SYNTHETIC FIXTURES. Public-safe sample data for tests, the review harness and
 * fake composition. Nothing here is owner data or imported private source.
 */

export const SYNTHETIC_BUTTON = {
  componentId: 'synthetic-button',
  name: 'Synthetic Button',
  markup: '<button class="btn" type="button" data-motion-target="button"><span class="label"></span></button>',
  styles: [
    '.btn{font:var(--font-weight-bold) 14px/1 var(--font-family-base);border:0;color:#fff;cursor:pointer;',
    'padding:var(--space-2) var(--space-4);border-radius:calc(var(--prop-radius) * 1px);background:var(--color-action-primary)}',
    '.btn[data-tone="neutral"]{background:var(--color-neutral-700)}',
    '.btn[data-tone="danger"]{background:var(--color-brand-danger)}',
    '.btn[data-size="sm"]{font-size:12px;padding:4px 10px}',
    '.btn[data-size="lg"]{font-size:17px;padding:14px 24px}',
    '.btn:disabled{opacity:.45;cursor:not-allowed}',
    'body{display:grid;place-items:center;min-height:100vh}',
  ].join(''),
  script: [
    "const button = root.querySelector('.btn');",
    "button.querySelector('.label').textContent = props.label;",
    'button.dataset.tone = props.tone;',
    'button.dataset.size = props.size;',
    'button.disabled = props.disabled;',
  ].join('\n'),
  props: {
    label: { kind: 'string', default: 'Continue', maxLength: 60 },
    tone: { kind: 'enum', default: 'primary', options: ['primary', 'neutral', 'danger'] },
    size: { kind: 'enum', default: 'md', options: ['sm', 'md', 'lg'] },
    disabled: { kind: 'boolean', default: false },
    radius: { kind: 'number', default: 6, min: 0, max: 24, step: 1 },
  },
  colorScheme: 'light',
  size: { width: 240, height: 120 },
} as const;

export const SYNTHETIC_BUTTON_VARIANTS = [
  { id: 'primary', name: 'Primary', props: { tone: 'primary' } },
  { id: 'neutral-small', name: 'Neutral small', props: { tone: 'neutral', size: 'sm', label: 'Cancel' } },
  { id: 'danger-pill', name: 'Danger pill', props: { tone: 'danger', radius: 24, label: 'Delete' } },
  { id: 'disabled', name: 'Disabled', props: { disabled: true } },
] as const;

export const SYNTHETIC_CARD = {
  componentId: 'synthetic-card',
  name: 'Synthetic Card',
  markup: '<article class="card" data-motion-target="card"><h2 class="title"></h2><p class="body"></p><span class="badge" data-motion-target="badge">New</span></article>',
  styles: [
    'body{display:grid;place-items:center;min-height:100vh;font-family:var(--font-family-base)}',
    '.card{position:relative;width:240px;padding:var(--space-4);border-radius:12px;background:var(--prop-surface);',
    'box-shadow:var(--elevation-card);color:var(--color-neutral-700)}',
    '.title{margin:0 0 8px;font-size:17px}.body{margin:0;font-size:13px;line-height:1.45}',
    '.badge{position:absolute;top:12px;right:12px;font-size:11px;padding:2px 8px;border-radius:99px;background:var(--color-action-primary);color:#fff}',
    '.card[data-badge="false"] .badge{display:none}',
  ].join(''),
  script: [
    "const card = root.querySelector('.card');",
    "card.querySelector('.title').textContent = props.title;",
    "card.querySelector('.body').textContent = props.body;",
    'card.dataset.badge = String(props.showBadge);',
  ].join('\n'),
  props: {
    title: { kind: 'string', default: 'Weekly summary', maxLength: 80 },
    body: { kind: 'string', default: 'Three synthetic items changed since your last visit.', maxLength: 300 },
    showBadge: { kind: 'boolean', default: true },
    surface: { kind: 'color', default: '#ffffff' },
  },
  colorScheme: 'light',
  size: { width: 320, height: 220 },
} as const;

export const SYNTHETIC_CARD_VARIANTS = [
  { id: 'default', name: 'Default', props: {} },
  { id: 'quiet', name: 'Quiet', props: { showBadge: false, surface: '#f1f3f5' } },
] as const;

export const SYNTHETIC_SYSTEM = {
  id: 'synthetic-system',
  name: 'Synthetic Sample System',
  tokens: [
    { id: 'color.brand.primary', type: 'color', value: '#3b5bdb', description: 'Primary brand hue' },
    { id: 'color.brand.danger', type: 'color', value: '#c92a2a' },
    { id: 'color.neutral.700', type: 'color', value: '#495057' },
    { id: 'color.action.primary', type: 'color', value: '{color.brand.primary}', description: 'Alias used by actions' },
    { id: 'space.2', type: 'dimension', value: '8px' },
    { id: 'space.4', type: 'dimension', value: '16px' },
    { id: 'font.family.base', type: 'fontFamily', value: 'system-ui, sans-serif' },
    { id: 'font.weight.bold', type: 'fontWeight', value: '600' },
    { id: 'elevation.card', type: 'shadow', value: '0 1px 2px rgba(0, 0, 0, 0.12), 0 8px 24px rgba(0, 0, 0, 0.08)' },
    { id: 'motion.duration.base', type: 'duration', value: '240ms' },
  ],
  groups: [
    { id: 'color', name: 'Color', tokenIds: ['color.brand.primary', 'color.brand.danger', 'color.neutral.700', 'color.action.primary'], componentIds: ['synthetic-button', 'synthetic-card'] },
    { id: 'layout', name: 'Spacing and elevation', tokenIds: ['space.2', 'space.4', 'elevation.card'], componentIds: ['synthetic-card'] },
    { id: 'type', name: 'Typography', tokenIds: ['font.family.base', 'font.weight.bold'], componentIds: ['synthetic-button'] },
  ],
} as const;

export const SYNTHETIC_MOTION = {
  id: 'synthetic-card-entrance',
  revision: 1,
  title: 'Card entrance',
  duration: 600,
  iterations: 1,
  direction: 'normal',
  component: { componentId: 'synthetic-card', revision: 1 },
  tracks: [
    {
      id: 'card-opacity', target: 'card', property: 'opacity',
      keyframes: [
        { offset: 0, value: 0, easing: { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 } },
        { offset: 0.6, value: 1, easing: { kind: 'linear' } },
      ],
    },
    {
      id: 'card-rise', target: 'card', property: 'translateY',
      keyframes: [
        { offset: 0, value: 24, easing: { kind: 'spring', stiffness: 170, damping: 26, mass: 1 } },
        { offset: 1, value: 0, easing: { kind: 'linear' } },
      ],
    },
    {
      id: 'badge-pop', target: 'badge', property: 'scale',
      keyframes: [
        { offset: 0, value: 0, easing: { kind: 'linear' } },
        { offset: 0.5, value: 0, easing: { kind: 'cubic-bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
        { offset: 1, value: 1, easing: { kind: 'linear' } },
      ],
    },
  ],
} as const;
