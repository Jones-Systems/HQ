import { DESIGN_NAV_IDS, type DesignLocation, type DesignNavId, type SectionSubRoutes } from '../contract.ts';
import { NAV_LABELS } from './navigation.ts';
import type { PanelId } from './panels.ts';

/** Landmark regions in F6 order. */
export const REGIONS = ['bar', 'sidebar', 'main', 'inspector'] as const;
export type Region = (typeof REGIONS)[number];
/**
 * F6 order when a shell hosts Design and owns navigation: the page head is not a landmark, so F6
 * cycles the workspace and the inspector only.
 */
export const HOSTED_REGIONS: readonly Region[] = ['main', 'inspector'];

export interface SectionSummary {
  readonly id: string;
  readonly title: string;
  readonly nav: DesignNavId;
  /** Routing metadata copied from the descriptor; absent for sections without alternate views. */
  readonly subRoutes?: SectionSubRoutes;
}

export type StopAction =
  | { readonly type: 'navigate'; readonly location: DesignLocation }
  | { readonly type: 'toggle-panel'; readonly panel: PanelId }
  | { readonly type: 'open-palette' }
  | { readonly type: 'resize'; readonly panel: PanelId }
  | { readonly type: 'none' };

export interface TabStop {
  /** Stable DOM key: `data-hqd-stop`. */
  readonly id: string;
  readonly region: Region;
  readonly label: string;
  /** What Enter/Space does on this stop. */
  readonly action: StopAction;
}

export interface ChromeView {
  readonly location: DesignLocation;
  readonly sectionsByNav: Readonly<Record<DesignNavId, readonly SectionSummary[]>>;
  /** Panels currently shown (stored preference and window width both applied). */
  readonly visible: Readonly<Record<PanelId, boolean>>;
  readonly squeezed?: readonly PanelId[];
  /** Most recent section per nav area, restored when returning to that area. */
  readonly lastSection: Readonly<Partial<Record<DesignNavId, string>>>;
  /**
   * A shell hosts Design and owns navigation (the module-nav context is on). The area buttons, the
   * sidebar, its splitter and its toggle are not rendered, so they are not stops. Absent means false.
   */
  readonly hosted?: boolean;
}

export function navTarget(view: Pick<ChromeView, 'sectionsByNav' | 'lastSection'>, nav: DesignNavId): DesignLocation {
  const remembered = view.lastSection[nav];
  const sections = view.sectionsByNav[nav];
  const section = remembered !== undefined && sections.some((item) => item.id === remembered) ? remembered : sections[0]?.id ?? null;
  return { nav, section };
}

/**
 * The chrome's Tab order. The React view renders exactly these stops, in this
 * order, so the keyboard model and the DOM cannot drift apart.
 */
export function tabStops(view: ChromeView): readonly TabStop[] {
  const hosted = view.hosted === true;
  const stops: TabStop[] = hosted ? [] : DESIGN_NAV_IDS.map((nav) => ({
    id: `nav:${nav}`, region: 'bar', label: NAV_LABELS[nav], action: { type: 'navigate', location: navTarget(view, nav) },
  }));
  stops.push({ id: 'palette', region: 'bar', label: 'Command palette', action: { type: 'open-palette' } });
  for (const panel of hosted ? ['inspector'] as const : ['sidebar', 'inspector'] as const) {
    stops.push({ id: `toggle:${panel}`, region: 'bar', label: `${view.visible[panel] ? 'Hide' : 'Show'} ${panel}`, action: { type: 'toggle-panel', panel } });
  }
  if (view.visible.sidebar && !hosted) {
    for (const section of view.sectionsByNav[view.location.nav]) {
      stops.push({ id: `section:${section.id}`, region: 'sidebar', label: section.title, action: { type: 'navigate', location: { nav: section.nav, section: section.id } } });
    }
  }
  if (!hosted && !view.squeezed?.includes('sidebar')) {
    stops.push({ id: 'splitter:sidebar', region: 'sidebar', label: 'Resize sidebar', action: { type: 'resize', panel: 'sidebar' } });
  }
  stops.push({ id: 'workspace', region: 'main', label: 'Workspace', action: { type: 'none' } });
  if (!view.squeezed?.includes('inspector')) {
    stops.push({ id: 'splitter:inspector', region: 'inspector', label: 'Resize inspector', action: { type: 'resize', panel: 'inspector' } });
  }
  if (view.visible.inspector) {
    stops.push({ id: 'inspector', region: 'inspector', label: 'Inspector', action: { type: 'none' } });
  }
  return stops;
}

/**
 * F6 / Shift+F6: first stop of the next populated region, wrapping. `regions` is the cycle; a stop in a
 * region outside it (the hosted page head) starts the cycle from its edge.
 */
