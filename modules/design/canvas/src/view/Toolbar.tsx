import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { Presence } from '@hq/ui';
import {
  artboardId, canvasItemId, type CanvasItemDescriptor, type IdPort, type Point, type ProjectId, type Rect, type Size,
} from '../contract.ts';
import { ARTBOARD_PRESETS, allBounds } from '../arrangement.ts';
import { redoAvailable, undoAvailable, visibleArrangement, type CanvasAction, type CanvasState } from '../controller.ts';
import { MAX_ZOOM, MIN_ZOOM, screenToWorld } from '../geometry.ts';
import { ZOOM_STEP, type Platform } from '../input.ts';
import type { ProviderRegistry } from '../providers.ts';
import { AddArtboardIcon, AddItemIcon, FitAllIcon, FitSelectionIcon, RedoIcon, UndoIcon, ZoomInIcon, ZoomOutIcon } from './icons.tsx';
import { ToolButton } from './ToolButton.tsx';

/** A newly added item is scaled down to fit this box, keeping its shape, so a full-page capture does not fill the view. */
export const NEW_ITEM_BOX: Size = { width: 480, height: 360 };

/** Frame for a new item: its own size, or smaller to fit `NEW_ITEM_BOX`, centred on `center` and on whole units. */
export function placementFrame(size: Size, center: Point): Rect {
  const scale = Math.min(1, NEW_ITEM_BOX.width / Math.max(size.width, 1), NEW_ITEM_BOX.height / Math.max(size.height, 1));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2), width, height };
}

const READ_ONLY = 'This canvas is read-only';

/** Why an edit-style action cannot run, or `null` when it can. */
function editReason(state: CanvasState, available: boolean, nothing: string): string | null {
  if (state.readOnly) return READ_ONLY;
  if (state.gesture) return 'Finish the current move first';
  return available ? null : nothing;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="hq-canvas-tool-group" role="group" aria-label={label}>{children}</div>;
}

/**
 * A toolbar button that opens a small panel under it. Escape closes the panel and returns focus to the button; a
 * press outside closes it; focus moves to the first choice when it opens.
 */
function ToolPopover({ label, icon, unavailable, children }: {
  label: string; icon: ReactNode; unavailable: string | null; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) root.current?.querySelector<HTMLElement>('.hq-canvas-tool-button')?.focus();
  };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.hq-canvas-popover button')?.focus();
    const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  return <div className="hq-canvas-popover-anchor" ref={root}>
    <ToolButton label={label} icon={icon} unavailable={unavailable} expanded={open} haspopup="dialog" onClick={() => setOpen((current) => !current)} />
    <Presence show={open} motion="drop" className="hq-canvas-popover" role="dialog" aria-label={label}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } }}>
      {children(() => close(false))}
    </Presence>
  </div>;
}

export interface ToolbarProps {
  readonly state: CanvasState;
  readonly dispatch: Dispatch<CanvasAction>;
  readonly registry: ProviderRegistry;
  readonly projectId: ProjectId;
  readonly ids: IdPort;
  readonly platform: Platform;
}

