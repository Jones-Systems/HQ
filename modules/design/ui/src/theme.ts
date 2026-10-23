import type { ResolvedAppearance } from '@hq/contracts';
import type { IntendedScheme, ShellThemeTokens, SurfaceKind, SurfaceProps, SurfaceStyle } from '../contract.ts';

export const TOKEN_NAMES = ['background', 'surface', 'text', 'muted', 'line', 'selected', 'accent'] as const satisfies readonly (keyof ShellThemeTokens)[];

/**
 * Literal fallbacks for standalone chrome. The shared kit supplies the active palette
 * when no valid shell colour is supplied; untrusted CSS never enters the variable reference.
 */
export const FALLBACK_TOKENS: Readonly<Record<ResolvedAppearance, ShellThemeTokens>> = {
  light: { background: '#f8f9fb', surface: '#ffffff', text: '#20232a', muted: '#69717e', line: '#e2e5eb', selected: '#e9edf6', accent: '#516aa2' },
  dark: { background: '#17191d', surface: '#1d2025', text: '#eceef2', muted: '#a2a9b5', line: '#30353d', selected: '#2b3446', accent: '#a2b8ee' },
};

const KIT_TOKENS = { background: 'canvas', surface: 'surface', text: 'text', muted: 'text-muted', line: 'border', selected: 'surface-selected', accent: 'accent-strong' } as const;

/** Conservative colour grammar: no url(), var(), nesting, or declaration breakouts. */
export function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)
    || /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]{1,64}\)$/iu.test(value));
}

export interface ChromeTheme {
  readonly appearance: ResolvedAppearance;
  /** CSS custom properties applied to the chrome root only. */
  readonly vars: Readonly<Record<`--hqd-${(typeof TOKEN_NAMES)[number]}`, string>>;
  /** Tokens that failed validation and fell back. */
  readonly rejected: readonly string[];
}

export function chromeTheme(appearance: ResolvedAppearance, tokens: ShellThemeTokens | undefined): ChromeTheme {
  const fallback = FALLBACK_TOKENS[appearance];
  const rejected: string[] = [];
  const entries = TOKEN_NAMES.map((name) => {
    const supplied = tokens?.[name];
    if (supplied !== undefined && !isCssColor(supplied)) rejected.push(name);
    return [`--hqd-${name}`, isCssColor(supplied) ? supplied : `var(--hq-${KIT_TOKENS[name]}, ${fallback[name]})`] as const;
  });
  return { appearance, vars: Object.fromEntries(entries) as ChromeTheme['vars'], rejected };
}

/**
 * Style for any element showing captured bytes or a producer preview. It takes
 * no appearance argument on purpose: HQ's theme cannot reach captures or
 * previews. `normal` keeps the producer's own default; a version that is itself
 * a dark-mode capture/preview passes its intended scheme explicitly.
 */
export function surfaceProps(kind: SurfaceKind, intended: IntendedScheme = 'normal'): SurfaceProps {
  const style: SurfaceStyle = {
    colorScheme: intended, filter: 'none', mixBlendMode: 'normal', opacity: 1,
    isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent',
  };
  return { 'data-hqd-surface': kind, style };
}
