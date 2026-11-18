import type {
  ComponentId, DesignSystem, DesignToken, TokenGroup, TokenId, TokenType,
} from '../contract.ts';
import { brandId } from './ids.ts';
import { deepFreeze } from './jcs.ts';
import { COLOR_PATTERN } from './props.ts';

const TOKEN_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){0,7}$/u;
const ALIAS = /^\{([a-z][a-z0-9-]*(?:\.[a-z0-9-]+){0,7})\}$/u;
const TOKEN_TYPES: readonly TokenType[] = ['color', 'dimension', 'duration', 'number', 'fontFamily', 'fontWeight', 'shadow'];

const LITERAL: Readonly<Record<TokenType, RegExp>> = {
  color: COLOR_PATTERN,
  dimension: /^-?\d+(\.\d+)?(px|rem|em|%|vw|vh)$|^0$/u,
  duration: /^\d+(\.\d+)?(ms|s)$/u,
  number: /^-?\d+(\.\d+)?$/u,
  fontFamily: /^[A-Za-z0-9 ,'"-]{1,200}$/u,
  fontWeight: /^[1-9]00$/u,
  shadow: /^[A-Za-z0-9 #.,()%-]{1,200}$/u,
};

export type TokenProblem =
  | { readonly kind: 'missing-alias'; readonly tokenId: TokenId; readonly target: string }
  | { readonly kind: 'alias-cycle'; readonly path: readonly TokenId[] }
  | { readonly kind: 'alias-type'; readonly tokenId: TokenId; readonly target: TokenId }
  | { readonly kind: 'alias-unresolved'; readonly tokenId: TokenId };

export interface ResolvedTokens {
  /** Token id to resolved literal value; tokens with problems are omitted. */
  readonly values: Readonly<Record<string, string>>;
  readonly problems: readonly TokenProblem[];
}

function parseToken(value: unknown): DesignToken {
  if (value === null || typeof value !== 'object') throw new TypeError('Token must be an object.');
  const token = value as Record<string, unknown>;
  const id = brandId('TokenId', token.id);
  if (!TOKEN_ID.test(id)) throw new TypeError(`Token id "${id}" must be dotted lowercase segments.`);
  if (!TOKEN_TYPES.includes(token.type as TokenType)) throw new TypeError(`Token "${id}" has an unknown type.`);
  const type = token.type as TokenType;
  if (typeof token.value !== 'string' || (!ALIAS.test(token.value) && !LITERAL[type].test(token.value))) {
    throw new TypeError(`Token "${id}" value is not a valid ${type} or alias.`);
  }
  if (token.description !== undefined && (typeof token.description !== 'string' || token.description.length > 500)) {
    throw new TypeError(`Token "${id}" description is invalid.`);
  }
  return {
    id, type, value: token.value,
    ...(typeof token.description === 'string' ? { description: token.description } : {}),
  };
}

export function parseDesignSystem(value: unknown): DesignSystem {
  if (value === null || typeof value !== 'object') throw new TypeError('Design system must be an object.');
  const system = value as Record<string, unknown>;
  if (!Array.isArray(system.tokens) || !Array.isArray(system.groups)) throw new TypeError('Design system needs token and group lists.');
  if (typeof system.name !== 'string' || system.name.trim().length === 0 || system.name.length > 200) throw new TypeError('Design system name is invalid.');
  const tokens = system.tokens.map(parseToken);
  const ids = new Set<string>();
  for (const token of tokens) {
    if (ids.has(token.id)) throw new TypeError(`Duplicate token id "${token.id}".`);
    ids.add(token.id);
  }
  const groupIds = new Set<string>();
  const groups: TokenGroup[] = system.groups.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new TypeError('Group must be an object.');
    const group = item as Record<string, unknown>;
    const id = brandId('TokenGroupId', group.id);
    if (groupIds.has(id)) throw new TypeError(`Duplicate group id "${id}".`);
    groupIds.add(id);
    if (typeof group.name !== 'string' || group.name.trim().length === 0) throw new TypeError(`Group "${id}" name is invalid.`);
    if (!Array.isArray(group.tokenIds) || !Array.isArray(group.componentIds)) throw new TypeError(`Group "${id}" lists are invalid.`);
    const tokenIds = group.tokenIds.map((tokenId: unknown) => {
      const parsed = brandId('TokenId', tokenId);
      if (!ids.has(parsed)) throw new TypeError(`Group "${id}" references unknown token "${parsed}".`);
      return parsed;
    });
    const componentIds = group.componentIds.map((componentId: unknown) => brandId('ComponentId', componentId));
    return { id, name: group.name, tokenIds, componentIds };
  });
  return deepFreeze({ id: brandId('DesignSystemId', system.id), name: system.name, tokens, groups });
}

