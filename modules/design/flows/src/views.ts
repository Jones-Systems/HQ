/**
 * React views for flows. Written with `createElement` rather than JSX so Node 24's built-in
 * type stripping can render them in `node --test` without a section-level JSX transform.
 */
import { createElement as h, useMemo, useReducer, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { FlowDocument, Screen, ScreenId, ScreenPreviewPort } from './contract.ts';
import { describeResolution, type EdgeResolution, type FlowIndex } from './edges.ts';
import { NODE_HEIGHT, NODE_WIDTH, layoutFlowMap } from './map.ts';
import { validateFlow, type FlowIssue } from './model.ts';
import { createPlayer, type Player, type PlayerAction, type PlayerState, type PlayerStep } from './player.ts';
import { FAKE_PREVIEWS } from './fakes.ts';
import { screenNames, screenSequence, stateLabel } from './presentation.ts';
import type { FlowItemKind } from './canvas.ts';

const panel: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', padding: 12, minWidth: 0 };
const muted: CSSProperties = { color: 'var(--muted)' };
const small: CSSProperties = { fontSize: 12, lineHeight: 1.4 };
/** Neutral matte around captures; captures keep their own colours and are never recoloured by HQ appearance. */
const matte = 'color-mix(in srgb, var(--line) 40%, var(--background))';
const PLATFORM_LABELS: Readonly<Record<FlowDocument['platform'], string>> = { web: 'Website', ios: 'iOS', android: 'Android', desktop: 'Desktop' };

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
  if (issues.length === 0) return h('p', { style: muted, 'data-issues': 0 }, 'No broken targets or warnings.');
  return h('ul', { 'aria-label': 'Flow issues', 'data-issues': issues.length, style: { margin: 0, paddingLeft: 18 } },
    issues.map((issue, n) => h('li', { key: n, 'data-issue': issue.code, 'data-severity': issue.severity, 'data-subject': issue.subject.id },
      h('strong', null, issue.severity === 'error' ? 'Error' : 'Note'), ` ${issueText(issue, names)}`)));
}

/** A short tail of a route for secondary text; the full route stays in the tooltip and details. */
function routeTail(route: string): string {
  const [path = '', query] = route.split('?', 2);
  const tail = path.split('/').filter((segment) => segment !== '').slice(-2).join('/');
  return `${tail === '' ? '/' : tail}${query === undefined ? '' : `?${query}`}`;
}

export interface FlowMapViewProps {
  readonly flow: FlowDocument;
  readonly onPlayFrom?: (screenId: FlowDocument['start']) => void;
  readonly currentScreenId?: ScreenId | null;
}

