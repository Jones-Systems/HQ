import { isDestination } from '@hq/contracts';
import { DESIGN_NAV_IDS, type DesignLocation, type DesignNavId, type SectionSubRoutes } from '../contract.ts';
import { isSectionId } from './json.ts';

export const NAV_LABELS: Readonly<Record<DesignNavId, string>> = {
  projects: 'Projects', resources: 'Resources', review: 'Review', requests: 'Requests', runs: 'Runs',
};

export const DEFAULT_LOCATION: DesignLocation = { nav: 'projects', section: null };

export function isNavId(value: unknown): value is DesignNavId {
  return typeof value === 'string' && DESIGN_NAV_IDS.some((id) => id === value);
}

/** A shell destination is at most this long (the same bound as `isDestination`). */
export const MAX_DESTINATION = 512;
/** The one route prefix a descriptor can claim for per-entry views: `item/<encodeURIComponent(id)>`. */
export const ITEM_PREFIX = 'item' as const;
const FIXED_SUB = /^[a-z][a-z0-9-]{0,31}$/u;
/** Everything `encodeURIComponent` can emit. A raw `/` can never appear, so an item view is one segment after `item/`. */
const ITEM_ENCODED = /^[A-Za-z0-9\-_.!~*'()%]+$/u;
/** The nav id (at most 9 characters) and section id (at most 64) always fit in this prefix of any destination. */
const HEAD = 80;

const fixedShape = (value: string): boolean => value !== ITEM_PREFIX && FIXED_SUB.test(value);

/** A fixed view id: lowercase, digits and hyphens, starting with a letter, at most 32 characters, never `item`. */
export function isFixedSubId(value: unknown): value is string {
  return typeof value === 'string' && fixedShape(value);
}

/** The view for one library entry. Null when the id is empty or cannot be encoded (a lone surrogate). */
export function itemSub(id: string): string | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  try { return `${ITEM_PREFIX}/${encodeURIComponent(id)}`; } catch { return null; }
}

/**
 * The entry id of an `item/<encoded>` view, or null for anything else. Only the canonical
 * encoding is accepted (what `itemSub` produces), so a destination that parses always formats
 * back to the same string, and two spellings of one id never become two locations.
 */
export function itemIdOf(sub: string): string | null {
  if (typeof sub !== 'string' || !sub.startsWith(`${ITEM_PREFIX}/`)) return null;
  const encoded = sub.slice(ITEM_PREFIX.length + 1);
  if (!ITEM_ENCODED.test(encoded)) return null;
  try {
    const id = decodeURIComponent(encoded);
    return id.length > 0 && encodeURIComponent(id) === encoded ? id : null;
  } catch { return null; }
}

/** Grammar only: a fixed id or a canonical item view that fits a destination. Descriptors decide what is allowed. */
export function isSubShape(value: unknown): value is string {
  return typeof value === 'string'
    && (fixedShape(value) || (value.length <= MAX_DESTINATION && itemIdOf(value) !== null));
}

/** Closed check against one section's descriptor: a declared fixed id, or an item view when `itemPrefix` is declared. */
export function isValidSub(value: unknown, routes: SectionSubRoutes | undefined): value is string {
  if (typeof value !== 'string' || routes === undefined) return false;
  if (routes.fixed.some((route) => route.id === value)) return true;
  return routes.itemPrefix === ITEM_PREFIX && value.length <= MAX_DESTINATION && itemIdOf(value) !== null;
}

/** `projects`, `review/compare` or `review/compare/swipe`. Always a valid shell destination. */
export function formatDestination(location: DesignLocation): string {
  if (location.section === null) return location.nav;
  const base = `${location.nav}/${location.section}`;
  const sub = location.sub;
  if (sub === undefined || sub === null || !isSubShape(sub)) return base;
  const full = `${base}/${sub}`;
  return full.length <= MAX_DESTINATION ? full : base;
}

/** Finds a section's descriptor metadata. Without one, no view is ever recognised and `sub` stays null. */
export type SubRoutesLookup = (sectionId: string) => SectionSubRoutes | undefined;

/**
 * Parse the shell's opaque destination. Unknown or legacy values (the shell's
 * initial `home`) fall back to Projects rather than failing; the shell keeps
 * whatever it stored.
 *
 * Two-segment routes parse as they always did and carry no `sub` key. A third segment
 * is kept only when the section's descriptor (through `subRoutes`) declares it; anything
 * else, a malformed encoding, or a destination over 512 characters leaves the same valid
 * section with `sub: null` rather than losing the section.
 */
export function parseDestination(destination: string, subRoutes?: SubRoutesLookup): DesignLocation {
  const overlong = typeof destination === 'string' && destination.length > MAX_DESTINATION;
  if (!overlong && !isDestination(destination)) return DEFAULT_LOCATION;
  // An over-long destination is never a valid view; only its leading segments are inspected.
  const text = overlong ? destination.slice(0, HEAD) : destination;
  const first = text.indexOf('/');
  const nav = first < 0 ? text : text.slice(0, first);
  if (!isNavId(nav)) return DEFAULT_LOCATION;
  if (first < 0) return { nav, section: null };
  const second = text.indexOf('/', first + 1);
  const section = text.slice(first + 1, second < 0 ? undefined : second);
  const more = second >= 0 || overlong;
  if (!isSectionId(section)) return more ? DEFAULT_LOCATION : { nav, section: null };
  if (!more) return { nav, section };
  const raw = overlong ? null : text.slice(second + 1);
  const sub = raw !== null && subRoutes !== undefined && isValidSub(raw, subRoutes(section)) ? raw : null;
  return { nav, section, sub };
}

/** Same nav, section and view. An absent `sub` equals null. */
export function sameLocation(a: DesignLocation, b: DesignLocation): boolean {
  return a.nav === b.nav && a.section === b.section && (a.sub ?? null) === (b.sub ?? null);
}
