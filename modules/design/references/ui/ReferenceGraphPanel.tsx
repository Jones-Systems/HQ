import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { CaptureId, SubjectId } from '../src/graph-contract.ts';
import type { ReferenceGraph } from '../src/graph-service.ts';
import { ReferenceGraphView } from './ReferenceGraphView.tsx';
import type { GraphSelection } from './graph-view-model.ts';
import { buildGraphView } from './graph-view-model.ts';
import type { ProjectRef } from './view-model.ts';

export interface ReferenceGraphPanelProps {
  /** Opened by root with qualified (or explicitly labelled fake) ports. */
  readonly graph: ReferenceGraph;
  readonly currentProject: ProjectRef | null;
  /** Optional sink for failed mutations; defaults to ignoring them. */
  readonly onError?: (code: string) => void;
  readonly hideWhenEmpty?: boolean;
}

/** Connects the graph service to the view. Selection is view-local state. */
export function ReferenceGraphPanel({ graph, currentProject, onError, hideWhenEmpty }: ReferenceGraphPanelProps) {
  const subscribe = useCallback((listener: () => void) => graph.subscribe(listener), [graph]);
  const readState = () => graph.state;
  const readAccess = () => graph.access;
  const state = useSyncExternalStore(subscribe, readState, readState);
  const access = useSyncExternalStore(subscribe, readAccess, readAccess);
  const [selection, setSelection] = useState<GraphSelection>({ subjectId: null, captureId: null });
  const view = useMemo(() => buildGraphView(state, access, selection, currentProject), [state, access, selection, currentProject]);
  if (hideWhenEmpty && view.rows.length === 0 && view.banner === null) return null;
  return <ReferenceGraphView view={view}
    onSelectSubject={(subjectId: SubjectId | null) => setSelection({ subjectId, captureId: null })}
    onSelectCapture={(captureId: CaptureId) => setSelection((current) => ({ ...current, captureId }))}
    onPinCapture={(id) => {
      if (currentProject === null) return;
      void graph.pin(id, currentProject.id).then((outcome) => { if (!outcome.ok) onError?.(outcome.code); });
    }}
    onReload={() => { void graph.reload(); }} />;
}
