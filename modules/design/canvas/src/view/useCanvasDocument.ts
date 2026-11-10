import { useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import type { CanvasId, CanvasStoragePort, ProjectId } from '../contract.ts';
import { emptyArrangement } from '../arrangement.ts';
import { decodeArrangement, loadArrangement, saveArrangement } from '../codec.ts';
import { createCanvasState, reduceCanvas, type CanvasAction, type CanvasSession, type CanvasState } from '../controller.ts';

export type SaveStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'read-only'; readonly message: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'error'; readonly message: string };

export interface CanvasDocument {
  readonly state: CanvasState;
  readonly dispatch: Dispatch<CanvasAction>;
  readonly status: SaveStatus;
}

export const AUTOSAVE_DELAY_MS = 400;

/**
 * Load one canvas arrangement, keep it in the pure reducer, and autosave the
 * committed record. Only the arrangement document is written; a stored record
 * that cannot be edited safely is opened read-only and never overwritten.
 */
export function useCanvasDocument(storage: CanvasStoragePort, canvas: CanvasId, project: ProjectId, session?: CanvasSession): CanvasDocument {
  const [state, dispatch] = useReducer(reduceCanvas, undefined, () => createCanvasState(emptyArrangement(canvas, project), { readOnly: true }));
  const [status, setStatus] = useState<SaveStatus>({ kind: 'loading' });
  const base = useRef<{ text: string | null; arrangement: unknown } | null>(null);
  const initialSession = useRef(session);

  useEffect(() => {
    let current = true;
    base.current = null;
    setStatus({ kind: 'loading' });
    loadArrangement(storage, canvas).then((result) => {
      if (!current) return;
      if (result.status === 'read-only') {
        const decoded = decodeArrangement(result.text);
        const shown = decoded.ok ? decoded.arrangement : emptyArrangement(canvas, project);
        dispatch({ type: 'load', arrangement: shown, readOnly: true });
        setStatus({ kind: 'read-only', message: result.message });
        return;
      }
      const arrangement = result.status === 'loaded' ? result.arrangement : emptyArrangement(canvas, project);
      base.current = { text: result.status === 'loaded' ? result.baseText : null, arrangement };
      dispatch({ type: 'load', arrangement });
      if (initialSession.current) dispatch({ type: 'restore-session', session: initialSession.current });
      setStatus({ kind: 'saved' });
    }, (error: unknown) => {
      if (current) setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load the canvas' });
    });
    return () => { current = false; };
  }, [storage, canvas, project]);

  const committed = state.history.present;
  const saving = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!base.current || state.readOnly) return;
    if (base.current.arrangement !== committed) setStatus({ kind: 'pending' });
    let current = true;
    const timer = setTimeout(() => {
      // Saves run one at a time so each compares against what the previous save wrote,
      // including an undo back to an earlier record while a save was in flight.
      saving.current = saving.current.then(async () => {
        const known = base.current;
        if (!known) return;
        if (known.arrangement === committed) { if (current) setStatus({ kind: 'saved' }); return; }
        const result = await saveArrangement(storage, committed, known.text);
        if (result.status === 'conflict') { if (current) setStatus({ kind: 'conflict' }); return; }
        base.current = { text: result.baseText, arrangement: committed };
        if (current) setStatus({ kind: 'saved' });
      }).catch((error: unknown) => {
        if (current) setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not save the canvas' });
      });
    }, AUTOSAVE_DELAY_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [storage, committed, state.readOnly]);

  return { state, dispatch, status };
}
