// Pure configuration for the dev-preview tools: modes, sizes, navigation selectors, keys and
// media features. Nothing here touches the filesystem or the network, so it is unit tested.

export class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError'; }
}

export const MODES = Object.freeze(['example', 'live', 'offline']);
export const DEFAULT_MODE = 'example';
export const DEFAULT_SIZE = Object.freeze({ width: 1440, height: 900 });
export const THEMES = Object.freeze(['light', 'dark']);
export const DOMAINS = Object.freeze(['Design', 'Social', 'Work', 'Wiki']);
// Nothing can listen on a privileged port as an ordinary user, so a connection here is refused.
export const OFFLINE_ORIGIN = 'http://127.0.0.1:9';

const LIMITS = Object.freeze({ minWidth: 320, maxWidth: 3840, minHeight: 240, maxHeight: 2400 });

export function parseSize(value) {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(value ?? '').trim().toLowerCase());
  if (!match) throw new UsageError(`Invalid size "${value}": expected WIDTHxHEIGHT such as 1440x900`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < LIMITS.minWidth || width > LIMITS.maxWidth || height < LIMITS.minHeight || height > LIMITS.maxHeight) {
    throw new UsageError(`Size ${width}x${height} is outside ${LIMITS.minWidth}x${LIMITS.minHeight}..${LIMITS.maxWidth}x${LIMITS.maxHeight}`);
  }
  return { width, height };
}

/** Accepts `undefined`, a "WxH" string or a `{width, height}` object. */
export function resolveSize(value) {
  if (value === undefined || value === null) return { ...DEFAULT_SIZE };
  if (typeof value === 'object') return parseSize(`${value.width}x${value.height}`);
  return parseSize(value);
}

export function formatSize({ width, height }) { return `${width}x${height}`; }

/** Comma separated sizes, in order, without duplicates. */
export function parseSizes(text) {
  const parts = String(text ?? '').split(',').map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new UsageError('Expected at least one size such as 1440x900,760x560');
  const seen = new Set();
  const sizes = [];
  for (const part of parts) {
    const size = parseSize(part);
    if (seen.has(formatSize(size))) continue;
    seen.add(formatSize(size));
    sizes.push(size);
  }
  return sizes;
}

export function parseMode(value = DEFAULT_MODE) {
  if (!MODES.includes(value)) throw new UsageError(`Unknown mode "${value}": use ${MODES.join(', ')}`);
  return value;
}

export function parseThemes(text) {
  const themes = String(text ?? '').split(',').map(part => part.trim()).filter(Boolean);
  if (!themes.length) throw new UsageError('Expected at least one theme: light, dark');
  for (const theme of themes) if (!THEMES.includes(theme)) throw new UsageError(`Unknown theme "${theme}": use ${THEMES.join(', ')}`);
  return [...new Set(themes)];
}

/**
 * The service-config.json the app should find in its profile for a mode, or `null` for none.
 * `example` leaves the app on its built-in examples; `live` points at running fixtures;
 * `offline` configures endpoints nothing answers on.
 */
export function serviceConfigFor(mode, origins = {}) {
  parseMode(mode);
  if (mode === 'example') return null;
  if (mode === 'offline') return { work: OFFLINE_ORIGIN, social: OFFLINE_ORIGIN };
  if (!origins.work || !origins.social) throw new Error('live mode needs both work and social origins');
  return { work: origins.work, social: origins.social };
}

export const modeNeedsFixtures = mode => parseMode(mode) === 'live';

// ---- navigation. Lane F1 is redesigning the shell rail: every app selector the tools depend on
// lives in this one table. Lookups scope to these containers first, then fall back to any
// visible button/link/tab whose accessible name matches, so a renamed container degrades softly.

export const NAV = Object.freeze({
  /** Containers searched, in order, for the domain switcher buttons. */
  domainScopes: Object.freeze(['nav[aria-label="Domains"]', 'aside[aria-label="HQ navigation"]', '[role="navigation"]']),
  /** Containers searched, in order, for the Settings entry. */
  settingsScopes: Object.freeze(['.rail-footer', 'aside[aria-label="HQ navigation"]', '[role="navigation"]']),
  settingsName: 'Settings',
  /** Marks the selected item; used to confirm that a click landed. */
  current: '[aria-current="page"]',
  /** Something rendered, used to decide the app has mounted. */
  mounted: 'main, [role="main"], nav, aside, [data-hq-chrome]',
});

/**
 * What "still loading" looks like. Settling waits (bounded) for these to disappear so a shot does not
 * capture "Loading…". Elements by selector, plus short visible text that starts with a loading word.
 */
export const BUSY = Object.freeze({
  selectors: Object.freeze(['[aria-busy="true"]', '[role="progressbar"]', '.hq-spinner', '.hq-skeleton', '.hq-state--loading']),
  textPattern: '^(loading|checking|fetching|connecting|refreshing|saving)\\b',
});

// ---- keys

