import { animateElement, InlineNotice } from '@hq/ui';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref, type RefObject } from 'react';
import type { VersionSummary } from '../contract.ts';
import type { PanelRuntime } from '../controller.ts';
import { clampWidth, fitScale, PANEL_INSET } from '../geometry.ts';
import { ROLE_LABELS } from '../labels.ts';
import { describeViewport } from '../presets.ts';
import type { PanelActions } from './ComparePanel.tsx';
import { buildFrame, chain, PendingStage, Surface, VersionSelect } from './parts.tsx';
import {
  clampSwipe, describeMismatch, NO_MATCH_REASON, SWIPE_DEFAULT, SWIPE_MAX, SWIPE_MIN, swipeClip, swipeKeyValue, swipeValueAt, swipeValueText,
  viewportsDiffer, type SwipePair, type ViewportMatchPlan,
} from './swipe.ts';

export interface SwipeDividerProps {
  /** Share of the width, from the left, that still shows the baseline: 0–100. */
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** The element whose box the divider travels across; pointer positions are measured against it. */
  readonly trackRef: RefObject<HTMLElement | null>;
  /** Double-click or double-tap: the stage owns the eased move back to the middle. */
  readonly onRecentre: () => void;
  readonly describedBy?: string;
  readonly dividerRef?: Ref<HTMLDivElement>;
}

/**
 * The swipe divider as a slider. Arrow keys move it 1% (Shift 10%), Home and End go to the ends, and a pointer or a
 * finger drags it with pointer capture. It sits in a zero-height sticky rail so it stays in view while the capture scrolls.
 */
