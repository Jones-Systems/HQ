/**
 * Display-only naming and ordering for flows. Nothing here edits a document, derives an
 * identifier, or creates a transition: titles, IDs, versions and capture digests stay as stored.
 */
import type { FlowDocument, Screen, ScreenId } from './contract.ts';
import { deriveEdges, indexFlow, screenDepths } from './edges.ts';

/** Query keys that commonly name a screen inside a single-page prototype. */
const SCREEN_KEYS = ['screen', 'page', 'view', 'step', 'tab'];

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function humanize(token: string): string {
  const words = decode(token).replace(/\.[a-z0-9]{1,5}$/iu, '').replace(/[-_+.]+/gu, ' ').trim();
  return words === '' ? '' : words[0]!.toUpperCase() + words.slice(1);
}

/** Captured titles default to the raw route; owner-authored titles are always shown as written. */
const routeLike = (screen: Screen): boolean => screen.title === screen.route || screen.title.startsWith('/');

/** A short readable name for a route, e.g. `/site/v1/weddings/` → `Weddings`, `?screen=today` → `Today`. */
export function routeName(route: string): string {
  let url: URL;
  try { url = new URL(route, 'https://example.com/'); } catch { return route; }
  for (const key of SCREEN_KEYS) {
    const value = url.searchParams.get(key);
    if (value) return humanize(value) || value;
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const last = segments.at(-1);
  if (last === undefined || /^(index|default|home)(\.[a-z0-9]{1,5})?$/iu.test(last)) return 'Home';
  return humanize(last) || last;
}

/** Captured states are JSON strings of the URL hash; an empty or `default` state has no label. */
export function stateLabel(state: string): string | null {
  let value = state;
  if (state.startsWith('"')) { try { const parsed: unknown = JSON.parse(state); if (typeof parsed === 'string') value = parsed; } catch { /* shown as stored */ } }
  return value === '' || value === 'default' ? null : value;
}

export function screenName(screen: Screen): string {
  if (!routeLike(screen)) return screen.title;
  const name = routeName(screen.route);
  const state = stateLabel(screen.state);
  return state && state.startsWith('#') && state.length > 1 ? `${name} ${humanize(state.slice(1))}`.trim() : name;
}

/**
 * Screens in a readable order: the start screen, then screens its links reach (by depth, then saved
 * order), then every other screen in saved order. Ordering is presentation, never a link.
 */
export function screenSequence(flow: FlowDocument): readonly Screen[] {
  const index = indexFlow(flow);
  const depth = screenDepths(flow, index, deriveEdges(flow, index));
  const saved = new Map(flow.screens.map((screen, position) => [screen.id, position]));
  return [...flow.screens].sort((a, b) => {
    const da = depth.get(a.id) ?? Number.POSITIVE_INFINITY;
    const db = depth.get(b.id) ?? Number.POSITIVE_INFINITY;
    return da === db ? saved.get(a.id)! - saved.get(b.id)! : da - db;
  });
}

/** Unique display names; repeated names gain their position in the sequence. */
export function screenNames(flow: FlowDocument): ReadonlyMap<ScreenId, string> {
  const sequence = screenSequence(flow);
  const base = new Map(sequence.map((screen) => [screen.id, screenName(screen)]));
  const counts = new Map<string, number>();
  for (const name of base.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(sequence.map((screen) => {
    const name = base.get(screen.id)!;
    if (counts.get(name)! < 2) return [screen.id, name];
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return [screen.id, `${name} (${n})`];
  }));
}
