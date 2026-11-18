/**
 * React views for flows. Written with `createElement` rather than JSX so Node 24's built-in
 * type stripping can render them in `node --test` without a section-level JSX transform.
 *
 * Styling lives in `flows.css`, which the composed view imports. The capture frame and the hotspot
 * geometry stay inline, so a player embedded anywhere keeps its proportions. Script-driven motion and
 * status notices come from the caller through `FlowsUi` (the composed view hands over `@hq/ui`'s
 * `animateElement`, `useReducedMotion` and `InlineNotice`); this section imports neither app code nor
 * `@hq/ui`, and without a caller it moves nothing and renders plain notices.
 */
import {
  createElement as h, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode,
} from 'react';
import type { FlowDocument, HotspotId, Screen, ScreenId, ScreenPreviewPort } from './contract.ts';
import { deriveEdges, describeResolution, indexFlow, screenDepths, type EdgeResolution, type FlowIndex } from './edges.ts';
import { NODE_HEIGHT, NODE_WIDTH, layoutFlowMap } from './map.ts';
import { validateFlow, type FlowIssue } from './model.ts';
import { createPlayer, type Player, type PlayerAction, type PlayerState, type PlayerStep } from './player.ts';
import { FAKE_PREVIEWS } from './fakes.ts';
import {
  lastMove, moveDirection, pinChips, playerNotice, screenNames, screenSequence, stateLabel, stepTarget, stripJoins, traversedEdge,
  type PlayerNoticeView, type StripJoin, type TraversedEdge, type VersionPin,
} from './presentation.ts';
import type { FlowItemKind } from './canvas.ts';

export type { PlayerNoticeView, TraversedEdge, VersionPin } from './presentation.ts';

// --- what the caller supplies ------------------------------------------------------------------

/** Script-driven motion. CSS motion needs no help: its durations come from tokens that collapse when motion is reduced. */
export interface FlowsMotion {
  /** True when the OS or the shell asks for reduced motion. Scripted movement is then skipped entirely. */
  readonly reduced: boolean;
  /** Runs a token-timed animation, or returns null when it does not run. */
  animate(element: Element, keyframes: Keyframe[], options?: { readonly duration?: 'fast' | 'base' | 'slow'; readonly easing?: 'standard' | 'enter' | 'exit' }): Animation | null;
}

/** No movement at all; what the views use when a caller does not supply motion. */
export const NO_MOTION: FlowsMotion = Object.freeze({ reduced: true, animate: () => null });

export interface FlowsUi {
  readonly motion?: FlowsMotion;
  /** Renders a notice about the last step; the composed view supplies `@hq/ui`'s `InlineNotice`. */
  readonly notice?: (notice: PlayerNoticeView) => ReactElement;
}

/** Project versions the flow's screens pin, and how well the project agrees with each. Only a caller that checked them supplies this. */
export interface FlowPins {
  /** Which project the pins were checked against, e.g. `project hq-local`. */
  readonly scope: string;
  /** False when the flow belongs to another project: nothing in it was resolved against that project. */
  readonly sameProject: boolean;
  readonly items: readonly VersionPin[];
}

// --- shared bits -------------------------------------------------------------------------------

/** Used only when a view is shown without `flows.css`, so a standalone map keeps a readable frame. */
const panel: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', padding: 12, minWidth: 0 };
const PLATFORM_LABELS: Readonly<Record<FlowDocument['platform'], string>> = { web: 'Website', ios: 'iOS', android: 'Android', desktop: 'Desktop' };
/** How far a new screen travels while it slides in; matches `--hq-motion-distance-lg`. */
const SLIDE_DISTANCE = 16;
/** The map never shrinks below this share of its natural size; a narrower column scrolls instead. */
const MAP_MIN_SCALE = 0.62;
const ARROWS = [{ variant: '', className: 'hqd-flows__arrow' }, { variant: '-active', className: 'hqd-flows__arrow is-active' }, { variant: '-broken', className: 'hqd-flows__arrow is-broken' }] as const;
const STEP_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

const ICONS = {
  arrowRight: 'M2.5 8h10M9 4.5 12.5 8 9 11.5',
  arrowLeft: 'M13.5 8h-10M7 4.5 3.5 8 7 11.5',
  star: 'M8 2.2l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.9l-3.4 1.8.7-3.8L2.5 6.2l3.8-.5Z',
  check: 'm3.5 8.6 3 3 6-7',
} as const;

