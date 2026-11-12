/**
 * Display-only naming and ordering for flows. Nothing here edits a document, derives an
 * identifier, or creates a transition: titles, IDs, versions and capture digests stay as stored.
 */
import type { FlowDocument, HotspotId, Screen, ScreenId } from './contract.ts';
import { deriveEdges, indexFlow, screenDepths, type FlowEdge } from './edges.ts';
import type { PlayerState, PlayerStep } from './player.ts';

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

// ---------------------------------------------------------------------------------------------
// Playback presentation: which way a screen change moves, which link was just followed, and the
// short texts the header and notices show. Pure display logic; nothing here edits a document.
// ---------------------------------------------------------------------------------------------

/** A step that changed the visible screen. Broken, exit and unavailable steps leave the screen where it was. */
export interface ScreenMove {
  /** Index of the player step that made the move; changes on every move, even to the same screen. */
  readonly index: number;
  readonly kind: 'entered' | 'navigated' | 'back';
  /** The screen shown before this move; null for the first screen. */
  readonly from: ScreenId | null;
  readonly to: ScreenId;
  /** The hotspot that was activated, or null for player chrome (Start, Previous, Next, Back, the filmstrip, the map). */
  readonly edgeId: HotspotId | null;
}

/** The most recent move in a playback log. */
export function lastMove(steps: readonly PlayerStep[]): ScreenMove | null {
  let at: ScreenId | null = null;
  let move: ScreenMove | null = null;
  for (const step of steps) {
    const { outcome } = step;
    if (outcome.kind !== 'entered' && outcome.kind !== 'navigated' && outcome.kind !== 'back') continue;
    move = { index: step.index, kind: outcome.kind, from: at, to: outcome.to, edgeId: step.edgeId };
    at = outcome.to;
  }
  return move;
}

export type StepDirection = 'forward' | 'back' | 'none';

/**
 * Which way the new screen arrives. Back always arrives from the start side. Anything else compares the
 * two screens' places in the screen list, so Next and a link to a later screen go forward, while Previous
 * and a link to an earlier screen go back. The first screen and a repeat of the same screen do not move.
 */
export function moveDirection(order: readonly ScreenId[], move: ScreenMove | null): StepDirection {
  if (move === null || move.from === null || move.from === move.to) return 'none';
  if (move.kind === 'back') return 'back';
  const from = order.indexOf(move.from);
  const to = order.indexOf(move.to);
  if (from < 0 || to < 0) return 'none';
  return to > from ? 'forward' : 'back';
}

/** A link the player just followed, as the map should show it. */
export interface TraversedEdge {
  readonly edgeId: HotspotId;
  /** Index of the move that followed it, so a repeat traversal draws again. */
  readonly index: number;
  /** True when it was followed against its arrow: Back, or a jump to the screen that links here. */
  readonly reverse: boolean;
}

/**
 * The resolved link that connects the previous screen to the current one, if there is one. A followed hotspot
 * is that link exactly. A move through the player chrome (Next, Back, the filmstrip, the map) is matched to a
 * link between the same two screens, preferring the direction it was walked; with no such link, nothing is drawn.
 */
export function traversedEdge(edges: readonly FlowEdge[], move: ScreenMove | null): TraversedEdge | null {
  if (move === null || move.from === null || move.from === move.to) return null;
  const from = move.from;
  const between = (source: ScreenId, target: ScreenId): FlowEdge | undefined =>
    edges.find((edge) => edge.from === source && edge.resolution.status === 'ok' && edge.resolution.to === target);
  const followed = move.kind === 'navigated' && move.edgeId !== null ? edges.find((edge) => edge.id === move.edgeId) : undefined;
  if (followed?.resolution.status === 'ok') return { edgeId: followed.id, index: move.index, reverse: false };
  const walked = move.kind === 'back' ? undefined : between(from, move.to);
  if (walked) return { edgeId: walked.id, index: move.index, reverse: false };
  const against = between(move.to, from);
  if (against) return { edgeId: against.id, index: move.index, reverse: true };
  const along = between(from, move.to);
  return along ? { edgeId: along.id, index: move.index, reverse: false } : null;
}

/** How two neighbours in the screen list are joined on the filmstrip: a real link, or only the saved order. */
export type StripJoin = 'forward' | 'back' | 'order';

/** A drawn arrow always means a recorded link; neighbours without one are joined by the list order alone. */
export function stripJoins(order: readonly ScreenId[], edges: readonly FlowEdge[]): readonly StripJoin[] {
  const linked = (source: ScreenId, target: ScreenId): boolean =>
    edges.some((edge) => edge.from === source && edge.resolution.status === 'ok' && edge.resolution.to === target);
  return order.slice(1).map((target, n): StripJoin => {
    const source = order[n]!;
    return linked(source, target) ? 'forward' : linked(target, source) ? 'back' : 'order';
  });
}