export function FlowMapView({ flow, onPlayFrom, currentScreenId = null }: FlowMapViewProps): ReactElement {
  const map = useMemo(() => layoutFlowMap(flow), [flow]);
  const names = useMemo(() => screenNames(flow), [flow]);
  const titleId = `flow-map-${flow.id}`;
  const linked = map.edges.length > 0;
  return h('section', { 'aria-labelledby': titleId, 'data-flow-map': flow.id, style: panel },
    h('h2', { id: titleId, style: { fontSize: 15, margin: '0 0 8px' } }, `${flow.title} — flow map`),
    h('div', { style: { overflowX: 'auto' } },
      h('svg', { role: 'img', 'aria-label': `Flow map with ${map.nodes.length} screens and ${map.edges.length} links`, viewBox: `0 0 ${map.width} ${map.height}`, width: map.width, height: map.height, style: { display: 'block', maxWidth: '100%', height: 'auto' } },
        h('defs', null, h('marker', { id: `${titleId}-arrow`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' },
          h('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'currentColor' })),
          h('clipPath', { id: `${titleId}-clip` }, h('rect', { x: 8, y: 0, width: NODE_WIDTH - 16, height: NODE_HEIGHT }))),
        map.edges.map((edge) => edge.segment && h('line', {
          key: edge.id, 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
          x1: edge.segment.x1, y1: edge.segment.y1, x2: edge.segment.x2, y2: edge.segment.y2,
          stroke: edge.resolution.status === 'broken' ? '#c62828' : 'currentColor', strokeWidth: 1.5,
          strokeDasharray: edge.resolution.status === 'ok' ? undefined : '4 3', markerEnd: `url(#${titleId}-arrow)`,
        }, h('title', null, `${edge.label} → ${targetText(edge.resolution, map.index, names)}`))),
        map.nodes.map((node) => {
          const name = names.get(node.screenId) ?? node.title;
          const current = node.screenId === currentScreenId;
          const open = onPlayFrom ? () => onPlayFrom(node.screenId) : undefined;
          return h('g', {
            key: node.screenId, 'data-node': node.screenId, transform: `translate(${node.x} ${node.y})`,
            ...(open ? { role: 'button', tabIndex: 0, 'aria-label': `Show ${name}`, 'aria-current': current ? 'step' : undefined, style: { cursor: 'pointer' }, onClick: open,
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } } } : {}),
          },
          h('title', null, `${name} — ${node.route}`),
          h('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 6, fill: current ? 'var(--selected, var(--background))' : 'var(--background)', stroke: node.isStart || current ? 'var(--accent)' : 'var(--line)', strokeWidth: node.isStart || current ? 2 : 1, strokeDasharray: node.reachable ? undefined : '3 3' }),
          h('g', { clipPath: `url(#${titleId}-clip)` },
            h('text', { x: 10, y: 24, fill: 'currentColor', fontSize: 13, fontWeight: 600 }, name),
            h('text', { x: 10, y: 44, fill: 'currentColor', fontSize: 11, opacity: 0.7 }, stateLabel(node.state) ?? routeTail(node.route)),
            h('text', { x: 10, y: NODE_HEIGHT - 12, fill: 'currentColor', fontSize: 11, opacity: node.isStart ? 1 : 0.7 },
              node.isStart ? 'Start' : node.reachable ? '' : 'No link to here')));
        }))),
    linked
      ? h('table', { 'aria-label': 'Flow links', style: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 } },
        h('thead', null, h('tr', null, h('th', { scope: 'col', align: 'left' }, 'From'), h('th', { scope: 'col', align: 'left' }, 'Hotspot'), h('th', { scope: 'col', align: 'left' }, 'Goes to'))),
        h('tbody', null, map.edges.map((edge) => h('tr', { key: edge.id, 'data-edge-row': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution) },
          h('td', null, edge.fromExists ? names.get(edge.from) ?? edge.from : `Missing screen ${edge.from}`),
          h('td', null, edge.label),
          h('td', null, targetText(edge.resolution, map.index, names))))))
      : h('p', { 'data-no-links': true, style: { ...muted, ...small, margin: '8px 0 0' } }, 'No links between screens are recorded in this flow.'));
}

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

/** Width of a capture frame: never above its own size, the column, or a share of the window height. */
/** Height budget: the window less the chrome, strip and controls above the stage, never below a usable floor. */
const STAGE_HEIGHT = 'max(300px, 100dvh - 360px)';
function frameWidth(viewport: Screen['viewport'], border: number): string {
  return `min(100% - ${border * 2}px, ${viewport.w}px, (${STAGE_HEIGHT} - ${border * 2}px) * ${viewport.w / viewport.h})`;
}

const phoneSized = (viewport: Screen['viewport'], platform: FlowDocument['platform']): boolean =>
  platform === 'ios' || platform === 'android' || (viewport.w <= 480 && viewport.h > viewport.w);

export interface PrototypePlayerViewProps {
  readonly player: Player;
  readonly state: PlayerState;
  readonly dispatch: (action: PlayerAction) => void;
  readonly previews?: ScreenPreviewPort;
  /** Offered only when the caller has an open live preview bound to this flow's exact source. */
  readonly onOpenLive?: (screen: Screen) => void;
}

