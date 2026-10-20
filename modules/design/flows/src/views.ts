/**
 * React views for flows. Written with `createElement` rather than JSX so Node 24's built-in
 * type stripping can render them in `node --test` without a section-level JSX transform.
 */
import { createElement as h, useMemo, useReducer, type CSSProperties, type MouseEvent, type ReactElement } from 'react';
import type { FlowDocument, ScreenId, ScreenPreviewPort } from './contract.ts';
import { describeResolution, type EdgeResolution, type FlowIndex } from './edges.ts';
import { NODE_HEIGHT, NODE_WIDTH, layoutFlowMap } from './map.ts';
import { validateFlow, type FlowIssue } from './model.ts';
import { createPlayer, type Player, type PlayerAction, type PlayerState, type PlayerStep } from './player.ts';
import { FAKE_PREVIEWS } from './fakes.ts';
import type { FlowItemKind } from './canvas.ts';

const panel: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', padding: 12 };
const muted: CSSProperties = { color: 'var(--muted)' };

/** Stable DOM attribute describing where an edge goes; the map and player emit the same value. */
export function edgeTargetAttribute(resolution: EdgeResolution): string {
  switch (resolution.status) {
    case 'ok': return `screen:${resolution.to}`;
    case 'back': return 'back';
    case 'exit': return `exit:${resolution.url}`;
    case 'broken': return `broken:${resolution.reason}`;
  }
}

export function IssueList({ issues }: { readonly issues: readonly FlowIssue[] }): ReactElement {
  if (issues.length === 0) return h('p', { style: muted, 'data-issues': 0 }, 'No broken targets or warnings.');
  return h('ul', { 'aria-label': 'Flow issues', 'data-issues': issues.length, style: { margin: 0, paddingLeft: 18 } },
    issues.map((issue, n) => h('li', { key: n, 'data-issue': issue.code, 'data-severity': issue.severity, 'data-subject': issue.subject.id },
      h('strong', null, issue.severity === 'error' ? 'Error' : 'Warning'), ` ${issue.message}`)));
}

export interface FlowMapViewProps {
  readonly flow: FlowDocument;
  readonly onPlayFrom?: (screenId: FlowDocument['start']) => void;
}