/** Canvas tools: history, insert and view. Every button is an icon with an accessible name and a tooltip. */
export function Toolbar({ state, dispatch, registry, projectId, ids, platform }: ToolbarProps) {
  const mod = platform === 'mac' ? '⌘' : 'Ctrl+';
  const arrangement = visibleArrangement(state);
  const viewCentre = { x: state.viewport.width / 2, y: state.viewport.height / 2 };
  const centre = screenToWorld(state.camera, viewCentre);
  const zoomPercent = Math.round(state.camera.zoom * 100);
  const hasSelection = state.selection.length > 0;

  const place = (descriptor: CanvasItemDescriptor) => {
    const id = canvasItemId(ids.next('item'));
    dispatch({ type: 'edit', edit: { kind: 'add-placement', id, ref: descriptor.ref, frame: placementFrame(descriptor.intrinsicSize, centre) } });
    dispatch({ type: 'select', ids: [id] });
  };
  const placeArtboard = (name: string, size: Size) => {
    const id = artboardId(ids.next('artboard'));
    const frame = { x: Math.round(centre.x - size.width / 2), y: Math.round(centre.y - size.height / 2), width: size.width, height: size.height };
    dispatch({ type: 'edit', edit: { kind: 'add-artboard', id, name, frame } });
    dispatch({ type: 'select', ids: [id] });
  };

  return <div className="hq-canvas-toolbar" role="toolbar" aria-label="Canvas tools">
    <Group label="History">
      <ToolButton label="Undo" shortcut={`${mod}Z`} icon={<UndoIcon />} unavailable={editReason(state, undoAvailable(state), 'Nothing to undo')}
        onClick={() => dispatch({ type: 'undo' })} />
      <ToolButton label="Redo" shortcut={platform === 'mac' ? '⇧⌘Z' : 'Ctrl+Shift+Z'} icon={<RedoIcon />}
        unavailable={editReason(state, redoAvailable(state), 'Nothing to redo')} onClick={() => dispatch({ type: 'redo' })} />
    </Group>
    <Group label="Insert">
      <ToolPopover label="Add item" icon={<AddItemIcon />} unavailable={state.readOnly ? READ_ONLY : null}>
        {(close) => <AddItemPanel registry={registry} projectId={projectId} onPick={(descriptor) => { place(descriptor); close(); }} />}
      </ToolPopover>
      <ToolPopover label="Add artboard" icon={<AddArtboardIcon />} unavailable={state.readOnly ? READ_ONLY : null}>
        {(close) => <ul className="hq-canvas-choices">{ARTBOARD_PRESETS.map((preset) => <li key={preset.name}>
          <button type="button" onClick={() => { placeArtboard(preset.name, preset.size); close(); }}>
            <span>{preset.name}</span><small>{preset.size.width}×{preset.size.height}</small>
          </button>
        </li>)}</ul>}
      </ToolPopover>
    </Group>
    <Group label="View">
      <ToolButton label="Zoom out" shortcut="−" icon={<ZoomOutIcon />} unavailable={state.camera.zoom <= MIN_ZOOM ? 'Already at the smallest zoom' : null}
        onClick={() => dispatch({ type: 'zoom-at', anchor: viewCentre, factor: 1 / ZOOM_STEP, ease: true })} />
      <ToolButton label={`Zoom ${zoomPercent}%, reset to 100%`} shortcut="Shift+0" text={`${zoomPercent}%`}
        unavailable={state.camera.zoom === 1 ? 'Already at 100%' : null} onClick={() => dispatch({ type: 'zoom-to', zoom: 1, ease: true })} />
      <ToolButton label="Zoom in" shortcut="+" icon={<ZoomInIcon />} unavailable={state.camera.zoom >= MAX_ZOOM ? 'Already at the largest zoom' : null}
        onClick={() => dispatch({ type: 'zoom-at', anchor: viewCentre, factor: ZOOM_STEP, ease: true })} />
      <ToolButton label="Fit all" shortcut="Shift+1" icon={<FitAllIcon />} unavailable={allBounds(arrangement) ? null : 'Nothing on the canvas yet'}
        onClick={() => dispatch({ type: 'fit', target: 'all', ease: true })} />
      <ToolButton label="Fit selection" shortcut="Shift+2" icon={<FitSelectionIcon />} align="end" unavailable={hasSelection ? null : 'Select an item first'}
        onClick={() => dispatch({ type: 'fit', target: 'selection', ease: true })} />
    </Group>
  </div>;
}

function AddItemPanel({ registry, projectId, onPick }: { registry: ProviderRegistry; projectId: ProjectId; onPick: (descriptor: CanvasItemDescriptor) => void }) {
  const catalog = registry.catalog(projectId).filter((entry) => entry.items.length > 0);
  if (catalog.length === 0) return <p className="hq-canvas-choices-empty">Nothing to add yet. Capture a version in Projects, then come back.</p>;
  return <div className="hq-canvas-choices">
    {catalog.map(({ provider, items }) => <section key={provider.id} aria-label={provider.label}>
      <h3>{provider.label}</h3>
      <ul>{items.map((item) => <li key={`${item.ref.entityId}@${item.ref.revision}`}>
        <button type="button" onClick={() => onPick(item)}>
          <span>{item.title}</span><small>{item.intrinsicSize.width}×{item.intrinsicSize.height}</small>
        </button>
      </li>)}</ul>
    </section>)}
  </div>;
}