export function PrototypePlayerView({ player, state, dispatch, previews = FAKE_PREVIEWS, onOpenLive }: PrototypePlayerViewProps): ReactElement {
  const names = useMemo(() => screenNames(player.flow), [player.flow]);
  const sequence = useMemo(() => screenSequence(player.flow), [player.flow]);
  const screen = state.current === null ? undefined : player.index.screensById.get(state.current);
  const position = screen ? sequence.findIndex((item) => item.id === screen.id) : -1;
  const linked = player.flow.hotspots.length > 0;
  const last = state.steps.at(-1);
  const alert = state.notice?.kind === 'missing-start' ? `Start screen ${state.notice.screenId} does not exist.`
    : last?.outcome.kind === 'broken' || last?.outcome.kind === 'back-unavailable' ? stepText(last, player.index, names) : null;
  const preview = screen ? previews.previewUrl(screen) : null;
  const name = screen ? names.get(screen.id) ?? screen.title : '';
  const phone = screen ? phoneSized(screen.viewport, player.flow.platform) : false;
  const hotspots = screen ? player.hotspotsOn(screen.id) : [];
  const show = (target: Screen | undefined) => { if (target) dispatch({ type: 'start', screenId: target.id }); };
  const onFrameClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!screen || event.target !== event.currentTarget) return;
    // Hotspots are positioned in the padding box, so map from it rather than the bordered rect.
    const frame = event.currentTarget;
    const box = frame.getBoundingClientRect();
    const x = (event.clientX - box.left - frame.clientLeft) / frame.clientWidth * screen.viewport.w;
    const y = (event.clientY - box.top - frame.clientTop) / frame.clientHeight * screen.viewport.h;
    dispatch({ type: 'click', point: { x, y } });
  };
  return h('section', { 'aria-label': `${player.flow.title} prototype player`, 'data-player': player.flow.id, 'data-current': state.current ?? '', style: { ...panel, display: 'grid', gap: 10 } },
    h('div', null,
      h('p', { role: 'note', 'data-evidence': player.evidence.kind, style: { margin: 0, fontWeight: 600 } }, player.evidence.label),
      h('p', { 'data-playback': 'recorded', style: { ...muted, ...small, margin: '2px 0 0' } }, 'Saved captures are still images recorded from the live preview, not the live page.')),
    h('div', { role: 'toolbar', 'aria-label': 'Screen playback', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 } },
      h('button', { type: 'button', 'data-player-restart': true, onClick: () => dispatch({ type: 'start' }) }, 'Start'),
      h('button', { type: 'button', 'data-player-previous': true, disabled: position <= 0, title: 'Previous screen in the list', onClick: () => show(sequence[position - 1]) }, '‹ Previous'),
      h('button', { type: 'button', 'data-player-next': true, disabled: position < 0 || position >= sequence.length - 1, title: 'Next screen in the list', onClick: () => show(sequence[position + 1]) }, 'Next ›'),
      linked ? h('button', { type: 'button', 'data-player-back': true, disabled: state.current === null, title: 'Return along the links you followed', onClick: () => dispatch({ type: 'back' }) }, 'Back') : null,
      screen ? h('span', { 'aria-live': 'polite', 'data-player-position': position + 1, style: { marginLeft: 4, minWidth: 0 } },
        h('strong', null, name), h('span', { style: muted }, ` · screen ${position + 1} of ${sequence.length}`)) : null),
    linked ? null : h('p', { 'data-player-unlinked': true, style: { ...muted, ...small, margin: 0 } },
      'No links are recorded between these screens, so Previous and Next follow the saved screen order.'),
    alert ? h('p', { role: 'alert', 'data-player-alert': true, style: { color: '#c62828', margin: 0 } }, alert) : null,
    screen ? h('div', { 'data-stage': true, style: { display: 'flex', justifyContent: 'center', padding: phone ? 16 : 12, borderRadius: 8, background: matte, minWidth: 0 } },
      // Captures keep their own colors; HQ appearance only styles the surrounding chrome.
      h('div', { 'data-screen': screen.id, 'data-frame': phone ? 'phone' : 'page', onClick: onFrameClick, style: {
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
          return h('button', {
            key: hotspot.id, type: 'button', 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
            'aria-label': `${hotspot.label} → ${target}`, title: target, onClick: () => dispatch({ type: 'activate', hotspotId: hotspot.id }),
            style: {
              position: 'absolute', left: `${hotspot.rect.x / screen.viewport.w * 100}%`, top: `${hotspot.rect.y / screen.viewport.h * 100}%`,
              width: `${hotspot.rect.width / screen.viewport.w * 100}%`, height: `${hotspot.rect.height / screen.viewport.h * 100}%`,
              background: edge.resolution.status === 'broken' ? 'rgba(198,40,40,0.18)' : 'rgba(25,118,210,0.12)',
              border: `1px dashed ${edge.resolution.status === 'broken' ? '#c62828' : '#1976d2'}`, cursor: 'pointer', padding: 0, minHeight: 0, borderRadius: 2,
            },
          });
        }))) : null,
    screen && hotspots.length > 0 ? h('div', { role: 'group', 'aria-label': `Links on ${name}`, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, ...small } },
      h('span', { style: muted }, 'Links:'),
      hotspots.map((hotspot) => {
        const edge = player.edgeFor(hotspot.id)!;
        return h('button', { key: hotspot.id, type: 'button', 'data-link-edge': edge.id, onClick: () => dispatch({ type: 'activate', hotspotId: hotspot.id }) },
          `${hotspot.label} → ${targetText(edge.resolution, player.index, names)}`);
      })) : null,
    state.notice?.kind === 'miss' ? h('p', { 'data-player-miss': true, style: { ...muted, fontSize: 13, margin: 0 } }, `No hotspot at ${Math.round(state.notice.point.x)}, ${Math.round(state.notice.point.y)}.`) : null,
    screen && onOpenLive ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
      h('button', { type: 'button', 'data-open-live': screen.id, onClick: () => onOpenLive(screen) }, 'Show this page in the live preview'),
      h('span', { style: { ...muted, ...small } }, 'The live page is current and may differ from this capture.')) : null,
    screen ? h('details', { 'data-capture-details': true, style: small },
      h('summary', { style: { cursor: 'pointer' } }, 'Capture details'),
      h('dl', { style: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '2px 10px', margin: '6px 0 0' } },
        ...([['Route', screen.route], ['State', stateLabel(screen.state) ?? 'none'], ['Viewport', `${screen.viewport.w} × ${screen.viewport.h} @${screen.viewport.dpr}x`],
          ['Version', screen.versionId], ['Capture', screen.captureDigest ?? 'none recorded']] as const).flatMap(([term, value]) => [
          h('dt', { key: `${term}-t`, style: muted }, term), h('dd', { key: `${term}-d`, style: { margin: 0, overflowWrap: 'anywhere' } }, h('code', null, value))]))) : null,
    h('details', { 'data-player-history': true, style: small },
      h('summary', { style: { cursor: 'pointer' } }, `Playback history (${state.steps.length})`),
      h('ol', { 'aria-label': 'Prototype steps', style: { paddingLeft: 18, margin: '6px 0 0' } },
        state.steps.map((step) => h('li', { key: step.index, 'data-step': step.index, 'data-step-outcome': step.outcome.kind, 'data-evidence': step.evidence.kind },
          stepText(step, player.index, names), ' ', h('em', { style: muted }, `(${step.evidence.label})`))))));
}

