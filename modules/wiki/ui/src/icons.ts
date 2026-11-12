// Inline SVG icons drawn as React elements (no files, no URLs), in the rail's 24-unit, 1.6-stroke style.
// Icons are decorative: the control that holds one always carries a text label or an aria-label.

import { createElement as h, type ReactElement } from 'react';

export const ICON_NAMES = [
  'back', 'forward', 'home', 'search', 'history', 'topics', 'page', 'settings', 'chevron-right', 'chevron-down',
  'external', 'link', 'missing', 'refresh', 'close', 'menu', 'check', 'alert', 'info', 'folder', 'ambiguous', 'outline',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  back: ['M15 18 9 12l6-6'],
  forward: ['m9 18 6-6-6-6'],
  home: ['M4 11.5 12 5l8 6.5', 'M6.5 10v9h11v-9', 'M10 19v-5h4v5'],
  search: ['M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6Z', 'm15.8 15.8 4.2 4.2'],
  history: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v3.7h3.7', 'M12 8v4.3l2.8 1.7'],
  topics: ['M9.5 4 7.5 20', 'M16.5 4l-2 16', 'M4.5 9h15', 'M3.5 15h15'],
  page: ['M7 3.5h7l4 4v13H7z', 'M14 3.5v4h4', 'M9.5 12h6', 'M9.5 15.5h6'],
  settings: ['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z'],
  'chevron-right': ['m10 7 5 5-5 5'],
  'chevron-down': ['m7 10 5 5 5-5'],
  external: ['M13.5 5.5H19v5.5', 'M19 5.5 11 13.5', 'M17 14v4.5H6V7.5h4.5'],
  link: ['M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1', 'M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1'],
  missing: ['M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1', 'M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1', 'M4 4l16 16'],
  refresh: ['M19.5 12a7.5 7.5 0 0 1-13.1 5', 'M4.5 12a7.5 7.5 0 0 1 13.1-5', 'M17.6 3.5V7h-3.5', 'M6.4 20.5V17h3.5'],
  close: ['m7 7 10 10', 'M17 7 7 17'],
  menu: ['M4.5 6.5h15', 'M4.5 12h15', 'M4.5 17.5h15'],
  check: ['m5.5 12.5 4 4 9-9'],
  alert: ['M12 4 21 19.5H3Z', 'M12 10v4', 'M12 17h.01'],
  info: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z', 'M12 11v5', 'M12 8h.01'],
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z'],
  ambiguous: ['M7 7.5h6.5a3 3 0 0 1 0 6H12', 'M12 17h.01', 'M4.5 4.5h4', 'M4.5 19.5h4'],
  outline: ['M5 6.5h14', 'M8 12h11', 'M11 17.5h8'],
};

/** A decorative icon (`aria-hidden`). `spin` rotates it while work is in progress (static under reduced motion). */
export function Icon(props: { readonly name: IconName; readonly spin?: boolean; readonly className?: string }): ReactElement {
  const classes = ['wiki-icon', `wiki-icon--${props.name}`];
  if (props.spin === true) classes.push('wiki-icon--spin');
  if (props.className !== undefined) classes.push(props.className);
  return h(
    'svg',
    {
      className: classes.join(' '),
      viewBox: '0 0 24 24',
      width: 18,
      height: 18,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      'data-icon': props.name,
    },
    PATHS[props.name].map((d, index) => h('path', { key: index, d })),
  );
}