export function FlowMapView({ flow, onPlayFrom }: FlowMapViewProps): ReactElement {
  const map = useMemo(() => layoutFlowMap(flow), [flow]);
  const titleId = `flow-map-${flow.id}`;
  return h('section', { 'aria-labelledby': titleId, 'data-flow-map': flow.id, style: panel },
    h('h2', { id: titleId, style: { fontSize: 15, margin: '0 0 8px' } }, `${flow.title} — flow map`),
    h('svg', { role: 'img', 'aria-label': `Flow map with ${map.nodes.length} screens and ${map.edges.length} links`, viewBox: `0 0 ${map.width} ${map.height}`, width: map.width, height: map.height, style: { maxWidth: '100%', height: 'auto' } },
      h('defs', null, h('marker', { id: `${titleId}-arrow`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' },
        h('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'currentColor' }))),
      map.edges.map((edge) => edge.segment && h('line', {
        key: edge.id, 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
        x1: edge.segment.x1, y1: edge.segment.y1, x2: edge.segment.x2, y2: edge.segment.y2,
        stroke: edge.resolution.status === 'broken' ? '#c62828' : 'currentColor', strokeWidth: 1.5,
        strokeDasharray: edge.resolution.status === 'ok' ? undefined : '4 3', markerEnd: `url(#${titleId}-arrow)`,
      }, h('title', null, `${edge.label} → ${describeResolution(edge.resolution, map.index)}`))),
      map.nodes.map((node) => h('g', { key: node.screenId, 'data-node': node.screenId, transform: `translate(${node.x} ${node.y})` },
        h('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 6, fill: 'var(--background)', stroke: node.isStart ? 'var(--accent)' : 'var(--line)', strokeWidth: node.isStart ? 2 : 1, strokeDasharray: node.reachable ? undefined : '3 3' }),
        h('text', { x: 10, y: 22, fill: 'currentColor', fontSize: 13 }, node.title),
        h('text', { x: 10, y: 42, fill: 'currentColor', fontSize: 11, opacity: 0.7 }, `${node.route} · ${node.state}`),
        node.isStart ? h('text', { x: 10, y: NODE_HEIGHT - 12, fill: 'currentColor', fontSize: 11 }, 'Start') : null))),
    h('table', { 'aria-label': 'Flow links', style: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 } },
      h('thead', null, h('tr', null, h('th', { scope: 'col', align: 'left' }, 'From'), h('th', { scope: 'col', align: 'left' }, 'Hotspot'), h('th', { scope: 'col', align: 'left' }, 'Goes to'))),
      h('tbody', null, map.edges.map((edge) => h('tr', { key: edge.id, 'data-edge-row': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution) },
        h('td', null, edge.fromExists ? map.index.screensById.get(edge.from)!.title : `Missing screen ${edge.from}`),
        h('td', null, edge.label),
        h('td', null, describeResolution(edge.resolution, map.index)))))),
    onPlayFrom ? h('div', { role: 'group', 'aria-label': 'Play from screen', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
      map.nodes.map((node) => h('button', { key: node.screenId, type: 'button', 'data-play-from': node.screenId, onClick: () => onPlayFrom(node.screenId) }, `Play from ${node.title}`))) : null);
}

function stepText(step: PlayerStep, index: FlowIndex): string {
  const title = (id: ScreenId): string => index.screensById.get(id)?.title ?? id;
  switch (step.outcome.kind) {
    case 'entered': return `Entered ${title(step.outcome.to)}`;
    case 'navigated': return `${title(step.from!)} → ${title(step.outcome.to)}`;
    case 'back': return `Back to ${title(step.outcome.to)}`;
    case 'back-unavailable': return 'Back unavailable: no previous screen';
    case 'exit': return `Leaves prototype (not opened): ${step.outcome.url}`;
    case 'broken': return `Broken target reported, not followed: ${step.outcome.detail}`;
  }
}

export interface PrototypePlayerViewProps {
  readonly player: Player;
  readonly state: PlayerState;
  readonly dispatch: (action: PlayerAction) => void;
  readonly previews?: ScreenPreviewPort;
}

export function PrototypePlayerView({ player, state, dispatch, previews = FAKE_PREVIEWS }: PrototypePlayerViewProps): ReactElement {
  const screen = state.current === null ? undefined : player.index.screensById.get(state.current);
  const last = state.steps.at(-1);
  const alert = state.notice?.kind === 'missing-start' ? `Start screen ${state.notice.screenId} does not exist.`
    : last?.outcome.kind === 'broken' || last?.outcome.kind === 'back-unavailable' ? stepText(last, player.index) : null;
  const preview = screen ? previews.previewUrl(screen) : null;
  const onFrameClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!screen || event.target !== event.currentTarget) return;
    // Hotspots are positioned in the padding box, so map from it rather than the bordered rect.
    const frame = event.currentTarget;
    const box = frame.getBoundingClientRect();
    const x = (event.clientX - box.left - frame.clientLeft) / frame.clientWidth * screen.viewport.w;
    const y = (event.clientY - box.top - frame.clientTop) / frame.clientHeight * screen.viewport.h;
    dispatch({ type: 'click', point: { x, y } });
  };
  return h('section', { 'aria-label': `${player.flow.title} prototype player`, 'data-player': player.flow.id, 'data-current': state.current ?? '', style: panel },
    h('p', { role: 'note', 'data-evidence': player.evidence.kind, style: { margin: '0 0 8px', fontWeight: 600 } }, player.evidence.label),
    alert ? h('p', { role: 'alert', 'data-player-alert': true, style: { color: '#c62828', margin: '0 0 8px' } }, alert) : null,
    screen ? h('div', null,
      h('p', { style: { ...muted, margin: '0 0 6px', fontSize: 13 } }, `${screen.title} · ${screen.route} · ${screen.state} · version ${screen.versionId}`),
      // Captures keep their own colors; HQ appearance only styles the surrounding chrome.
      h('div', { 'data-screen': screen.id, onClick: onFrameClick, style: { position: 'relative', aspectRatio: `${screen.viewport.w} / ${screen.viewport.h}`, maxWidth: screen.viewport.w, border: '1px solid var(--line)', background: '#ffffff', color: '#1a1a1a', overflow: 'hidden' } },
        preview ? h('img', { src: preview, alt: '', draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } })
          : h('span', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, pointerEvents: 'none' } }, `No capture · ${screen.title}`),
        player.hotspotsOn(screen.id).map((hotspot) => {
          const edge = player.edgeFor(hotspot.id)!;
          const target = describeResolution(edge.resolution, player.index);
          return h('button', {
            key: hotspot.id, type: 'button', 'data-edge-id': edge.id, 'data-from': edge.from, 'data-to': edgeTargetAttribute(edge.resolution),
            'aria-label': `${hotspot.label} → ${target}`, title: target, onClick: () => dispatch({ type: 'activate', hotspotId: hotspot.id }),
            style: {
              position: 'absolute', left: `${hotspot.rect.x / screen.viewport.w * 100}%`, top: `${hotspot.rect.y / screen.viewport.h * 100}%`,
              width: `${hotspot.rect.width / screen.viewport.w * 100}%`, height: `${hotspot.rect.height / screen.viewport.h * 100}%`,
              background: edge.resolution.status === 'broken' ? 'rgba(198,40,40,0.18)' : 'rgba(25,118,210,0.12)',
              border: `1px dashed ${edge.resolution.status === 'broken' ? '#c62828' : '#1976d2'}`, cursor: 'pointer', padding: 0,
            },
          });
        }))) : null,
    h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
      h('button', { type: 'button', 'data-player-back': true, disabled: state.current === null, onClick: () => dispatch({ type: 'back' }) }, 'Back'),
      h('button', { type: 'button', 'data-player-restart': true, onClick: () => dispatch({ type: 'start' }) }, 'Restart')),
    state.notice?.kind === 'miss' ? h('p', { 'data-player-miss': true, style: { ...muted, fontSize: 13 } }, `No hotspot at ${Math.round(state.notice.point.x)}, ${Math.round(state.notice.point.y)}.`) : null,
    h('ol', { 'aria-label': 'Prototype steps', style: { paddingLeft: 18, fontSize: 13 } },
      state.steps.map((step) => h('li', { key: step.index, 'data-step': step.index, 'data-step-outcome': step.outcome.kind, 'data-evidence': step.evidence.kind },
        stepText(step, player.index), ' ', h('em', { style: muted }, `(${step.evidence.label})`)))));
}