/** Resolves aliases with cycle and type checks; problems are reported, never guessed. */
export function resolveTokens(system: DesignSystem): ResolvedTokens {
  const byId = new Map(system.tokens.map((token) => [token.id as string, token]));
  const values: Record<string, string> = {};
  const problems: TokenProblem[] = [];
  const failed = new Set<string>();
  const reportedCycles = new Set<string>();

  const resolve = (token: DesignToken, path: TokenId[]): string | null => {
    if (token.id in values) return values[token.id] ?? null;
    if (failed.has(token.id)) return null;
    const alias = ALIAS.exec(token.value);
    if (alias === null) return token.value;
    if (path.includes(token.id)) {
      const cycle = [...path.slice(path.indexOf(token.id)), token.id];
      const key = [...cycle].sort().join('|');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        problems.push({ kind: 'alias-cycle', path: cycle });
      }
      return null;
    }
    const target = byId.get(alias[1] as string);
    if (target === undefined) {
      problems.push({ kind: 'missing-alias', tokenId: token.id, target: alias[1] as string });
      return null;
    }
    if (target.type !== token.type) {
      problems.push({ kind: 'alias-type', tokenId: token.id, target: target.id });
      return null;
    }
    return resolve(target, [...path, token.id]);
  };

  for (const token of system.tokens) {
    const value = resolve(token, []);
    if (value !== null) {
      values[token.id] = value;
      continue;
    }
    failed.add(token.id);
    const named = problems.some((problem) => (problem.kind === 'alias-cycle' ? problem.path.includes(token.id) : problem.tokenId === token.id));
    if (!named) problems.push({ kind: 'alias-unresolved', tokenId: token.id });
  }
  return deepFreeze({ values, problems });
}

export function tokenCssName(id: string): string {
  return `--${id.replace(/\./gu, '-')}`;
}

/** Emits only validated literal values, so token text cannot break out of the rule. */
export function tokensToCss(values: Readonly<Record<string, string>>): string {
  const lines = Object.keys(values).sort().map((id) => `${tokenCssName(id)}:${values[id]};`);
  return lines.length === 0 ? '' : `:root{${lines.join('')}}`;
}

export interface TokenGroupView {
  readonly id: string;
  readonly name: string;
  readonly byType: readonly { readonly type: TokenType; readonly tokens: readonly DesignToken[] }[];
  readonly componentIds: readonly ComponentId[];
}

/** Design-system grouping, plus an explicit "Ungrouped" bucket so no token is hidden. */
export function groupTokens(system: DesignSystem): readonly TokenGroupView[] {
  const byId = new Map(system.tokens.map((token) => [token.id as string, token]));
  const grouped = new Set<string>();
  const view = (id: string, name: string, tokens: readonly DesignToken[], componentIds: readonly ComponentId[]): TokenGroupView => ({
    id, name, componentIds,
    byType: TOKEN_TYPES
      .map((type) => ({ type, tokens: tokens.filter((token) => token.type === type) }))
      .filter((bucket) => bucket.tokens.length > 0),
  });
  const views = system.groups.map((group) => {
    const tokens = group.tokenIds.map((id) => byId.get(id)).filter((token): token is DesignToken => token !== undefined);
    for (const token of tokens) grouped.add(token.id);
    return view(group.id, group.name, tokens, group.componentIds);
  });
  const ungrouped = system.tokens.filter((token) => !grouped.has(token.id));
  return ungrouped.length === 0 ? views : [...views, view('ungrouped', 'Ungrouped', ungrouped, [])];
}
