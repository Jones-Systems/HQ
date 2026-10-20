import { useMemo, useSyncExternalStore } from 'react';
import type { CompareController, ControllerError } from '../controller.ts';
import { parseVersionId } from '../ids.ts';
import { baselineOf, type Panel } from '../model.ts';
import { ComparePanel, type PanelActions, type PanelSlots } from './ComparePanel.tsx';

export interface CompareWorkspaceProps extends PanelSlots {
  readonly controller: CompareController;
  readonly title?: string;
}

const ERROR_TEXT: Readonly<Record<ControllerError, string>> = {
  'unknown-panel': 'That panel no longer exists.',
  'duplicate-panel': 'A panel with that identity already exists.',
  'too-many-panels': 'The comparison already has the maximum number of panels.',
  'last-panel': 'A comparison keeps at least one panel.',
  'static-viewport-fixed': 'A static capture keeps the viewport it was captured at. Choose a capture at another viewport or switch to live preview.',
  'no-capture': 'That version has no static capture. Switch to live preview to view it.',
  'no-capture-at-viewport': 'This version has no capture at that viewport.',
  'capture-version-mismatch': 'The capture does not belong to the chosen version, so it is not shown.',
  'unknown-preset': 'Unknown viewport preset.',
  'unknown-version': 'That exact version is not available.',
  'save-failed': 'The layout could not be saved. Your changes are still here.',
  'disposed': 'This comparison is closed.',
};

function useActions(controller: CompareController, panel: Panel): PanelActions {
  return useMemo(() => ({
    resize: (width) => controller.resize(panel.id, width),
    scroll: (position) => controller.scroll(panel.id, position),
    setRole: (role) => controller.setRole(panel.id, role),
    applyPreset: (presetId) => controller.applyPreset(panel.id, presetId),
    selectVersion: (raw, mode) => {
      const id = parseVersionId(raw);
      if (id !== null) void controller.selectVersion(panel.id, id, mode);
    },
    addPanel: () => controller.addPanel(panel.id),
    removePanel: () => controller.removePanel(panel.id),
  }), [controller, panel.id]);
}

function PanelSlot(props: Omit<Parameters<typeof ComparePanel>[0], 'actions'> & { readonly controller: CompareController }) {
  const { controller, ...rest } = props;
  return <ComparePanel {...rest} actions={useActions(controller, rest.panel)} />;
}

/** Side-by-side comparison of N pinned versions. All effects go through the injected controller. */
export function CompareWorkspace({ controller, title = 'Compare', renderOverlay, renderHostSurface, overlaysOpen, rendererZoomFactor, onHostSurfacePlacement }: CompareWorkspaceProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { comparison } = snapshot;
  const baseline = baselineOf(comparison);
  const leader = baseline?.id ?? comparison.panels[0]?.id ?? null;
  return <div className="cmp-workspace">
    <div className="cmp-toolbar" role="toolbar" aria-label="Comparison">
      <h1 className="cmp-heading">{title}</h1>
      <button type="button" aria-pressed={comparison.syncScroll}
        onClick={() => controller.setSyncScroll(!comparison.syncScroll, leader)}>
        Synced scroll: {comparison.syncScroll ? 'On' : 'Off'}
      </button>
      <button type="button" disabled={leader === null} onClick={() => { if (leader !== null) controller.matchViewports(leader); }}>
        Match viewports to {baseline === null ? 'first panel' : 'baseline'}
      </button>
      <button type="button" onClick={() => { void controller.save(); }}>Save layout</button>
      <span className="cmp-save-state" role="status">{snapshot.dirty ? 'Unsaved layout changes' : 'Layout saved'}</span>
      {snapshot.preview?.qualification === 'labelled-fake' && <span className="cmp-fake-flag">Labelled fake previews</span>}
    </div>
    {snapshot.lastError !== null && <p className="cmp-error" role="alert">{ERROR_TEXT[snapshot.lastError]}</p>}
    <div className="cmp-strip">
      {comparison.panels.map((panel, index) => <PanelSlot key={panel.id} controller={controller} panel={panel} index={index}
        runtime={snapshot.runtime.get(panel.id)}
        versions={snapshot.runtime.get(panel.id)?.version == null ? undefined : snapshot.versions.get(snapshot.runtime.get(panel.id)!.version!.viewId)}
        preview={snapshot.preview} canRemove={comparison.panels.length > 1}
        renderOverlay={renderOverlay} renderHostSurface={renderHostSurface}
        overlaysOpen={overlaysOpen} rendererZoomFactor={rendererZoomFactor} onHostSurfacePlacement={onHostSurfacePlacement} />)}
    </div>
  </div>;
}