export function regionStop(stops: readonly TabStop[], currentId: string | null, backwards: boolean, regions: readonly Region[] = REGIONS): TabStop | null {
  const populated = regions.filter((region) => stops.some((stop) => stop.region === region));
  if (populated.length === 0) return null;
  const current = stops.find((stop) => stop.id === currentId)?.region;
  const index = current === undefined ? -1 : populated.indexOf(current);
  const offset = backwards ? (index <= 0 ? populated.length - 1 : index - 1) : (index + 1) % populated.length;
  const region = populated[offset];
  return stops.find((stop) => stop.region === region) ?? null;
}

/** Arrow-key movement inside the sub-navigation (horizontal) or a section list (vertical). */
export function rovingNext(ids: readonly string[], current: string, key: string, orientation: 'horizontal' | 'vertical'): string | null {
  const index = ids.indexOf(current);
  if (index < 0 || ids.length === 0) return null;
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const back = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  if (key === forward) return ids[(index + 1) % ids.length] ?? null;
  if (key === back) return ids[(index - 1 + ids.length) % ids.length] ?? null;
  if (key === 'Home') return ids[0] ?? null;
  if (key === 'End') return ids[ids.length - 1] ?? null;
  return null;
}

export interface KeyInput {
  readonly key: string;
  /** Physical key (`KeyboardEvent.code`); used for Alt+digit, which macOS remaps in `key`. */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** Focus is in a text field, textarea or contenteditable. */
  readonly editable: boolean;
}

export type Shortcut =
  | { readonly type: 'palette' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'region'; readonly backwards: boolean }
  | { readonly type: 'nav'; readonly nav: DesignNavId }
  | { readonly type: 'toggle-panel'; readonly panel: PanelId }
  /**
   * Mod+\ while a shell hosts Design: the shell's navigation toggle. Design leaves the key alone
   * (no preventDefault, nothing toggled) so the shell's own handler receives it.
   */
  | { readonly type: 'host-nav-toggle' };

export const SHORTCUT_HINTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Mod+K', action: 'Command palette' },
  { keys: 'F6 / Shift+F6', action: 'Next / previous region' },
  { keys: 'Alt+1…5', action: 'Projects, Resources, Review, Requests, Runs' },
  { keys: 'Mod+\\', action: 'Toggle sidebar' },
  { keys: 'Mod+Shift+\\', action: 'Toggle inspector' },
  { keys: 'Escape', action: 'Close palette or prompt' },
];

/** The hints shown in the inspector. Hosted, the sidebar toggle belongs to the shell's navigation. */
export function shortcutHints(hosted: boolean): readonly { readonly keys: string; readonly action: string }[] {
  if (!hosted) return SHORTCUT_HINTS;
  return SHORTCUT_HINTS.map((hint) => (hint.keys === 'Mod+\\' ? { keys: hint.keys, action: 'Expand or compact navigation' } : hint));
}

/**
 * Whether Design opens its own palette for a Mod+K. Standalone it always does. Hosted, only when the
 * event target is inside the Design chrome: body focus, the shell's navigation and other domains open the
 * shell's palette, so the result never depends on listener order.
 */
export function ownsPalette(hosted: boolean, targetInsideChrome: boolean): boolean {
  return !hosted || targetInsideChrome;
}

/**
 * Chrome-level shortcuts. While typing, only the palette, region and dismiss
 * keys apply so text entry never triggers navigation. `Mod` is ⌘ on macOS and
 * Ctrl elsewhere. `hosted` is true while a shell owns navigation: Mod+\ is then forwarded.
 */
export function resolveShortcut(input: KeyInput, mac: boolean, hosted = false): Shortcut | null {
  const mod = mac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (mod && !input.altKey && !input.shiftKey && key === 'k') return { type: 'palette' };
  if (key === 'Escape' && !mod && !input.altKey) return { type: 'dismiss' };
  if (key === 'F6' && !mod && !input.altKey) return { type: 'region', backwards: input.shiftKey };
  if (input.editable) return null;
  if (mod && !input.altKey && (key === '\\' || key === '|')) {
    if (input.shiftKey) return { type: 'toggle-panel', panel: 'inspector' };
    return hosted ? { type: 'host-nav-toggle' } : { type: 'toggle-panel', panel: 'sidebar' };
  }
  const digit = /^Digit([1-5])$/u.exec(input.code);
  if (input.altKey && !mod && !input.shiftKey && digit) {
    const nav = DESIGN_NAV_IDS[Number(digit[1]) - 1];
    if (nav !== undefined) return { type: 'nav', nav };
  }
  return null;
}