/** The screen an arrow key moves to in the screen list, or null when the key does not move anywhere. */
export function stepTarget(order: readonly ScreenId[], current: ScreenId | null, key: string): ScreenId | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  let next: number;
  switch (key) {
    case 'ArrowRight': next = at < 0 ? 0 : Math.min(order.length - 1, at + 1); break;
    case 'ArrowLeft': next = at < 0 ? 0 : Math.max(0, at - 1); break;
    case 'Home': next = 0; break;
    case 'End': next = order.length - 1; break;
    default: return null;
  }
  return next === at ? null : order[next]!;
}

/** What the player has to say about the last thing that happened; null when there is nothing to say. */
export interface PlayerNoticeView {
  readonly tone: 'danger' | 'warning' | 'info';
  readonly title: string;
  readonly detail?: string;
}

export function playerNotice(state: PlayerState): PlayerNoticeView | null {
  if (state.notice?.kind === 'missing-start') return { tone: 'danger', title: `Start screen ${state.notice.screenId} does not exist.` };
  const outcome = state.steps.at(-1)?.outcome;
  switch (outcome?.kind) {
    case 'broken': return { tone: 'danger', title: 'Broken target reported, not followed', detail: outcome.detail };
    case 'back-unavailable': return { tone: 'info', title: 'Back unavailable: no previous screen', detail: 'Back follows the links you opened. Previous and Next step through the screen list.' };
    case 'exit': return { tone: 'info', title: 'Leaves the prototype, not opened', detail: outcome.url };
    default: return null;
  }
}

// --- pinned project versions -------------------------------------------------------------------

/** One screen's pinned project version and how well the project still agrees with it. */
export interface VersionPin {
  readonly screenId: string;
  readonly versionId: string;
  /** The caller's binding status (`exact`, `missing-version`, …); anything but `exact` is shown as a warning. */
  readonly binding: string;
}

/** A short tag for a version id: `hq-local-cart-v1` → `v1`; other ids are shortened from the front. */
export function shortVersion(versionId: string): string {
  const tagged = /(?:^|[-_.\s])(v\d+(?:\.\d+)*)$/iu.exec(versionId);
  if (tagged) return tagged[1]!.toLowerCase();
  return versionId.length <= 12 ? versionId : `…${versionId.slice(-10)}`;
}

const BINDING_TEXT: Readonly<Record<string, string>> = Object.freeze({
  exact: 'exact',
  'missing-version': 'version not found',
  'route-mismatch': 'route differs',
  'viewport-mismatch': 'size differs',
  'capture-digest-mismatch': 'capture differs',
  'unverified-capture': 'capture unverified',
});

/** A few words for a binding status; unknown statuses are shown as stored, readably. */
export function bindingText(binding: string): string {
  return Object.hasOwn(BINDING_TEXT, binding) ? BINDING_TEXT[binding]! : binding.replaceAll('-', ' ');
}

export interface PinChip {
  readonly screenId: string;
  /** The screen's display name, `Cart`. */
  readonly name: string;
  /** The full pinned version id, shown in the tooltip and the Versions list. */
  readonly versionId: string;
  /** `Cart · v1` */
  readonly label: string;
  readonly exact: boolean;
  /** `exact`, `route differs`, … */
  readonly status: string;
  /** Full ids for a tooltip: `Cart → hq-local-cart-v1: exact`. */
  readonly title: string;
}

export interface PinChips {
  readonly chips: readonly PinChip[];
  /** Exact pins that did not fit; they are listed in the Versions disclosure. */
  readonly hiddenExact: number;
}

/** Chips for the header. Pins that need attention always show; exact ones fill the remaining room. */
export function pinChips(pins: readonly VersionPin[], names: ReadonlyMap<ScreenId, string>, limit = 4): PinChips {
  const chips = pins.map((pin): PinChip => {
    const name = names.get(pin.screenId as ScreenId) ?? pin.screenId;
    const status = bindingText(pin.binding);
    return { screenId: pin.screenId, name, versionId: pin.versionId, label: `${name} · ${shortVersion(pin.versionId)}`, exact: pin.binding === 'exact', status, title: `${name} → ${pin.versionId}: ${status}` };
  });
  const attention = chips.filter((chip) => !chip.exact);
  const room = Math.max(0, limit - attention.length);
  const shown = new Set([...attention, ...chips.filter((chip) => chip.exact).slice(0, room)]);
  return { chips: chips.filter((chip) => shown.has(chip)), hiddenExact: chips.length - shown.size };
}
