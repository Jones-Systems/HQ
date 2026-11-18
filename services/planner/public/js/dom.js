// DOM helpers. Owner text is only ever inserted as text nodes or attribute
// values; nothing in this app assigns innerHTML from data. Links are also
// refused a script-running scheme, whatever the stored data says.

const SVG_NS = 'http://www.w3.org/2000/svg';
// Browsers ignore ASCII whitespace and control characters inside a scheme.
const UNSAFE_URL = /^(javascript|data|vbscript):/i;
const isUnsafeUrl = (value) => UNSAFE_URL.test(String(value).replace(/[\u0000-\u0020]/g, ''));

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if ((key === 'href' || key === 'src') && isUnsafeUrl(value)) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for'
      || key === 'list' || key === 'inputmode' || key === 'enterkeyhint' || key === 'autocomplete') {
      el.setAttribute(key, value === true ? 'true' : String(value));
    } else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  glance: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  board: 'M4 4h4.5v16H4zM10 4h4v11h-4zM15.5 4H20v13h-4.5z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  calendar: 'M4 6h16v14H4zM4 10.5h16M8.5 3v4.5M15.5 3v4.5',
  timeline: 'M3 6h10M7 12h13M3 18h8M3 3v18',
  review: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM8 12.5l3 3 5-6.5',
  archive: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4',
  x: 'M6 6l12 12M18 6L6 18',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9.5l5-5 5 5M5 20h14',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  check: 'M5 12.5l4.5 4.5L19 7',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  data: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7.5V12l3 2',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  target: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 11.9v.2',
  deadline: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
  start: 'M8 5l11 7-11 7z',
  event: 'M4 6h16v14H4zM4 10.5h16M8.5 3v4.5M15.5 3v4.5M12 13.5v.01',
  project: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  goal: 'M3 20l6.5-11 4 6.5 2.5-4L21 20z',
  chore: 'M4 4h16v16H4zM8 12l3 3 5-6',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2',
  steps: 'M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  offline: 'M3 3l18 18M8.5 6.5A6 6 0 0 1 18 11a4 4 0 0 1 1.7 7.3M16 18H7a4 4 0 0 1-1.5-7.7',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  help: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  flag: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
  cloudCheck: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 10a4 4 0 0 1 0 8zM9.5 13.5l2 2 3.5-4',
  sidebar: 'M4 4h16v16H4zM9.5 4v16',
};

export function icon(name, { size = 18, label = null, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const dots = name === 'more' || name === 'grip' ? 'icon-dots' : '';
  svg.setAttribute('class', `icon ${dots} ${className}`.replace(/\s+/g, ' ').trim());
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.help);
  svg.append(path);
  return svg;
}

let liveRegion = null;
export function announce(message) {
  if (!liveRegion) liveRegion = document.getElementById('live-region');
  if (!liveRegion) return;
  liveRegion.textContent = '';
  // A fresh text node makes repeated identical messages audible.
  requestAnimationFrame(() => { liveRegion.textContent = message; });
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function button(label, { icon: iconName = null, onClick = null, kind = '', title = null,
  iconOnly = false, disabled = false, attrs = {} } = {}) {
  const btn = h('button', {
    type: 'button',
    class: ['btn', kind && `btn-${kind}`, iconOnly && 'btn-icon'],
    title: title || (iconOnly ? label : null),
    'aria-label': iconOnly ? label : null,
    disabled,
    on: onClick ? { click: onClick } : null,
    ...attrs,
  });
  if (iconName) btn.append(icon(iconName));
  if (!iconOnly) btn.append(h('span', { text: label }));
  return btn;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
