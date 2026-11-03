import { SecondaryBar, SecondaryPanel } from '../../../ui/src/secondary-panels.tsx';
import { useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { StatusIndicator, useToast } from '@hq/ui';
import type { CanvasId, CanvasStoragePort, IdPort, ProjectId } from '../contract.ts';
import { serializeSession, visibleArrangement, type CanvasSession } from '../controller.ts';
import { inspect } from '../inspector.ts';
import type { ProviderRegistry } from '../providers.ts';
import { CanvasView, detectPlatform, faceBody, type CanvasItemRenderer } from './CanvasView.tsx';
import { Inspector } from './Inspector.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useCanvasDocument, type SaveStatus } from './useCanvasDocument.ts';

export interface CanvasWorkspaceProps {
  readonly projectId: ProjectId;
  readonly canvasId: CanvasId;
  readonly storage: CanvasStoragePort;
  readonly registry: ProviderRegistry;
  readonly ids: IdPort;
  readonly renderers?: Readonly<Record<string, CanvasItemRenderer>>;
  /** Problems with where items come from. Shown above the canvas, which keeps drawing what loaded. */
  readonly banner?: ReactNode;
  /** Restored camera/selection after a domain switch (keep-alive). */
  readonly session?: CanvasSession;
  readonly onSessionChange?: (session: CanvasSession) => void;
}

/** Re-render when providers register, unregister or report changes. */
function useRegistryVersion(registry: ProviderRegistry): number {
  const [version, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => registry.subscribe(bump), [registry]);
  return version;
}

const SAVE_TOAST = 'design-canvas-save';

/** The save state in words and a shape: Saving, Saved, or what stopped it. Offers Retry only where repeating is safe. */
function SaveState({ status, retry }: { status: SaveStatus; retry: () => void }) {
  switch (status.kind) {
    case 'loading': return <StatusIndicator tone="neutral" busy label="Opening" />;
    case 'pending': return <StatusIndicator tone="neutral" busy label="Saving" />;
    case 'saved': return <StatusIndicator tone="success" label="Saved" />;
    case 'read-only': return <StatusIndicator tone="warning" label="Read-only" detail={status.message} />;
    case 'conflict': return <StatusIndicator tone="danger" label="Couldn't save" detail="changed elsewhere" />;
    case 'error': return <StatusIndicator tone="danger" label={status.stage === 'load' ? "Couldn't open" : "Couldn't save"}
      detail={status.stage === 'load' ? 'showing an empty canvas' : 'kept in this session'} action={{ label: 'Retry', onAction: retry }} />;
  }
}

/**
 * Canvas workspace: toolbar, surface, inspector and save status. Root mounts
 * this with injected storage, providers and ids; it imports no other section.
 */
export function CanvasWorkspace({ projectId, canvasId, storage, registry, ids, renderers, banner, session, onSessionChange }: CanvasWorkspaceProps) {
  const { state, dispatch, status, retry } = useCanvasDocument(storage, canvasId, projectId, session);
  const registryVersion = useRegistryVersion(registry);
  const platform = useMemo(detectPlatform, []);
  const toast = useToast();
  const arrangement = visibleArrangement(state);
  const model = useMemo(() => inspect(arrangement, state.selection, registry), [arrangement, state.selection, registry, registryVersion]);

  useEffect(() => {
    if (status.kind !== 'loading') onSessionChange?.(serializeSession(state));
  }, [state.camera, state.selection, state.focusId, status.kind]);

  // A failed write is a one-off event as well as a state: say what was kept, and clear the toast once it saves.
  const failed = useRef(false);
  useEffect(() => {
    if (status.kind === 'conflict') {
      failed.current = true;
      toast.error("Couldn't save the canvas", { id: SAVE_TOAST, description: 'It changed somewhere else. Your changes are kept in this session but were not saved.' });
    } else if (status.kind === 'error') {
      failed.current = true;
      toast.error(status.stage === 'load' ? "Couldn't open the saved layout" : "Couldn't save the canvas", {
        id: SAVE_TOAST, action: { label: 'Retry', onAction: retry },
        description: status.stage === 'load' ? 'Showing an empty canvas. The saved layout was not changed.' : 'Your layout is kept in this session and saving will be tried again.',
      });
    } else if (failed.current && status.kind === 'saved') {
      failed.current = false;
      toast.dismiss(SAVE_TOAST);
    }
  }, [status.kind, toast, retry]);

  // The selected item's capture, drawn small by the same renderer as its frame.
  const preview = useMemo(() => {
    if (model.kind !== 'item') return null;
    const placement = arrangement.items.find((item) => item.id === model.id);
    const description = placement ? registry.describe(placement.ref) : null;
    const renderer = placement ? renderers?.[placement.ref.providerId] : undefined;
    return placement && description?.status === 'ready' && renderer ? faceBody(renderer(description.descriptor, placement)) : null;
  }, [model, arrangement, registry, renderers, registryVersion]);

  return <div className="hq-canvas-workspace">
    <SecondaryBar name="canvas-tools" label="Canvas tools"><Toolbar state={state} dispatch={dispatch} registry={registry} projectId={projectId} ids={ids} platform={platform} /></SecondaryBar>
    {banner && <div className="hq-canvas-banner">{banner}</div>}
    <div className="hq-canvas-body">
      <CanvasView state={state} dispatch={dispatch} registry={registry} platform={platform} renderers={renderers} settled={status.kind !== 'loading'} />
      <SecondaryPanel name="canvas-inspector" label="Canvas inspector" initial={280}><Inspector model={model} selection={state.selection} gridSize={arrangement.grid.size} gridSnap={arrangement.grid.snap}
        readOnly={state.readOnly} hiddenIds={arrangement.items.filter((item) => item.hidden).map((item) => item.id)} preview={preview} dispatch={dispatch} /></SecondaryPanel>
    </div>
    <div className="hq-canvas-status" data-status={status.kind}><SaveState status={status} retry={retry} /></div>
  </div>;
}
