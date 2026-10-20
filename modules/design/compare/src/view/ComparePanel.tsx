import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { HostSurfacePlacement, OverlayFrame, PreviewQualification, PreviewSession, SyntheticBlock, VersionSummary } from '../contract.ts';
import type { PanelRuntime } from '../controller.ts';
import { fitScale, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, PANEL_INSET } from '../geometry.ts';
import { labelSource, ROLE_LABELS } from '../labels.ts';
import type { Panel, PanelRole } from '../model.ts';
import { describeViewport, VIEWPORT_PRESETS } from '../presets.ts';

export interface PanelSlots {
  /** Shell-owned overlay state; native views must not cover HQ dialogs or menus. */
  readonly overlaysOpen?: boolean;
  /** HQ renderer zoom, not devicePixelRatio or the preview viewport DPR. Defaults to 1. */
  readonly rendererZoomFactor?: number;
  readonly onHostSurfacePlacement?: (session: PreviewSession, placement: HostSurfacePlacement) => void;
  /** HQD-04 overlays, positioned in source CSS pixels inside the scaled frame. */
  readonly renderOverlay?: (frame: OverlayFrame) => ReactNode;
  /** Root-owned qualified preview surface (S2). Compare never creates frames itself. */
  readonly renderHostSurface?: (session: PreviewSession, frame: OverlayFrame) => ReactNode;
}

export interface PanelActions {
  resize(width: number): void;
  scroll(position: { x: number; y: number }): void;
  setRole(role: PanelRole): void;
  applyPreset(presetId: string): void;
  selectVersion(versionId: string, mode: Panel['source']['kind']): void;
  addPanel(): void;
  removePanel(): void;
}

export interface ComparePanelProps extends PanelSlots {
  readonly panel: Panel;
  readonly index: number;
  readonly runtime: PanelRuntime | undefined;
  readonly versions: readonly VersionSummary[] | undefined;
  readonly preview: { readonly qualification: PreviewQualification; readonly label: string } | null;
  readonly canRemove: boolean;
  readonly actions: PanelActions;
}

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
/** Programmatic scroll echoes within this many layout pixels are not re-dispatched. */
const ECHO_TOLERANCE = 1.5;

function Synthetic({ blocks }: { readonly blocks: readonly SyntheticBlock[] }) {
  return <>{blocks.map((block, i) => <div key={i} className="cmp-block" style={{
    left: block.x, top: block.y, width: block.width, height: block.height, background: block.fill,
  }}>{block.text}</div>)}</>;
}