export function usePrototypePlayer(flow: FlowDocument): { readonly player: Player; readonly state: PlayerState; readonly dispatch: (action: PlayerAction) => void } {
  const player = useMemo(() => createPlayer(flow), [flow]);
  const [state, dispatch] = useReducer(player.reduce, undefined, player.initial);
  return { player, state, dispatch };
}

/** Saved screens as thumbnails in sequence; choosing one shows it in the player. */
function ScreenStrip({ flow, current, previews, onShow }: { readonly flow: FlowDocument; readonly current: ScreenId | null; readonly previews: ScreenPreviewPort; readonly onShow: (screenId: ScreenId) => void }): ReactElement {
  const names = useMemo(() => screenNames(flow), [flow]);
  const sequence = useMemo(() => screenSequence(flow), [flow]);
  const reachable = useMemo(() => new Set(layoutFlowMap(flow).nodes.filter((node) => node.reachable).map((node) => node.screenId)), [flow]);
  const linked = flow.hotspots.length > 0;
  // Wraps: one column beside the player, rows across the full width when stacked above it.
  return h('ol', { 'aria-label': 'Screens', style: { display: 'flex', flexWrap: 'wrap', alignContent: 'start', gap: 8, listStyle: 'none', margin: 0, padding: 0 } },
    sequence.map((screen, n) => {
      const name = names.get(screen.id) ?? screen.title;
      const preview = previews.previewUrl(screen);
      const selected = screen.id === current;
      return h('li', { key: screen.id, style: { flex: 'none' } },
        h('button', { type: 'button', 'data-play-from': screen.id, 'aria-current': selected ? 'step' : undefined, title: screen.route, onClick: () => onShow(screen.id),
          'aria-label': `${n + 1}. ${name}${screen.id === flow.start ? ', start screen' : ''}`,
          style: { display: 'grid', gap: 6, justifyItems: 'start', width: 132, padding: 6, textAlign: 'left', borderRadius: 8,
            border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`, boxShadow: selected ? 'inset 0 0 0 1px var(--accent)' : 'none', background: selected ? 'var(--selected, var(--surface))' : 'var(--surface)' } },
          h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: '100%', height: 80, borderRadius: 4, overflow: 'hidden', background: matte } },
            preview ? h('img', { src: preview, alt: '', draggable: false, style: { display: 'block', height: 80, width: 'auto', maxWidth: '100%', aspectRatio: `${screen.viewport.w} / ${screen.viewport.h}`, objectFit: 'cover', objectPosition: 'top', background: '#ffffff' } })
              : h('span', { style: { ...muted, ...small } }, 'No image')),
          h('span', { style: { display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0, width: '100%' } },
            h('span', { style: { ...muted, ...small } }, `${n + 1}`),
            h('strong', { style: { fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' } }, name)),
          screen.id === flow.start ? h('span', { style: { ...small, color: 'var(--accent)' } }, 'Start')
            : linked && !reachable.has(screen.id) ? h('span', { style: { ...muted, ...small } }, 'No link to here') : null));
    }));
}

export interface FlowsWorkspaceProps {
  readonly flow: FlowDocument;
  readonly previews?: ScreenPreviewPort;
  readonly onOpenLive?: (screen: Screen) => void;
}

/** Screens, player, map and issues for one flow. `key` the component by flow id to reset playback. */
export function FlowsWorkspace({ flow, previews = FAKE_PREVIEWS, onOpenLive }: FlowsWorkspaceProps): ReactElement {
  const { player, state, dispatch } = usePrototypePlayer(flow);
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const names = useMemo(() => screenNames(flow), [flow]);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const notes = issues.length - errors;
  const show = (screenId: ScreenId) => dispatch({ type: 'start', screenId });
  return h('div', { 'data-flows-workspace': flow.id, style: { display: 'grid', gap: 12, minWidth: 0 } },
    h('div', null,
      h('h2', { style: { fontSize: 15, margin: 0 } }, flow.title),
      h('p', { style: { ...muted, ...small, margin: '2px 0 0' } },
        `${PLATFORM_LABELS[flow.platform]} · ${flow.screens.length} ${flow.screens.length === 1 ? 'screen' : 'screens'} · ${flow.hotspots.length} ${flow.hotspots.length === 1 ? 'link' : 'links'}`)),
    // The player takes almost all free width beside the screen list; when they wrap, the list spans the row.
    h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, minWidth: 0 } },
      h('nav', { 'aria-label': `${flow.title} screens`, style: { flex: '1 1 146px', minWidth: 0 } }, h(ScreenStrip, { flow, current: state.current, previews, onShow: show })),
      h('div', { style: { flex: '999 1 420px', minWidth: 0 } }, h(PrototypePlayerView, { player, state, dispatch, previews, ...(onOpenLive ? { onOpenLive } : {}) }))),
    h('details', { open: flow.hotspots.length > 0, style: { minWidth: 0 } },
      h('summary', { style: { cursor: 'pointer', margin: '0 0 8px' } }, 'Flow map and links'),
      h(FlowMapView, { flow, onPlayFrom: show, currentScreenId: state.current })),
    issues.length === 0 ? null : h('section', { 'aria-label': 'Flow issues', style: panel },
      h('details', { open: errors > 0 },
        h('summary', { style: { cursor: 'pointer' } }, [errors > 0 ? `${errors} ${errors === 1 ? 'problem' : 'problems'}` : null, notes > 0 ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : null].filter(Boolean).join(' · ')),
        h('div', { style: { marginTop: 6 } }, h(IssueList, { issues, names })))));
}

/** Canvas embedding for HQD-02 items supplied by `createFlowCanvasProvider`. */
export function FlowCanvasItemView({ flow, kind, previews }: { readonly flow: FlowDocument; readonly kind: FlowItemKind; readonly previews?: ScreenPreviewPort }): ReactElement {
  return kind === 'flow-map' ? h(FlowMapView, { flow }) : h(CanvasPlayer, { flow, ...(previews ? { previews } : {}) });
}

function CanvasPlayer({ flow, previews }: { readonly flow: FlowDocument; readonly previews?: ScreenPreviewPort }): ReactElement {
  const { player, state, dispatch } = usePrototypePlayer(flow);
  return h(PrototypePlayerView, { player, state, dispatch, ...(previews ? { previews } : {}) });
}
