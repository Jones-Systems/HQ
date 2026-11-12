import type { ComponentId, ComponentSource, DesignSystem, PropValues, TokenId, TokenType } from '../contract.ts';

/**
 * Metadata for the held blueprint. Component execution is held, so the stage is drawn from what the component
 * declares (size, props, tokens), never from its markup, styles or script. Nothing here reads those fields.
 */

/** Width presets of the stage: the declared width, or a fixed frame width in pixels. */
export type WidthPreset = 'fit' | 320 | 480;
export const WIDTH_PRESETS: readonly WidthPreset[] = ['fit', 320, 480];

/** Prop names that usually carry a component's visible text, in preference order. */
const TEXT_PROP_NAMES = ['label', 'title', 'text', 'name'] as const;

/** The resolved value of the prop that best stands for the component's text: a known name, else the first string prop. */
export function primaryText(source: ComponentSource, props: PropValues): { readonly name: string; readonly text: string } | null {
  const strings = Object.entries(source.props).filter(([, spec]) => spec.kind === 'string').map(([name]) => name);
  const name = TEXT_PROP_NAMES.find((candidate) => strings.includes(candidate)) ?? strings[0];
  if (name === undefined) return null;
  const value = props[name];
  return typeof value === 'string' ? { name, text: value } : null;
}

/** `Primary · “Continue”`, or just the variant name when the component has no text prop. */
export function blueprintCaption(variantName: string, text: string | null): string {
  const flat = text === null ? '' : text.replace(/\s+/gu, ' ').trim();
  if (flat === '') return variantName;
  const shown = flat.length > 32 ? `${flat.slice(0, 31)}…` : flat;
  return `${variantName} · “${shown}”`;
}

/** The frame size for a width preset: `fit` is the declared size; a number fixes the width and keeps the declared height. */
export function frameSize(declared: { readonly width: number; readonly height: number }, preset: WidthPreset): { readonly width: number; readonly height: number } {
  return preset === 'fit' ? { width: declared.width, height: declared.height } : { width: preset, height: declared.height };
}

export function dimsLabel(size: { readonly width: number; readonly height: number }): string {
  return `${size.width} × ${size.height}`;
}

export interface UsedToken {
  readonly id: TokenId;
  readonly type: TokenType;
  /** Resolved literal, or null when the token has a problem and did not resolve. */
  readonly value: string | null;
  readonly group: string;
}

/**
 * Tokens a component is declared to use: every token of each group that lists the component. This is the design
 * system's own declaration; it is not derived from the component's styles.
 */
export function tokensUsedBy(
  systems: readonly DesignSystem[],
  componentId: ComponentId,
  values: Readonly<Record<string, string>>,
): readonly UsedToken[] {
  const seen = new Set<string>();
  const used: UsedToken[] = [];
  for (const system of systems) {
    const byId = new Map(system.tokens.map((token) => [token.id as string, token]));
    for (const group of system.groups) {
      if (!group.componentIds.includes(componentId)) continue;
      for (const tokenId of group.tokenIds) {
        const token = byId.get(tokenId);
        if (token === undefined || seen.has(token.id)) continue;
        seen.add(token.id);
        used.push({ id: token.id, type: token.type, value: values[token.id] ?? null, group: group.name });
      }
    }
  }
  return used;
}