export const MODIFIERS = Object.freeze({ alt: 1, ctrl: 2, meta: 4, shift: 8 });
const MODIFIER_ALIASES = Object.freeze({ control: 'ctrl', cmd: 'meta', command: 'meta', option: 'alt', opt: 'alt' });
const KEY_CODES = Object.freeze({
  Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
  Backspace: 8, Space: 32, Home: 36, End: 35, Delete: 46, PageDown: 34, PageUp: 33,
});
const KEY_ALIASES = Object.freeze({
  esc: 'Escape', return: 'Enter', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  pgdn: 'PageDown', pgup: 'PageUp', ' ': 'Space',
});
export const KEY_NAMES = Object.freeze(Object.keys(KEY_CODES));

export function normalizeKey(value) {
  const text = String(value ?? '');
  if (text.length === 1 && text !== ' ') return text;
  const exact = KEY_NAMES.find(name => name.toLowerCase() === text.toLowerCase());
  const key = exact ?? KEY_ALIASES[text.toLowerCase()];
  if (!key) throw new UsageError(`Unknown key "${value}": use a single character or one of ${KEY_NAMES.join(', ')}`);
  return key;
}

export function normalizeModifiers(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const mods = [];
  for (const raw of list.map(part => String(part).trim().toLowerCase()).filter(Boolean)) {
    const mod = MODIFIER_ALIASES[raw] ?? raw;
    if (!Object.hasOwn(MODIFIERS, mod)) throw new UsageError(`Unknown modifier "${raw}": use ${Object.keys(MODIFIERS).join(', ')}`);
    if (!mods.includes(mod)) mods.push(mod);
  }
  return mods;
}

/** CDP `Input.dispatchKeyEvent` parameter sets (key down, key up) for one key press. */
export function keyEvents(keyName, mods = []) {
  const key = normalizeKey(keyName);
  const modifiers = normalizeModifiers(mods).reduce((sum, mod) => sum | MODIFIERS[mod], 0);
  const named = Object.hasOwn(KEY_CODES, key);
  const code = named ? KEY_CODES[key] : key.toUpperCase().charCodeAt(0);
  const domCode = named ? (key === 'Space' ? 'Space' : key) : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : '';
  const typed = !(modifiers & (MODIFIERS.ctrl | MODIFIERS.meta | MODIFIERS.alt));
  const text = key === 'Enter' ? '\r' : key === 'Space' ? ' ' : !named && typed ? key : undefined;
  const base = { key: key === 'Space' ? ' ' : key, code: domCode, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  return [
    { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) },
    { type: 'keyUp', ...base },
  ];
}

// ---- media emulation

export const MEDIA_FEATURES = Object.freeze({
  'prefers-color-scheme': Object.freeze(['light', 'dark', 'no-preference']),
  'prefers-reduced-motion': Object.freeze(['reduce', 'no-preference']),
  'prefers-contrast': Object.freeze(['more', 'less', 'custom', 'no-preference']),
  'prefers-reduced-transparency': Object.freeze(['reduce', 'no-preference']),
  'prefers-reduced-data': Object.freeze(['reduce', 'no-preference']),
  'forced-colors': Object.freeze(['active', 'none']),
  'color-gamut': Object.freeze(['srgb', 'p3', 'rec2020']),
});

/** Parses `feature=value` pairs (or an object) into a validated `{feature: value}` map. */
export function parseMediaFeatures(input) {
  const pairs = Array.isArray(input) ? input.map(item => {
    const index = String(item).indexOf('=');
    if (index < 1) throw new UsageError(`Invalid media setting "${item}": expected feature=value, e.g. prefers-color-scheme=dark`);
    return [String(item).slice(0, index).trim(), String(item).slice(index + 1).trim()];
  }) : Object.entries(input ?? {});
  if (!pairs.length) throw new UsageError('Expected at least one feature=value pair, e.g. prefers-color-scheme=dark');
  const features = {};
  for (const [name, value] of pairs) {
    if (!Object.hasOwn(MEDIA_FEATURES, name)) throw new UsageError(`Unknown media feature "${name}": use ${Object.keys(MEDIA_FEATURES).join(', ')}`);
    if (!MEDIA_FEATURES[name].includes(value)) throw new UsageError(`Invalid value "${value}" for ${name}: use ${MEDIA_FEATURES[name].join(', ')}`);
    features[name] = value;
  }
  return features;
}

// ---- host fonts. This VPS maps sans-serif/system-ui to a monospace face, which makes every
// screenshot look wrong. The alias lives only in the sandbox's private fontconfig.

export const FONT_ALIASES = Object.freeze(['sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'IBM Plex Sans', 'Inter']);
export const PREFERRED_FACES = Object.freeze(['Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Arimo']);

export function pickFace(families) {
  const available = new Set(families.map(family => family.trim().toLowerCase()));
  return PREFERRED_FACES.find(face => available.has(face.toLowerCase())) ?? null;
}

const escapeXml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function fontconfigXml(face, aliases = FONT_ALIASES) {
  const rules = aliases.map(family => `<match target="pattern"><test name="family"><string>${escapeXml(family)}</string></test><edit name="family" mode="prepend" binding="strong"><string>${escapeXml(face)}</string></edit></match>`).join('');
  return `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include>${rules}</fontconfig>\n`;
}