export function ComparePanel({ panel, index, runtime, versions, preview, canRemove, actions, renderOverlay, renderHostSurface, overlaysOpen = false, rendererZoomFactor = 1, onHostSurfacePlacement }: ComparePanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const echo = useRef<{ left: number; top: number } | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const scale = fitScale(panel.width, panel.viewport);
  const content = runtime?.contentSize ?? null;
  const status = runtime?.status ?? 'loading';
  const label = labelSource(panel.source, runtime?.capture ?? null, runtime?.qualification ?? preview?.qualification ?? null, preview?.label ?? null);
  const titleId = `cmp-panel-${panel.id}-title`;
  const versionLabel = runtime?.version?.label ?? 'Unresolved version';

  // Apply model scroll to the element; remember it so the echo event is ignored.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null) return;
    const left = panel.scroll.x * scale;
    const top = panel.scroll.y * scale;
    if (Math.abs(element.scrollLeft - left) <= ECHO_TOLERANCE && Math.abs(element.scrollTop - top) <= ECHO_TOLERANCE) return;
    echo.current = { left, top };
    element.scrollLeft = left;
    element.scrollTop = top;
  }, [panel.scroll.x, panel.scroll.y, scale, content]);

  const hostSession = panel.source.kind === 'live-preview' && runtime?.session?.surface.kind === 'host-surface'
    ? runtime.session : null;
  useLayoutEffect(() => {
    if (hostSession === null || onHostSurfacePlacement === undefined) return;
    const element = scroller.current;
    const owner = element?.ownerDocument.defaultView;
    let last: HostSurfacePlacement | null = null;
    let request = 0;
    const report = () => {
      const bounds = element?.getBoundingClientRect();
      const zoom = rendererZoomFactor;
      const valid = bounds !== undefined && Number.isFinite(zoom) && zoom > 0;
      const rect = valid ? { x: bounds.x * zoom, y: bounds.y * zoom, width: bounds.width * zoom, height: bounds.height * zoom }
        : { x: 0, y: 0, width: 0, height: 0 };
      const visible = valid && status === 'ready' && !overlaysOpen && element?.isConnected === true
        && element.ownerDocument.visibilityState !== 'hidden' && rect.width > 0 && rect.height > 0;
      const next = { rect, visible };
      if (last === null || JSON.stringify(last) !== JSON.stringify(next)) {
        last = next;
        onHostSurfacePlacement(hostSession, next);
      }
    };
    // Layout shifts can move a panel without resizing it or emitting a scroll event.
    const tick = () => { report(); request = owner?.requestAnimationFrame(tick) ?? 0; };
    report();
    request = owner?.requestAnimationFrame(tick) ?? 0;
    owner?.addEventListener('scroll', report, true);
    owner?.addEventListener('resize', report);
    element?.ownerDocument.addEventListener('visibilitychange', report);
    return () => {
      owner?.cancelAnimationFrame(request);
      owner?.removeEventListener('scroll', report, true);
      owner?.removeEventListener('resize', report);
      element?.ownerDocument.removeEventListener('visibilitychange', report);
      onHostSurfacePlacement(hostSession, { rect: last?.rect ?? { x: 0, y: 0, width: 0, height: 0 }, visible: false });
    };
  }, [hostSession, status, overlaysOpen, rendererZoomFactor, onHostSurfacePlacement]);

  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    const expected = echo.current;
    if (expected !== null && Math.abs(element.scrollLeft - expected.left) <= ECHO_TOLERANCE
      && Math.abs(element.scrollTop - expected.top) <= ECHO_TOLERANCE) { echo.current = null; return; }
    echo.current = null;
    actions.scroll({ x: element.scrollLeft / scale, y: element.scrollTop / scale });
  };

  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    if (event.key === 'ArrowLeft') actions.resize(panel.width - step);
    else if (event.key === 'ArrowRight') actions.resize(panel.width + step);
    else return;
    event.preventDefault();
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: panel.width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) actions.resize(drag.current.startWidth + event.clientX - drag.current.startX);
  };
  const endDrag = () => { drag.current = null; };

  const frame: OverlayFrame | null = runtime?.version == null || content === null ? null : {
    panelId: panel.id, versionId: panel.source.versionId, sourceKind: panel.source.kind,
    route: panel.source.kind === 'live-preview' ? panel.source.route : (runtime.capture?.route ?? runtime.version.route),
    state: panel.source.kind === 'live-preview' ? panel.source.state : (runtime.capture?.state ?? runtime.version.state),
    viewport: panel.viewport, scroll: panel.scroll, contentSize: content, scale,
    captureDigest: panel.source.kind === 'static-capture' ? panel.source.captureDigest : null,
  };

  let body: ReactNode;
  if (status === 'ready' && frame !== null && content !== null) {
    let surface: ReactNode = null;
    if (panel.source.kind === 'static-capture' && runtime?.imageSrc != null) {
      surface = <img className="cmp-capture" src={runtime.imageSrc} width={content.width} height={content.height}
        alt={`Static capture of ${versionLabel}`} draggable={false} />;
    } else if (runtime?.session != null) {
      const session = runtime.session;
      surface = session.surface.kind === 'synthetic' ? <Synthetic blocks={session.surface.blocks} />
        : renderHostSurface?.(session, frame) ?? <p className="cmp-message">Hosted preview surface requires root integration.</p>;
    }
    body = <div className="cmp-scroller" ref={scroller} onScroll={onScroll} tabIndex={0}
      aria-label={`${ROLE_LABELS[panel.role]} ${versionLabel} content`}
      style={{ width: panel.viewport.w * scale, height: panel.viewport.h * scale }}>
      <div className="cmp-sizer" style={{ width: content.width * scale, height: content.height * scale }}>
        <div className="cmp-source" style={{ width: content.width, height: content.height, transform: `scale(${scale})` }}>
          {surface}
          {renderOverlay !== undefined && <div className="cmp-overlay">{renderOverlay(frame)}</div>}
        </div>
      </div>
    </div>;
  } else {
    body = <div className="cmp-scroller cmp-empty" style={{ width: panel.viewport.w * scale, height: panel.viewport.h * scale }}>
      <p className="cmp-message" role={status === 'failed' ? 'alert' : 'status'}>
        {status === 'loading' ? 'Loading pinned source…' : runtime?.error ?? 'Unavailable.'}
      </p>
    </div>;
  }

  const choices = versions ?? (runtime?.version != null ? [runtime.version] : []);
  const staticViewports = new Set((runtime?.version?.captures ?? []).map((item) => `${item.viewport.w}x${item.viewport.h}@${item.viewport.dpr}`));

  return <section className="cmp-panel" data-preview-status={status} data-panel-id={panel.id} data-role={panel.role} data-source-kind={panel.source.kind}
    aria-labelledby={titleId} style={{ width: panel.width, flexBasis: panel.width }}>
    <header className="cmp-panel-header">
      <div className="cmp-title-row">
        <span className={`cmp-role cmp-role-${panel.role}`}>{ROLE_LABELS[panel.role]}</span>
        <h2 id={titleId}>{versionLabel}</h2>
      </div>
      <code className="cmp-version-id" title="Pinned VersionId">{panel.source.versionId}</code>
      <div className={`cmp-source-badge cmp-source-${panel.source.kind}`} data-evidence={label.evidence}>
        <strong>{label.badge}</strong><span>{label.detail}</span>
      </div>
      <ul className="cmp-caveats">{label.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      <div className="cmp-controls">
        <label>Version
          <select value={panel.source.versionId} onChange={(event) => actions.selectVersion(event.target.value, panel.source.kind)}>
            {!choices.some((item) => item.versionId === panel.source.versionId) && <option value={panel.source.versionId}>{panel.source.versionId}</option>}
            {choices.map((item) => <option key={item.versionId} value={item.versionId}>{item.label} — {item.versionId}</option>)}
          </select>
        </label>
        <label>Source
          <select value={panel.source.kind} onChange={(event) => actions.selectVersion(panel.source.versionId, event.target.value === 'live-preview' ? 'live-preview' : 'static-capture')}>
            <option value="static-capture">Static capture</option>
            <option value="live-preview">Live preview</option>
          </select>
        </label>
        <label>Viewport
          <select value={panel.presetId ?? 'custom'} onChange={(event) => actions.applyPreset(event.target.value)}>
            {panel.presetId === null && <option value="custom">Custom {describeViewport(panel.viewport)}</option>}
            {VIEWPORT_PRESETS.map((preset) => {
              const unavailable = panel.source.kind === 'static-capture'
                && !staticViewports.has(`${preset.viewport.w}x${preset.viewport.h}@${preset.viewport.dpr}`);
              return <option key={preset.id} value={preset.id} disabled={unavailable}>
                {preset.label} {describeViewport(preset.viewport)}{unavailable ? ' (no capture)' : ''}
              </option>;
            })}
          </select>
        </label>
        <label>Role
          <select value={panel.role} onChange={(event) => actions.setRole(event.target.value as PanelRole)}>
            {(['baseline', 'candidate', 'reference'] as const).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </label>
      </div>
      <div className="cmp-panel-actions">
        <button type="button" onClick={actions.addPanel}>Duplicate</button>
        <button type="button" onClick={actions.removePanel} disabled={!canRemove}>Remove</button>
      </div>
    </header>
    <div className="cmp-stage" style={{ paddingInline: PANEL_INSET }}>{body}</div>
    <div className="cmp-resize" role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={`Resize panel ${index + 1}`} aria-valuenow={panel.width} aria-valuemin={MIN_PANEL_WIDTH} aria-valuemax={MAX_PANEL_WIDTH}
      onKeyDown={onHandleKey} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
  </section>;
}
