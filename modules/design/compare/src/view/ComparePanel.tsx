import { Button, Presence, usePresence } from '@hq/ui';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { HostSurfacePlacement, OverlayFrame, PreviewQualification, PreviewSession, VersionSummary } from '../contract.ts';
import type { PanelRuntime } from '../controller.ts';
import { fitScale, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, PANEL_INSET } from '../geometry.ts';
import { labelSource, ROLE_LABELS } from '../labels.ts';
import type { Panel, PanelRole } from '../model.ts';
import { describeViewport, VIEWPORT_PRESETS } from '../presets.ts';
import { ActionButton, buildFrame, chain, Chevron, PendingStage, Surface, VersionSelect } from './parts.tsx';

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
  /** The versions the Version menu offers: every version the project has, else the pinned version's view. */
  readonly versions: readonly VersionSummary[] | undefined;
  readonly preview: { readonly qualification: PreviewQualification; readonly label: string } | null;
  readonly canRemove: boolean;
  /** False once the comparison holds its maximum number of panels. */
  readonly canAdd?: boolean;
  readonly actions: PanelActions;
}

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
/** Programmatic scroll echoes within this many layout pixels are not re-dispatched. */
const ECHO_TOLERANCE = 1.5;

export function ComparePanel({ panel, index, runtime, versions, preview, canRemove, canAdd = true, actions, renderOverlay, renderHostSurface, overlaysOpen = false, rendererZoomFactor = 1, onHostSurfacePlacement }: ComparePanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const echo = useRef<{ left: number; top: number } | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The panel leaves the comparison once its exit has played; under reduced motion that is at once.
  const presence = usePresence<HTMLElement>(!leaving, { motion: 'fade', initial: false, onExited: actions.removePanel });
  const scale = fitScale(panel.width, panel.viewport);
  const content = runtime?.contentSize ?? null;
  const status = runtime?.status ?? 'loading';
  const label = labelSource(panel.source, runtime?.capture ?? null, runtime?.qualification ?? preview?.qualification ?? null, preview?.label ?? null);
  const uid = useId();
  const titleId = `cmp-panel-${panel.id}-title`;
  const detailsId = `${uid}-details`;
  const versionLabel = runtime?.version?.label ?? 'Unresolved version';
  const stageWidth = panel.viewport.w * scale;
  const stageHeight = panel.viewport.h * scale;

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
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: panel.width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) actions.resize(drag.current.startWidth + event.clientX - drag.current.startX);
  };
  const endDrag = () => { drag.current = null; setDragging(false); };

  const frame = buildFrame(panel, runtime, scale);
  let body: ReactNode;
  if (status === 'ready' && frame !== null && content !== null && runtime !== undefined) {
    body = <div className="cmp-scroller" ref={scroller} onScroll={onScroll} tabIndex={0}
      aria-label={`${ROLE_LABELS[panel.role]} ${versionLabel} content`}
      style={{ width: stageWidth, height: stageHeight }}>
      <div className="cmp-sizer" style={{ width: content.width * scale, height: content.height * scale }}>
        <div className="cmp-source" style={{ width: content.width, height: content.height, transform: `scale(${scale})` }}>
          <Surface panel={panel} runtime={runtime} frame={frame} renderHostSurface={renderHostSurface} label={versionLabel} />
          {renderOverlay !== undefined && <div className="cmp-overlay">{renderOverlay(frame)}</div>}
        </div>
      </div>
    </div>;
  } else {
    body = <PendingStage runtime={runtime} panel={panel} width={stageWidth} height={stageHeight} label={versionLabel} />;
  }

  const choices = versions ?? (runtime?.version != null ? [runtime.version] : []);
  const staticViewports = new Set((runtime?.version?.captures ?? []).map((item) => `${item.viewport.w}x${item.viewport.h}@${item.viewport.dpr}`));
  const fake = panel.source.kind === 'live-preview' && label.evidence === 'live-preview-fake';

  return <section className="cmp-panel" data-preview-status={status} data-panel-id={panel.id} data-role={panel.role}
    data-source-kind={panel.source.kind} data-hq-motion-key={panel.id} data-leaving={leaving || undefined}
    aria-labelledby={titleId} style={{ width: panel.width, flexBasis: panel.width }} ref={presence.ref} {...presence.props}>
    <header className="cmp-panel-header">
      <h2 id={titleId} className="hq-sr-only">{ROLE_LABELS[panel.role]} {versionLabel}</h2>
      <div className="cmp-header-row">
        <span className={`cmp-role cmp-role-${panel.role}`}>{ROLE_LABELS[panel.role]}</span>
        <VersionSelect panel={panel} runtime={runtime} choices={choices} onSelect={(id) => actions.selectVersion(id, panel.source.kind)} />
        <span className="cmp-chip cmp-viewport">{describeViewport(panel.viewport)}</span>
        {fake && <span className="cmp-chip cmp-chip-fake">Fake preview</span>}
        <Button size="sm" variant="ghost" className="cmp-details-toggle" aria-expanded={detailsOpen}
          aria-controls={detailsOpen ? detailsId : undefined} onClick={() => setDetailsOpen((open) => !open)}>
          Details <Chevron open={detailsOpen} />
        </Button>
      </div>
      <Presence show={detailsOpen} motion="collapse" initial={false} id={detailsId} className="cmp-details">
        <div className="cmp-details-body">
          <div className={`cmp-source-badge cmp-source-${panel.source.kind}`} data-evidence={label.evidence}>
            <strong>{label.badge}</strong><span>{label.detail}</span>
          </div>
          <ul className="cmp-caveats">{label.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          <div className="cmp-controls">
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
          <p className="cmp-version-id-row">Version id <code className="cmp-version-id">{panel.source.versionId}</code></p>
          <div className="cmp-panel-actions">
            <ActionButton size="sm" reason={canAdd ? null : 'A comparison holds up to 12 panels.'} onAction={actions.addPanel}>Duplicate</ActionButton>
            <ActionButton size="sm" reason={canRemove ? null : 'A comparison keeps at least one panel.'} onAction={() => setLeaving(true)}>Remove</ActionButton>
          </div>
        </div>
      </Presence>
    </header>
    <div className="cmp-stage" style={{ paddingInline: PANEL_INSET }}>{body}</div>
    <div className={chain('cmp-resize', dragging && 'is-dragging')} role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={`Resize panel ${index + 1}`} aria-valuenow={panel.width} aria-valuemin={MIN_PANEL_WIDTH} aria-valuemax={MAX_PANEL_WIDTH}
      onKeyDown={onHandleKey} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
  </section>;
}
