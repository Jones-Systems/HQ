import { useEffect, useMemo, useReducer, useState, type Dispatch } from 'react';
import {
  artboardId, canvasItemId, type CanvasId, type CanvasItemDescriptor, type CanvasStoragePort, type IdPort, type ProjectId, type Size,
} from '../contract.ts';
import { ARTBOARD_PRESETS } from '../arrangement.ts';
import {
  redoAvailable, serializeSession, undoAvailable, visibleArrangement, type CanvasAction, type CanvasSession, type CanvasState,
} from '../controller.ts';
import { screenToWorld } from '../geometry.ts';
import { inspect } from '../inspector.ts';
import type { ProviderRegistry } from '../providers.ts';
import { CanvasView, detectPlatform, type CanvasItemRenderer } from './CanvasView.tsx';
import { Inspector } from './Inspector.tsx';
import { useCanvasDocument, type SaveStatus } from './useCanvasDocument.ts';

export interface CanvasWorkspaceProps {
  readonly projectId: ProjectId;
  readonly canvasId: CanvasId;
  readonly storage: CanvasStoragePort;
  readonly registry: ProviderRegistry;
  readonly ids: IdPort;
  readonly renderers?: Readonly<Record<string, CanvasItemRenderer>>;
  /** Restored camera/selection after a domain switch (keep-alive). */
  readonly session?: CanvasSession;
  readonly onSessionChange?: (session: CanvasSession) => void;
}

const STATUS_TEXT: Record<SaveStatus['kind'], string> = {
  loading: 'Loading…', saved: 'Saved', pending: 'Saving…', 'read-only': 'Read-only', conflict: 'Not saved: changed elsewhere', error: 'Not saved',
};

/** Re-render when providers register, unregister or report changes. */
function useRegistryVersion(registry: ProviderRegistry): number {
  const [version, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => registry.subscribe(bump), [registry]);
  return version;
}

function Toolbar({ state, dispatch, registry, projectId, ids }: {
  state: CanvasState; dispatch: Dispatch<CanvasAction>; registry: ProviderRegistry; projectId: ProjectId; ids: IdPort;
}) {
  const [adding, setAdding] = useState(false);
  const center = screenToWorld(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 });
  const place = (descriptor: CanvasItemDescriptor) => {
    const size = descriptor.intrinsicSize;
    dispatch({ type: 'edit', edit: {
      kind: 'add-placement', id: canvasItemId(ids.next('item')), ref: descriptor.ref,
      frame: { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2), width: size.width, height: size.height },
    } });
    setAdding(false);
  };
  const addArtboard = (name: string, size: Size) => dispatch({ type: 'edit', edit: {
    kind: 'add-artboard', id: artboardId(ids.next('artboard')), name,
    frame: { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2), width: size.width, height: size.height },
  } });
  const catalog = adding ? registry.catalog(projectId) : [];
  return <div className="hq-canvas-toolbar" role="toolbar" aria-label="Canvas tools">
    <button type="button" disabled={!undoAvailable(state)} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
    <button type="button" disabled={!redoAvailable(state)} onClick={() => dispatch({ type: 'redo' })}>Redo</button>
    <span className="hq-canvas-toolbar-gap" />
    <button type="button" disabled={state.readOnly} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>Add item</button>
    <select aria-label="Add artboard" disabled={state.readOnly} value="" onChange={(event) => {
      const preset = ARTBOARD_PRESETS.find((candidate) => candidate.name === event.target.value);
      if (preset) addArtboard(preset.name, preset.size);
    }}>
      <option value="">Add artboard…</option>
      {ARTBOARD_PRESETS.map((preset) => <option key={preset.name} value={preset.name}>{preset.name} {preset.size.width}×{preset.size.height}</option>)}
    </select>
    <span className="hq-canvas-toolbar-gap" />
    <button type="button" aria-label="Zoom out" onClick={() => dispatch({ type: 'zoom-at', anchor: { x: state.viewport.width / 2, y: state.viewport.height / 2 }, factor: 1 / 1.25 })}>−</button>
    <button type="button" aria-label="Reset zoom to 100%" onClick={() => dispatch({ type: 'zoom-to', zoom: 1 })}>{Math.round(state.camera.zoom * 100)}%</button>
    <button type="button" aria-label="Zoom in" onClick={() => dispatch({ type: 'zoom-at', anchor: { x: state.viewport.width / 2, y: state.viewport.height / 2 }, factor: 1.25 })}>+</button>
    <button type="button" onClick={() => dispatch({ type: 'fit', target: 'all' })}>Fit all</button>
    <button type="button" disabled={state.selection.length === 0} onClick={() => dispatch({ type: 'fit', target: 'selection' })}>Fit selection</button>
    {adding && <div className="hq-canvas-picker" role="dialog" aria-label="Add item">
      {catalog.length === 0 && <p>No providers offer items for this project.</p>}
      {catalog.map(({ provider, items }) => <section key={provider.id}>
        <h3>{provider.label}</h3>
        {items.length === 0 ? <p>No items.</p> : <ul>{items.map((item) => <li key={`${item.ref.entityId}@${item.ref.revision}`}>
          <button type="button" onClick={() => place(item)}>{item.title} <small>{item.ref.revision}</small></button>
        </li>)}</ul>}
      </section>)}
    </div>}
  </div>;
}

/**
 * Canvas workspace: toolbar, surface, inspector and save status. Root mounts
 * this with injected storage, providers and ids; it imports no other section.
 */
export function CanvasWorkspace({ projectId, canvasId, storage, registry, ids, renderers, session, onSessionChange }: CanvasWorkspaceProps) {
  const { state, dispatch, status } = useCanvasDocument(storage, canvasId, projectId, session);
  const registryVersion = useRegistryVersion(registry);
  const platform = useMemo(detectPlatform, []);
  const arrangement = visibleArrangement(state);
  const model = useMemo(() => inspect(arrangement, state.selection, registry), [arrangement, state.selection, registry, registryVersion]);

  useEffect(() => {
    if (status.kind !== 'loading') onSessionChange?.(serializeSession(state));
  }, [state.camera, state.selection, state.focusId, status.kind]);

  return <div className="hq-canvas-workspace">
    <Toolbar state={state} dispatch={dispatch} registry={registry} projectId={projectId} ids={ids} />
    <div className="hq-canvas-body">
      <CanvasView state={state} dispatch={dispatch} registry={registry} platform={platform} renderers={renderers} />
      <Inspector model={model} selection={state.selection} gridSize={arrangement.grid.size} gridSnap={arrangement.grid.snap}
        readOnly={state.readOnly} hiddenIds={arrangement.items.filter((item) => item.hidden).map((item) => item.id)} dispatch={dispatch} />
    </div>
    <p className="hq-canvas-status" role="status" data-status={status.kind}>
      {STATUS_TEXT[status.kind]}{status.kind === 'read-only' || status.kind === 'error' ? ` — ${status.message}` : ''}
    </p>
  </div>;
}