function icon(name: keyof typeof ICONS): ReactElement {
  return h('svg', { className: 'hqd-flows__icon', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
    h('path', { d: ICONS[name] }));
}

/** A status that pairs a shape with a word, drawn with the shared `hq-status` styles. */
function status(tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral', label: string): ReactElement {
  return h('span', { className: `hq-status hq-status--${tone}`, 'data-tone': tone },
    h('span', { className: 'hq-status-shape', 'aria-hidden': true }), h('b', { className: 'hq-status-label' }, label));
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** Stable DOM attribute describing where an edge goes; the map and player emit the same value. */
export function edgeTargetAttribute(resolution: EdgeResolution): string {
  switch (resolution.status) {
    case 'ok': return `screen:${resolution.to}`;
    case 'back': return 'back';
    case 'exit': return `exit:${resolution.url}`;
    case 'broken': return `broken:${resolution.reason}`;
  }
}

/** Where an edge goes, using readable screen names; broken, back and exit text is shared with the model. */
function targetText(resolution: EdgeResolution, index: FlowIndex, names: ReadonlyMap<ScreenId, string>): string {
  return resolution.status === 'ok' ? names.get(resolution.to) ?? describeResolution(resolution, index) : describeResolution(resolution, index);
}

function issueText(issue: FlowIssue, names: ReadonlyMap<ScreenId, string>): string {
  if (issue.code === 'unreachable-screen') {
    const name = names.get(issue.subject.id as ScreenId) ?? issue.subject.id;
    return `${name} has no link from the start screen. Open it from the screen list.`;
  }
  return issue.message;
}

export function IssueList({ issues, names = new Map() }: { readonly issues: readonly FlowIssue[]; readonly names?: ReadonlyMap<ScreenId, string> }): ReactElement {
  if (issues.length === 0) return h('p', { className: 'hqd-flows__muted', 'data-issues': 0 }, 'No broken targets or warnings.');
  return h('ul', { className: 'hqd-flows__issue-list', 'aria-label': 'Flow issues', 'data-issues': issues.length },
    issues.map((issue, n) => h('li', { key: n, 'data-issue': issue.code, 'data-severity': issue.severity, 'data-subject': issue.subject.id },
      h('strong', null, issue.severity === 'error' ? 'Error' : 'Note'), ` ${issueText(issue, names)}`)));
}

/** A short tail of a route for secondary text; the full route stays in the tooltip and details. */
function routeTail(route: string): string {
  const [path = '', query] = route.split('?', 2);
  const tail = path.split('/').filter((segment) => segment !== '').slice(-2).join('/');
  return `${tail === '' ? '/' : tail}${query === undefined ? '' : `?${query}`}`;
}

// --- flow map ----------------------------------------------------------------------------------

export interface FlowMapViewProps {
  readonly flow: FlowDocument;
  readonly onPlayFrom?: (screenId: FlowDocument['start']) => void;
  readonly currentScreenId?: ScreenId | null;
  /** The screen shown before the current one; its node is tinted so the path reads from there. */
  readonly previousScreenId?: ScreenId | null;
  /** The link just followed. It is highlighted, and drawn in when motion is allowed. */
  readonly traversed?: TraversedEdge | null;
  readonly motion?: FlowsMotion;
  /** Inside a workspace panel: no frame or visible heading, and the links list starts closed. */
  readonly embedded?: boolean;
}

export function FlowMapView({ flow, onPlayFrom, currentScreenId = null, previousScreenId = null, traversed = null, motion = NO_MOTION, embedded = false }: FlowMapViewProps): ReactElement {
  const map = useMemo(() => layoutFlowMap(flow), [flow]);
  const names = useMemo(() => screenNames(flow), [flow]);
  const titleId = `flow-map-${flow.id}`;
  const linked = map.edges.length > 0;
  const svg = useRef<SVGSVGElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drawn = useRef<number | null | undefined>(undefined);
  const shownAt = useRef<ScreenId | null | undefined>(undefined);

  // The followed link draws in from the screen that was left toward the one now showing. The first render only
  // highlights, and nothing is drawn under reduced motion (the caller's `animate` then does nothing).
  useEffect(() => {
    const before = drawn.current;
    drawn.current = traversed?.index ?? null;
    if (before === undefined || traversed === null || before === traversed.index) return;
    const edge = map.edges.find((item) => item.id === traversed.edgeId);
    const line = [...(svg.current?.querySelectorAll('line') ?? [])].find((item) => item.getAttribute('data-edge-id') === traversed.edgeId);
    if (!edge?.segment || !line) return;
    const length = Math.hypot(edge.segment.x2 - edge.segment.x1, edge.segment.y2 - edge.segment.y1);
    motion.animate(line, [
      { strokeDasharray: `${length}`, strokeDashoffset: traversed.reverse ? -length : length },
      { strokeDasharray: `${length}`, strokeDashoffset: 0 },
    ], { duration: 'slow', easing: 'enter' });
  }, [traversed?.index, traversed?.edgeId]);

  // Keep the current node in view when the map scrolls sideways.
  useEffect(() => {
    const box = scroller.current;
    const node = map.nodes.find((item) => item.screenId === currentScreenId);
    const before = shownAt.current;
    shownAt.current = currentScreenId;
    if (before === currentScreenId || !box || !node || !svg.current || box.scrollWidth <= box.clientWidth) return;
    const scale = svg.current.getBoundingClientRect().width / map.width;
    box.scrollTo({ left: Math.max(0, (node.x + NODE_WIDTH / 2) * scale - box.clientWidth / 2), behavior: before === undefined || motion.reduced ? 'auto' : 'smooth' });
  }, [currentScreenId]);

  const arrow = (variant: string): string => `${titleId}-arrow${variant}`;
  const edgeMarker = (resolution: EdgeResolution['status'], active: boolean): string => `url(#${arrow(resolution === 'broken' ? '-broken' : active ? '-active' : '')})`;
  const interactive = onPlayFrom !== undefined;
  return h('section', { 'aria-labelledby': titleId, 'data-flow-map': flow.id, className: embedded ? 'hqd-flows__map is-embedded' : 'hqd-flows__map', ...(embedded ? {} : { style: panel }) },
    h('h2', { id: titleId, className: embedded ? 'hqd-flows__sr' : 'hqd-flows__map-title', ...(embedded ? {} : { style: { fontSize: 15, margin: '0 0 8px' } }) }, `${flow.title} — flow map`),
    h('div', { className: 'hqd-flows__map-scroll', ref: scroller, ...(embedded ? {} : { style: { overflowX: 'auto' } }) },
      h('svg', {
        ref: svg, className: 'hqd-flows__svg', role: interactive ? 'group' : 'img', 'aria-label': `Flow map with ${map.nodes.length} screens and ${map.edges.length} links`,
        viewBox: `0 0 ${map.width} ${map.height}`, width: map.width, height: map.height,
        style: { display: 'block', maxWidth: '100%', height: 'auto', ...(embedded ? { minWidth: Math.round(map.width * MAP_MIN_SCALE) } : {}) },
      },
      h('defs', null,
        ARROWS.map(({ variant, className }) =>
          h('marker', { key: variant, id: arrow(variant), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' },
            h('path', { className, d: 'M0,0 L10,5 L0,10 z', fill: variant === '-broken' ? 'var(--hq-danger, #c62828)' : 'currentColor' }))),
        h('clipPath', { id: `${titleId}-clip` }, h('rect', { x: 8, y: 0, width: NODE_WIDTH - 16, height: NODE_HEIGHT }))),
      map.edges.map((edge) => {
        if (!edge.segment) return null;
        const active = traversed?.edgeId === edge.id;
        return h('line', {
          key: edge.id, className: 'hqd-flows__edge', 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
          'data-status': edge.resolution.status, ...(active ? { 'data-traversed': 'true' } : {}),
          x1: edge.segment.x1, y1: edge.segment.y1, x2: edge.segment.x2, y2: edge.segment.y2,
          stroke: edge.resolution.status === 'broken' ? 'var(--hq-danger, #c62828)' : 'currentColor', strokeWidth: 1.5,
          strokeDasharray: edge.resolution.status === 'ok' ? undefined : '4 3', markerEnd: edgeMarker(edge.resolution.status, active),
        }, h('title', null, `${edge.label} → ${targetText(edge.resolution, map.index, names)}`));
      }),
      map.nodes.map((node) => {
        const name = names.get(node.screenId) ?? node.title;
        const current = node.screenId === currentScreenId;
        const open = onPlayFrom ? () => onPlayFrom(node.screenId) : undefined;
        return h('g', {
          key: node.screenId, 'data-node': node.screenId, className: 'hqd-flows__node', transform: `translate(${node.x} ${node.y})`,
          ...(current ? { 'data-current': 'true' } : {}), ...(node.isStart ? { 'data-start': 'true' } : {}),
          ...(node.screenId === previousScreenId && !current ? { 'data-previous': 'true' } : {}),
          ...(open ? { role: 'button', tabIndex: 0, 'aria-label': `Show ${name}`, 'aria-current': current ? 'step' : undefined, onClick: open,
            onKeyDown: (event: KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } } } : {}),
        },
        h('title', null, `${name} — ${node.route}`),
        current ? h('rect', { className: 'hqd-flows__node-ring', x: -4, y: -4, width: NODE_WIDTH + 8, height: NODE_HEIGHT + 8, rx: 10, fill: 'none' }) : null,
        h('rect', { className: 'hqd-flows__node-box', width: NODE_WIDTH, height: NODE_HEIGHT, rx: 6, fill: 'var(--background)', stroke: node.isStart || current ? 'var(--accent)' : 'var(--line)', strokeWidth: node.isStart || current ? 2 : 1, strokeDasharray: node.reachable ? undefined : '3 3' }),
        h('g', { clipPath: `url(#${titleId}-clip)` },
          h('text', { className: 'hqd-flows__node-name', x: 10, y: 24, fill: 'currentColor', fontSize: 13, fontWeight: 600 }, name),
          h('text', { className: 'hqd-flows__node-meta', x: 10, y: 44, fill: 'currentColor', fontSize: 11, opacity: 0.7 }, stateLabel(node.state) ?? routeTail(node.route)),
          h('text', { className: node.isStart ? 'hqd-flows__node-tag is-start' : 'hqd-flows__node-tag', x: 10, y: NODE_HEIGHT - 12, fill: 'currentColor', fontSize: 11, opacity: node.isStart ? 1 : 0.7 },
            node.isStart ? 'Start' : node.reachable ? '' : 'No link to here')));
      }))),
    linked
      ? h('details', { className: 'hqd-flows__disclosure hqd-flows__links', 'data-links': true, ...(embedded ? {} : { open: true }) },
        h('summary', null, `Links (${map.edges.length})`),
        h('div', { className: 'hqd-flows__table-wrap' },
          h('table', { 'aria-label': 'Flow links', className: 'hqd-flows__table', ...(embedded ? {} : { style: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 } }) },
            h('thead', null, h('tr', null, h('th', { scope: 'col', align: 'left' }, 'From'), h('th', { scope: 'col', align: 'left' }, 'Hotspot'), h('th', { scope: 'col', align: 'left' }, 'Goes to'))),
            h('tbody', null, map.edges.map((edge) => h('tr', { key: edge.id, 'data-edge-row': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution), ...(traversed?.edgeId === edge.id ? { 'data-traversed': 'true' } : {}) },
              h('td', null, edge.fromExists ? names.get(edge.from) ?? edge.from : `Missing screen ${edge.from}`),
              h('td', null, edge.label),
              h('td', null, targetText(edge.resolution, map.index, names))))))))
      : h('p', { 'data-no-links': true, className: 'hqd-flows__muted', ...(embedded ? {} : { style: { margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' } }) }, 'No links between screens are recorded in this flow.'));
}

// --- prototype player --------------------------------------------------------------------------

function stepText(step: PlayerStep, index: FlowIndex, names: ReadonlyMap<ScreenId, string>): string {
  const title = (id: ScreenId): string => names.get(id) ?? index.screensById.get(id)?.title ?? id;
  switch (step.outcome.kind) {
    case 'entered': return `Opened ${title(step.outcome.to)}`;
    case 'navigated': return `${title(step.from!)} → ${title(step.outcome.to)}`;
    case 'back': return `Back to ${title(step.outcome.to)}`;
    case 'back-unavailable': return 'Back unavailable: no previous screen';
    case 'exit': return `Leaves prototype (not opened): ${step.outcome.url}`;
    case 'broken': return `Broken target reported, not followed: ${step.outcome.detail}`;
  }
}

/** Height budget for the stage: the window less the chrome above it, never below a usable floor. `flows.css` may set `--hqd-flows-stage-h`. */
const STAGE_HEIGHT = 'var(--hqd-flows-stage-h, max(300px, 100dvh - 360px))';
/** Width of a capture frame: never above its own size, the column, or a share of the window height. */
function frameWidth(viewport: Screen['viewport'], border: number): string {
  return `min(100% - ${border * 2}px, ${viewport.w}px, (${STAGE_HEIGHT} - ${border * 2}px) * ${viewport.w / viewport.h})`;
}

const phoneSized = (viewport: Screen['viewport'], platform: FlowDocument['platform']): boolean =>
  platform === 'ios' || platform === 'android' || (viewport.w <= 480 && viewport.h > viewport.w);

/** Arrow keys and Home/End move through the screen list; the handler is shared by the filmstrip and the player. */
function stepKeys(order: readonly ScreenId[], current: ScreenId | null, show: (screenId: ScreenId) => void, moved?: (screenId: ScreenId) => void) {
  return (event: KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !STEP_KEYS.has(event.key)) return;
    event.preventDefault();
    const target = stepTarget(order, current, event.key);
    if (target === null) return;
    show(target);
    moved?.(target);
  };
}

export interface PrototypePlayerViewProps {
  readonly player: Player;
  readonly state: PlayerState;
  readonly dispatch: (action: PlayerAction) => void;
  readonly previews?: ScreenPreviewPort;
  /** Offered only when the caller has an open live preview bound to this flow's exact source. */
  readonly onOpenLive?: (screen: Screen) => void;
  readonly ui?: FlowsUi;
}

export function PrototypePlayerView({ player, state, dispatch, previews = FAKE_PREVIEWS, onOpenLive, ui }: PrototypePlayerViewProps): ReactElement {
  const motion = ui?.motion ?? NO_MOTION;
  const names = useMemo(() => screenNames(player.flow), [player.flow]);
  const sequence = useMemo(() => screenSequence(player.flow), [player.flow]);
  const order = useMemo(() => sequence.map((item) => item.id), [sequence]);
  const screen = state.current === null ? undefined : player.index.screensById.get(state.current);
  const position = screen ? sequence.findIndex((item) => item.id === screen.id) : -1;
  const linked = player.flow.hotspots.length > 0;
  const notice = playerNotice(state);
  const preview = screen ? previews.previewUrl(screen) : null;
  const name = screen ? names.get(screen.id) ?? screen.title : '';
  const phone = screen ? phoneSized(screen.viewport, player.flow.platform) : false;
  const hotspots = screen ? player.hotspotsOn(screen.id) : [];
  const [showHotspots, setShowHotspots] = useState(false);
  const [probe, setProbe] = useState<{ readonly screenId: ScreenId; readonly n: number } | null>(null);
  const slide = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const handled = useRef<number | null>(null);
  const refocus = useRef(false);
  const move = useMemo(() => lastMove(state.steps), [state.steps]);
  const probing = probe !== null && screen !== undefined && probe.screenId === screen.id ? probe.n : 0;

  // A new screen slides in from the side it came from while its frame wrapper fades up. The capture itself is never
  // faded, filtered or recoloured, and nothing runs for the first screen or under reduced motion.
  useLayoutEffect(() => {
    if (handled.current !== null && move !== null && handled.current !== move.index) {
      const direction = moveDirection(order, move);
      if (direction !== 'none' && slide.current) {
        const dx = direction === 'forward' ? SLIDE_DISTANCE : -SLIDE_DISTANCE;
        motion.animate(slide.current, [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 'slow', easing: 'enter' });
      }
    }
    handled.current = move?.index ?? null;
    // A hotspot that was just used has left the page with the old screen; keep keyboard focus on the stage.
    if (refocus.current && (document.activeElement === null || document.activeElement === document.body)) stage.current?.focus({ preventScroll: true });
    refocus.current = false;
  }, [move?.index]);

  const show = (target: Screen | undefined) => { if (target) dispatch({ type: 'start', screenId: target.id }); };
  const activate = (hotspotId: HotspotId) => { refocus.current = true; dispatch({ type: 'activate', hotspotId }); };
  const onFrameClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!screen || event.target !== event.currentTarget) return;
    // Hotspots are positioned in the padding box, so map from it rather than the bordered rect.
    const frame = event.currentTarget;
    const box = frame.getBoundingClientRect();
    const x = (event.clientX - box.left - frame.clientLeft) / frame.clientWidth * screen.viewport.w;
    const y = (event.clientY - box.top - frame.clientTop) / frame.clientHeight * screen.viewport.h;
    // Like Figma: a click that misses every hotspot briefly shows where the links are.
    if (hotspots.length > 0 && !player.hitTest(screen.id, { x, y })) setProbe({ screenId: screen.id, n: probing + 1 });
    dispatch({ type: 'click', point: { x, y } });
  };
  const onKeyDown = stepKeys(order, state.current, (target) => { refocus.current = true; dispatch({ type: 'start', screenId: target }); });

  const noticeView = notice === null ? null : h('div', { key: state.steps.length, className: 'hqd-flows__notice', 'data-player-alert': true, 'data-hq-presence': 'enter', 'data-hq-motion': 'collapse' },
    ui?.notice ? ui.notice(notice)
      : h('p', { role: notice.tone === 'danger' ? 'alert' : 'status', className: 'hqd-flows__muted', 'data-tone': notice.tone },
        notice.detail === undefined ? notice.title : `${notice.title}: ${notice.detail}`));

  return h('section', { className: 'hqd-flows__player', 'aria-label': `${player.flow.title} prototype player`, 'data-player': player.flow.id, 'data-current': state.current ?? '', onKeyDown },
    h('p', { className: 'hqd-flows__evidence', role: 'note', 'data-evidence': player.evidence.kind }, player.evidence.label),
    h('div', { className: 'hqd-flows__toolbar', role: 'group', 'aria-label': 'Screen playback' },
      h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm hqd-flows__tool', 'data-player-restart': true, onClick: () => dispatch({ type: 'start' }) }, 'Start'),
      h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm hqd-flows__tool', 'data-player-previous': true, disabled: position <= 0, title: 'Previous screen in the list', onClick: () => show(sequence[position - 1]) }, 'Previous'),
      h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm hqd-flows__tool', 'data-player-next': true, disabled: position < 0 || position >= sequence.length - 1, title: 'Next screen in the list', onClick: () => show(sequence[position + 1]) }, 'Next'),
      linked ? h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm hqd-flows__tool', 'data-player-back': true, disabled: state.current === null, title: 'Return along the links you followed', onClick: () => dispatch({ type: 'back' }) }, 'Back') : null,
      h('span', { className: 'hqd-flows__spacer' }),
      linked ? h('button', {
        type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm hqd-flows__tool hqd-flows__hotspot-toggle', 'data-hotspot-toggle': true, 'aria-pressed': showHotspots, disabled: hotspots.length === 0,
        title: hotspots.length === 0 ? 'No hotspots on this screen' : 'Outline the clickable areas on this screen', onClick: () => setShowHotspots((on) => !on),
      }, 'Show hotspots') : null),
    screen ? h('p', { className: 'hqd-flows__position', 'aria-live': 'polite', 'data-player-position': position + 1 },
      h('strong', null, name), h('span', { className: 'hqd-flows__muted' }, ` · screen ${position + 1} of ${sequence.length}`)) : null,
    linked ? null : h('p', { className: 'hqd-flows__muted', 'data-player-unlinked': true },
      'No links are recorded between these screens, so Previous and Next follow the saved screen order.'),
    noticeView,
    screen ? h('div', { className: 'hqd-flows__stage', 'data-stage': true, 'data-hotspots': showHotspots ? 'on' : 'off', 'data-phone': phone ? 'true' : undefined, ref: stage, tabIndex: -1 },
      h('div', { key: screen.id, ref: slide, className: 'hqd-flows__slide' },
        // Captures keep their own colors; HQ appearance only styles the surrounding chrome.
        h('div', { 'data-screen': screen.id, 'data-frame': phone ? 'phone' : 'page', 'data-hq-content': 'captured', className: 'hqd-flows__frame', onClick: onFrameClick, style: {
          position: 'relative', boxSizing: 'content-box', width: frameWidth(screen.viewport, phone ? 6 : 1), aspectRatio: `${screen.viewport.w} / ${screen.viewport.h}`,
          background: '#ffffff', color: '#1a1a1a', overflow: 'hidden',
          border: phone ? '6px solid #1c1c1e' : '1px solid var(--line)', borderRadius: phone ? 22 : 4, boxShadow: '0 1px 3px rgb(0 0 0 / 0.18)',
        } },
          preview ? h('img', { src: preview, alt: `Saved capture of ${name}`, draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', pointerEvents: 'none' } })
            : h('span', { 'data-capture-missing': true, style: { position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', gap: 4, padding: 16, textAlign: 'center', fontSize: 13, pointerEvents: 'none' } },
              h('strong', null, name), h('span', null, previews.unavailableReason?.(screen) ?? 'No capture image is available for this screen.')),
          hotspots.map((hotspot) => {
            const edge = player.edgeFor(hotspot.id)!;
            const target = targetText(edge.resolution, player.index, names);
            const centre = (hotspot.rect.x + hotspot.rect.width / 2) / screen.viewport.w;
            return h('button', {
              key: `${hotspot.id}:${probing}`, type: 'button', className: 'hqd-flows__hotspot', 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
              'data-resolution': edge.resolution.status, 'data-side': centre > 0.5 ? 'end' : 'start', 'data-near-top': hotspot.rect.y / screen.viewport.h < 0.12 ? 'true' : undefined,
              'data-probe': probing > 0 ? 'true' : undefined,
              'aria-label': `${hotspot.label} → ${target}`, onClick: () => activate(hotspot.id),
              style: {
                position: 'absolute', left: `${hotspot.rect.x / screen.viewport.w * 100}%`, top: `${hotspot.rect.y / screen.viewport.h * 100}%`,
                width: `${hotspot.rect.width / screen.viewport.w * 100}%`, height: `${hotspot.rect.height / screen.viewport.h * 100}%`,
                cursor: 'pointer', padding: 0, minHeight: 0, border: 0, background: 'transparent',
              },
            }, h('span', { className: 'hqd-flows__hotspot-label', 'aria-hidden': true }, `${hotspot.label} → ${target}`));
          })))) : null,
    h('p', { className: 'hqd-flows__muted hqd-flows__playback', 'data-playback': 'recorded' }, 'Saved captures are still images recorded from the live preview, not the live page.'),
    screen && hotspots.length > 0 ? h('div', { className: 'hqd-flows__link-row', role: 'group', 'aria-label': `Links on ${name}` },
      h('span', { className: 'hqd-flows__label' }, 'Links'),
      hotspots.map((hotspot) => {
        const edge = player.edgeFor(hotspot.id)!;
        const text = `${hotspot.label} → ${targetText(edge.resolution, player.index, names)}`;
        return h('button', { key: hotspot.id, type: 'button', className: 'hqd-flows__link-chip', 'data-link-edge': edge.id, 'data-resolution': edge.resolution.status, title: text, onClick: () => activate(hotspot.id) },
          h('span', { className: 'hqd-flows__link-chip-text' }, text));
      })) : null,
    state.notice?.kind === 'miss' ? h('p', { className: 'hqd-flows__muted', 'data-player-miss': true }, `No hotspot at ${Math.round(state.notice.point.x)}, ${Math.round(state.notice.point.y)}.`) : null,
    screen && onOpenLive ? h('div', { className: 'hqd-flows__live' },
      h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm', 'data-open-live': screen.id, onClick: () => onOpenLive(screen) }, 'Show this page in the live preview'),
      h('span', { className: 'hqd-flows__muted' }, 'The live page is current and may differ from this capture.')) : null,
    screen ? h('details', { className: 'hqd-flows__disclosure', 'data-capture-details': true },
      h('summary', null, 'Capture details'),
      h('dl', { className: 'hqd-flows__facts' },
        ...([['Route', screen.route], ['State', stateLabel(screen.state) ?? 'none'], ['Viewport', `${screen.viewport.w} × ${screen.viewport.h} @${screen.viewport.dpr}x`],
          ['Version', screen.versionId], ['Capture', screen.captureDigest ?? 'none recorded']] as const).flatMap(([term, value]) => [
          h('dt', { key: `${term}-t` }, term), h('dd', { key: `${term}-d` }, h('code', null, value))]))) : null,
    h('details', { className: 'hqd-flows__disclosure', 'data-player-history': true },
      h('summary', null, `Playback history (${state.steps.length})`),
      h('ol', { 'aria-label': 'Prototype steps', className: 'hqd-flows__history' },
        state.steps.map((step) => h('li', { key: step.index, 'data-step': step.index, 'data-step-outcome': step.outcome.kind, 'data-evidence': step.evidence.kind },
          stepText(step, player.index, names), ' ', h('em', { className: 'hqd-flows__muted' }, `(${step.evidence.label})`))))));
}

export function usePrototypePlayer(flow: FlowDocument): { readonly player: Player; readonly state: PlayerState; readonly dispatch: (action: PlayerAction) => void } {
  const player = useMemo(() => createPlayer(flow), [flow]);
  const [state, dispatch] = useReducer(player.reduce, undefined, player.initial);
  return { player, state, dispatch };
}

// --- filmstrip ---------------------------------------------------------------------------------

const JOIN_TITLES: Readonly<Record<StripJoin, string>> = { forward: 'A link leads on', back: 'A link leads back', order: 'Saved order only, no link' };

/** Saved screens as thumbnails in sequence; choosing one shows it in the player. A moving indicator marks the current one. */
function Filmstrip({ flow, current, previews, onShow, motion }: {
  readonly flow: FlowDocument; readonly current: ScreenId | null; readonly previews: ScreenPreviewPort; readonly onShow: (screenId: ScreenId) => void; readonly motion: FlowsMotion;
}): ReactElement {
  const names = useMemo(() => screenNames(flow), [flow]);
  const sequence = useMemo(() => screenSequence(flow), [flow]);
  const order = useMemo(() => sequence.map((screen) => screen.id), [sequence]);
  const edges = useMemo(() => deriveEdges(flow), [flow]);
  const joins = useMemo(() => stripJoins(order, edges), [order, edges]);
  const reachable = useMemo(() => new Set(screenDepths(flow, indexFlow(flow), edges).keys()), [flow, edges]);
  const linked = flow.hotspots.length > 0;
  const scroller = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [mark, setMark] = useState<{ readonly left: number; readonly width: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const focusable = current !== null && order.includes(current) ? current : order[0];

  // The indicator sits under the current thumbnail. It is measured, then moved with a token-timed transition.
  useLayoutEffect(() => {
    const root = track.current;
    if (!root) return;
    const measure = () => {
      const button = root.querySelector<HTMLElement>('[aria-current="step"]');
      if (!button) { setMark(null); return; }
      const box = root.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const next = { left: Math.round(rect.left - box.left), width: Math.round(rect.width) };
      setMark((previous) => previous && previous.left === next.left && previous.width === next.width ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [current, order]);
  // Transitions start after the first placement, so the indicator does not slide in from the edge.
  useEffect(() => { if (mark !== null && !placed) setPlaced(true); }, [mark, placed]);
  // Keep the current thumbnail visible when the strip scrolls sideways; never scroll the page.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const box = scroller.current;
    const button = track.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!box || !button) return;
    const bounds = box.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const by = rect.left < bounds.left ? rect.left - bounds.left - 8 : rect.right > bounds.right ? rect.right - bounds.right + 8 : 0;
    if (by !== 0) box.scrollBy({ left: by, behavior: motion.reduced ? 'auto' : 'smooth' });
  }, [current]);

  const focusThumb = (screenId: ScreenId) => [...(track.current?.querySelectorAll<HTMLElement>('[data-play-from]') ?? [])]
    .find((button) => button.getAttribute('data-play-from') === screenId)?.focus();

  return h('nav', { className: 'hqd-flows__filmstrip', 'aria-label': `${flow.title} screens`, ref: scroller, onKeyDown: stepKeys(order, current, onShow, focusThumb) },
    h('div', { className: 'hqd-flows__track', ref: track },
      h('ol', { 'aria-label': 'Screens', className: 'hqd-flows__strip hq-stagger' },
        sequence.map((screen, n) => {
          const name = names.get(screen.id) ?? screen.title;
          const preview = previews.previewUrl(screen);
          const selected = screen.id === current;
          return h('li', { key: screen.id, className: 'hqd-flows__step' },
            h('button', { type: 'button', 'data-play-from': screen.id, className: 'hqd-flows__thumb hq-lift', 'aria-current': selected ? 'step' : undefined, title: screen.route, tabIndex: screen.id === focusable ? 0 : -1, onClick: () => onShow(screen.id),
              'aria-label': `${n + 1}. ${name}${screen.id === flow.start ? ', start screen' : ''}` },
            h('span', { 'aria-hidden': true, className: 'hqd-flows__thumb-image' },
              preview ? h('img', { src: preview, alt: '', draggable: false, style: { aspectRatio: `${screen.viewport.w} / ${screen.viewport.h}` } })
                : h('span', { className: 'hqd-flows__muted' }, 'No image')),
            h('span', { className: 'hqd-flows__thumb-name' },
              h('span', { className: 'hqd-flows__thumb-n' }, `${n + 1}`),
              h('strong', null, name)),
            screen.id === flow.start ? h('span', { className: 'hqd-flows__thumb-tag is-start' }, 'Start')
              : linked && !reachable.has(screen.id) ? h('span', { className: 'hqd-flows__thumb-tag' }, 'No link to here') : null),
            n < sequence.length - 1 ? h('span', { className: 'hqd-flows__join', 'aria-hidden': true, 'data-join': joins[n], title: JOIN_TITLES[joins[n]!] },
              joins[n] === 'order' ? h('span', { className: 'hqd-flows__join-dot' }) : icon(joins[n] === 'back' ? 'arrowLeft' : 'arrowRight')) : null);
        })),
      h('span', { className: 'hqd-flows__indicator', 'aria-hidden': true, 'data-placed': placed ? 'true' : undefined,
        style: mark ? { transform: `translateX(${mark.left}px)`, width: mark.width, opacity: 1 } : { width: 0, opacity: 0 } })));
}

// --- workspace ---------------------------------------------------------------------------------

function PinsRow({ pins, names }: { readonly pins: FlowPins; readonly names: ReadonlyMap<ScreenId, string> }): ReactElement | null {
  if (pins.items.length === 0) return null;
  const { chips, hiddenExact } = pinChips(pins.items, names);
  const all = pinChips(pins.items, names, pins.items.length).chips;
  return h('div', { className: 'hqd-flows__pins' },
    h('span', { className: 'hqd-flows__label' }, 'Pinned'),
    h('ul', { className: 'hqd-flows__pin-list', 'aria-label': 'Pinned project versions' },
      !pins.sameProject ? h('li', { key: 'scope', className: 'hqd-flows__pin', 'data-exact': 'false', title: 'This flow belongs to another project, so nothing in it was resolved against this one.' }, status('warning', 'another project')) : null,
      chips.map((chip) => h('li', { key: chip.screenId, className: 'hqd-flows__pin', 'data-exact': chip.exact ? 'true' : 'false', title: chip.title },
        h('span', { className: 'hqd-flows__pin-label' }, chip.label), status(chip.exact ? 'success' : 'warning', chip.status))),
      hiddenExact > 0 ? h('li', { key: 'more', className: 'hqd-flows__pin hqd-flows__pin-more', title: 'More exact pins are listed under Versions.' }, `+${hiddenExact} exact`) : null),
    h('details', { className: 'hqd-flows__disclosure hqd-flows__versions', 'data-versions': true },
      h('summary', null, 'Versions'),
      h('p', { className: 'hqd-flows__muted' }, `Pinned to exact project versions (${pins.sameProject ? pins.scope : 'flow belongs to another project'}); a screen is never bound to "latest".`),
      h('ul', { className: 'hqd-flows__version-list' },
        all.map((chip) => h('li', { key: chip.screenId }, chip.name, ' → ', h('code', null, chip.versionId), ': ', chip.status)))));
}

export interface FlowsWorkspaceProps {
  readonly flow: FlowDocument;
  readonly previews?: ScreenPreviewPort;
  readonly onOpenLive?: (screen: Screen) => void;
  /** Pinned project versions, shown as chips under the title. Omit when the caller has not checked them. */
  readonly pins?: FlowPins;
  /** The caller's saved-flow switcher, shown under the title. */
  readonly switcher?: ReactNode;
  /** Offers "Rate this flow"; the caller owns where the flow goes. */
  readonly onRate?: () => void;
  /** The flow is already waiting to be rated. */
  readonly rated?: boolean;
  readonly ui?: FlowsUi;
}

/** Screens, player, map and issues for one flow. `key` the component by flow id to reset playback. */
export function FlowsWorkspace({ flow, previews = FAKE_PREVIEWS, onOpenLive, pins, switcher, onRate, rated = false, ui }: FlowsWorkspaceProps): ReactElement {
  const motion = ui?.motion ?? NO_MOTION;
  const { player, state, dispatch } = usePrototypePlayer(flow);
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const names = useMemo(() => screenNames(flow), [flow]);
  const move = useMemo(() => lastMove(state.steps), [state.steps]);
  const traversed = useMemo(() => traversedEdge(player.edges, move), [player, move]);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const notes = issues.length - errors;
  const show = (screenId: ScreenId) => dispatch({ type: 'start', screenId });
  return h('div', { className: 'hqd-flows', 'data-flows-workspace': flow.id },
    h('header', { className: 'hqd-flows__header' },
      h('div', { className: 'hqd-flows__title-row' },
        h('h2', { className: 'hqd-flows__title' }, flow.title),
        h('span', { className: 'hqd-flows__chip', 'data-platform': flow.platform }, PLATFORM_LABELS[flow.platform]),
        h('span', { className: 'hqd-flows__counts' }, `${plural(flow.screens.length, 'screen')} · ${plural(flow.hotspots.length, 'link')}`),
        onRate ? h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm hqd-flows__rate', 'data-rate-flow': true, 'data-queued': rated ? 'true' : undefined, onClick: onRate,
          title: rated ? 'This flow is waiting in Taste. Open Taste from the notification, or send it again to check.' : 'Send this flow to Taste for a rating' },
        icon(rated ? 'check' : 'star'), rated ? 'Waiting in Taste' : 'Rate this flow') : null),
      switcher ?? null,
      pins ? h(PinsRow, { pins, names }) : null),
    h(Filmstrip, { flow, current: state.current, previews, onShow: show, motion }),
    h('div', { className: 'hqd-flows__body' },
      h('details', { className: 'hqd-flows__map-panel', 'data-map-panel': true },
        h('summary', null, h('span', null, 'Map'), h('span', { className: 'hqd-flows__muted' }, plural(flow.hotspots.length, 'link'))),
        // Beside the player the panel is always open and its summary is hidden; this heading takes the summary's place.
        h('p', { className: 'hqd-flows__map-heading', 'aria-hidden': true }, h('span', null, 'Map'), h('span', { className: 'hqd-flows__muted' }, plural(flow.hotspots.length, 'link'))),
        h(FlowMapView, { flow, onPlayFrom: show, currentScreenId: state.current, previousScreenId: move?.from ?? null, traversed, motion, embedded: true })),
      h(PrototypePlayerView, { player, state, dispatch, previews, ...(onOpenLive ? { onOpenLive } : {}), ...(ui ? { ui } : {}) })),
    issues.length === 0 ? null : h('section', { 'aria-label': 'Flow issues', className: 'hqd-flows__issues' },
      h('details', { className: 'hqd-flows__disclosure', open: errors > 0 },
        h('summary', null,
          errors > 0 ? status('danger', plural(errors, 'problem')) : null,
          notes > 0 ? status('info', plural(notes, 'note')) : null),
        h('div', { className: 'hqd-flows__issue-body' }, h(IssueList, { issues, names })))));
}

/** Canvas embedding for HQD-02 items supplied by `createFlowCanvasProvider`. */
export function FlowCanvasItemView({ flow, kind, previews }: { readonly flow: FlowDocument; readonly kind: FlowItemKind; readonly previews?: ScreenPreviewPort }): ReactElement {
  return kind === 'flow-map' ? h(FlowMapView, { flow }) : h(CanvasPlayer, { flow, ...(previews ? { previews } : {}) });
}

function CanvasPlayer({ flow, previews }: { readonly flow: FlowDocument; readonly previews?: ScreenPreviewPort }): ReactElement {
  const { player, state, dispatch } = usePrototypePlayer(flow);
  return h(PrototypePlayerView, { player, state, dispatch, ...(previews ? { previews } : {}) });
}