export function SwipeDivider({ value, onChange, trackRef, onRecentre, describedBy, dividerRef }: SwipeDividerProps) {
  const [dragging, setDragging] = useState(false);
  const active = useRef(false);

  const move = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (box !== undefined) onChange(swipeValueAt(clientX, box));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = swipeKeyValue(value, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(next);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    active.current = true;
    setDragging(true);
    move(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (active.current) move(event.clientX); };
  const end = () => { active.current = false; setDragging(false); };

  return <div className="cmp-swipe-rail">
    <div ref={dividerRef} className={chain('cmp-swipe-divider', dragging && 'is-dragging')} role="slider" tabIndex={0}
      aria-orientation="horizontal" aria-label="Swipe divider between baseline and candidate" aria-describedby={describedBy}
      aria-valuemin={SWIPE_MIN} aria-valuemax={SWIPE_MAX} aria-valuenow={Math.round(clampSwipe(value))} aria-valuetext={swipeValueText(value)}
      style={{ left: `${clampSwipe(value)}%` }}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onLostPointerCapture={end} onDoubleClick={onRecentre}>
      <span className="cmp-swipe-knob" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 4-4 4 4 4M10 4l4 4-4 4" />
        </svg>
      </span>
    </div>
  </div>;
}

export interface SwipeStageProps {
  readonly pair: SwipePair;
  readonly baselineRuntime: PanelRuntime | undefined;
  readonly candidateRuntime: PanelRuntime | undefined;
  readonly baselineChoices: readonly VersionSummary[];
  readonly candidateChoices: readonly VersionSummary[];
  readonly baselineActions: PanelActions;
  readonly candidateActions: PanelActions;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** How to bring the two viewports together, or null when neither panel can take the other's. */
  readonly matchPlan: ViewportMatchPlan | null;
  readonly onMatch: () => void;
  /** Width the stage may use, from the workspace; the stage never exceeds the panels' own widths otherwise. */
  readonly availableWidth: number | null;
}

/**
 * The candidate stacked over the baseline at one scale, revealed by clipping its layer to the right of the divider. Both
 * layers keep their own pixels: nothing is blended, faded or filtered. Corner labels sit above the frame, never on it.
 */
export function SwipeStage({
  pair, baselineRuntime, candidateRuntime, baselineChoices, candidateChoices, baselineActions, candidateActions,
  value, onChange, matchPlan, onMatch, availableWidth,
}: SwipeStageProps) {
  const { baseline, candidate } = pair;
  const trackRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const differ = viewportsDiffer(pair);
  const viewport = baseline.viewport;
  const panelsWidth = Math.max(baseline.width, candidate.width);
  const wanted = availableWidth === null ? 0 : Math.min(availableWidth, viewport.w + PANEL_INSET * 2);
  const scale = fitScale(clampWidth(Math.max(panelsWidth, wanted)), viewport);
  const frameWidth = viewport.w * scale;
  const frameHeight = viewport.h * scale;
  const baselineLabel = baselineRuntime?.version?.label ?? 'Unresolved version';
  const candidateLabel = candidateRuntime?.version?.label ?? 'Unresolved version';

  const recentre = () => {
    const from = clampSwipe(value);
    onChange(SWIPE_DEFAULT);
    if (dividerRef.current !== null) animateElement(dividerRef.current, [{ left: `${from}%` }, { left: `${SWIPE_DEFAULT}%` }], { duration: 'slow', easing: 'standard' });
    if (layerRef.current !== null) animateElement(layerRef.current, [{ clipPath: swipeClip(from) }, { clipPath: swipeClip(SWIPE_DEFAULT) }], { duration: 'slow', easing: 'standard' });
  };

  const baselineReady = baselineRuntime?.status === 'ready' && baselineRuntime.contentSize !== null;
  const candidateReady = candidateRuntime?.status === 'ready' && candidateRuntime.contentSize !== null;
  const baselineFrame = baselineReady ? buildFrame(baseline, baselineRuntime, scale) : null;
  const candidateFrame = candidateReady ? buildFrame(candidate, candidateRuntime, scale) : null;

  let body;
  let swiping = false;
  if (differ) {
    body = <InlineNotice tone="warning" className="cmp-swipe-notice" title="These two use different viewports"
      live="off" actions={matchPlan === null ? [] : [{ label: 'Match viewports', onAction: onMatch }]}>
      {describeMismatch(pair)}{matchPlan === null ? ` ${NO_MATCH_REASON}` : ''}
    </InlineNotice>;
  } else if (baselineFrame !== null && candidateFrame !== null && baselineRuntime !== undefined && candidateRuntime !== undefined) {
    const maxWidth = Math.max(baselineFrame.contentSize.width, candidateFrame.contentSize.width);
    const maxHeight = Math.max(baselineFrame.contentSize.height, candidateFrame.contentSize.height);
    swiping = true;
    // The frame is the viewport's height, capped to what fits the window (in CSS), so the divider stays in reach and the capture scrolls inside.
    body = <div className="cmp-swipe-frame" style={{ width: frameWidth, '--cmp-frame-h': `${frameHeight}px` } as CSSProperties}>
      <div className="cmp-scroller" tabIndex={0} aria-label={`${baselineLabel} and ${candidateLabel} content`}
        style={{ width: frameWidth }}>
        <div className="cmp-sizer" ref={trackRef} style={{ width: maxWidth * scale, height: maxHeight * scale }}>
          <SwipeDivider value={value} onChange={onChange} trackRef={trackRef} onRecentre={recentre}
            describedBy={hintId} dividerRef={dividerRef} />
          <div className="cmp-source cmp-layer" data-layer="baseline" style={{ width: maxWidth, height: maxHeight, transform: `scale(${scale})` }}>
            <Surface panel={baseline} runtime={baselineRuntime} frame={baselineFrame} label={baselineLabel} />
          </div>
          <div ref={layerRef} className="cmp-source cmp-layer cmp-layer-candidate" data-layer="candidate"
            style={{ width: maxWidth, height: maxHeight, transform: `scale(${scale})`, clipPath: swipeClip(value) }}>
            <Surface panel={candidate} runtime={candidateRuntime} frame={candidateFrame} label={candidateLabel} />
          </div>
        </div>
      </div>
    </div>;
  } else {
    const waiting = baselineReady ? { panel: candidate, runtime: candidateRuntime, label: candidateLabel }
      : { panel: baseline, runtime: baselineRuntime, label: baselineLabel };
    body = <PendingStage panel={waiting.panel} runtime={waiting.runtime} width={frameWidth} height={frameHeight}
      label={`the ${ROLE_LABELS[waiting.panel.role].toLowerCase()}`} />;
  }

  return <div className="cmp-swipe hq-enter-fade" role="group" aria-label={`Swipe ${baselineLabel} against ${candidateLabel}`}>
    <div className="cmp-swipe-head" style={{ minWidth: Math.max(frameWidth, 320), maxWidth: Math.max(frameWidth, 320) }}>
      <div className="cmp-swipe-side">
        <span className="cmp-role cmp-role-baseline">Baseline</span>
        <VersionSelect panel={baseline} runtime={baselineRuntime} choices={baselineChoices}
          onSelect={(id) => baselineActions.selectVersion(id, baseline.source.kind)} />
      </div>
      <div className="cmp-swipe-side cmp-swipe-side-end">
        <VersionSelect panel={candidate} runtime={candidateRuntime} choices={candidateChoices}
          onSelect={(id) => candidateActions.selectVersion(id, candidate.source.kind)} />
        <span className="cmp-role cmp-role-candidate">Candidate</span>
      </div>
    </div>
    {body}
    {swiping && <p className="cmp-swipe-hint" id={hintId}>
      {describeViewport(viewport)}. Drag the divider, or focus it and use the arrow keys (Shift moves 10%). Double-click to centre.
    </p>}
    {pair.others > 0 && <p className="cmp-swipe-hint">
      {pair.others} other panel{pair.others === 1 ? ' is' : 's are'} hidden while you swipe.
    </p>}
  </div>;
}