export function usePrototypePlayer(flow: FlowDocument): { readonly player: Player; readonly state: PlayerState; readonly dispatch: (action: PlayerAction) => void } {
  const player = useMemo(() => createPlayer(flow), [flow]);
  const [state, dispatch] = useReducer(player.reduce, undefined, player.initial);
  return { player, state, dispatch };
}

export interface FlowsWorkspaceProps {
  readonly flow: FlowDocument;
  readonly previews?: ScreenPreviewPort;
}

/** Map, issues and player for one flow. `key` the component by flow id to reset playback. */
export function FlowsWorkspace({ flow, previews }: FlowsWorkspaceProps): ReactElement {
  const { player, state, dispatch } = usePrototypePlayer(flow);
  const issues = useMemo(() => validateFlow(flow), [flow]);
  return h('div', { 'data-flows-workspace': flow.id, style: { display: 'grid', gap: 12 } },
    h('section', { 'aria-label': 'Flow issues', style: panel }, h(IssueList, { issues })),
    h(FlowMapView, { flow, onPlayFrom: (screenId) => dispatch({ type: 'start', screenId }) }),
    h(PrototypePlayerView, { player, state, dispatch, ...(previews ? { previews } : {}) }));
}

/** Canvas embedding for HQD-02 items supplied by `createFlowCanvasProvider`. */
export function FlowCanvasItemView({ flow, kind, previews }: { readonly flow: FlowDocument; readonly kind: FlowItemKind; readonly previews?: ScreenPreviewPort }): ReactElement {
  return kind === 'flow-map' ? h(FlowMapView, { flow }) : h(CanvasPlayer, { flow, ...(previews ? { previews } : {}) });
}

function CanvasPlayer({ flow, previews }: { readonly flow: FlowDocument; readonly previews?: ScreenPreviewPort }): ReactElement {
  const { player, state, dispatch } = usePrototypePlayer(flow);
  return h(PrototypePlayerView, { player, state, dispatch, ...(previews ? { previews } : {}) });
}
