import { useEffect, useId, useMemo, useState } from 'react';
import type { ClockPort, ComponentSource, Easing, MotionStudy, RenderInput } from '../src/contract.ts';
import { EASING_PRESETS, easingCurve, easingToCss, parseEasing, progressAt, totalDuration, withSegmentEasing } from '../src/model/motion.ts';
import { INITIAL_PLAYER, currentTime, frameAt, pause, play, replay, scrub, setLoop, tick } from '../src/model/player.ts';
import type { PlayerState } from '../src/model/player.ts';
import { ComponentSurface } from './ComponentSurface.tsx';
import type { ComponentRunnerPort } from '../src/runner.ts';

export interface MotionPlayerProps {
  readonly runner?: ComponentRunnerPort;
  readonly study: MotionStudy;
  /** Exact component revision the study animates, if available. */
  readonly target: { readonly source: ComponentSource; readonly input: RenderInput } | null;
  readonly clock: ClockPort;
  /** Saves the edited draft as a new revision. Earlier revisions stay unchanged. */
  readonly onSaveDraft?: (draft: MotionStudy) => Promise<void>;
}

const DEFAULT_SEGMENT: Readonly<Record<Easing['kind'], Easing>> = {
  linear: { kind: 'linear' },
  'cubic-bezier': EASING_PRESETS.ease,
  steps: { kind: 'steps', count: 4, position: 'jump-end' },
  spring: { kind: 'spring', stiffness: 170, damping: 26, mass: 1 },
};

function CurvePreview({ easing, segmentMs }: { readonly easing: Easing; readonly segmentMs: number }) {
  const points = easingCurve(easing, 64, segmentMs);
  const ys = points.map((point) => point.y);
  const low = Math.min(0, ...ys);
  const high = Math.max(1, ...ys);
  const map = (point: { x: number; y: number }) => `${(point.x * 100).toFixed(2)},${(100 - ((point.y - low) / (high - low)) * 100).toFixed(2)}`;
  return <svg className="hqc-curve" viewBox="-4 -4 108 108" role="img" aria-label={`Easing curve ${easingToCss(easing, segmentMs)}`}>
    <rect x="0" y="0" width="100" height="100" className="hqc-curve-frame" />
    <polyline points={points.map(map).join(' ')} className="hqc-curve-line" />
  </svg>;
}

function NumberField({ label, value, min, max, step, onChange }: {
  readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  return <span className="hqc-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="number" value={value} min={min} max={max} step={step}
      onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }} />
  </span>;
}

function EasingEditor({ easing, segmentMs, onChange }: { readonly easing: Easing; readonly segmentMs: number; readonly onChange: (easing: Easing) => void }) {
  const kindId = useId();
  const apply = (candidate: unknown) => {
    try {
      onChange(parseEasing(candidate));
    } catch {
      // Out-of-range parameters are not applied.
    }
  };
  return <div className="hqc-easing">
    <span className="hqc-field">
      <label htmlFor={kindId}>Easing</label>
      <select id={kindId} value={easing.kind} onChange={(event) => onChange(DEFAULT_SEGMENT[event.target.value as Easing['kind']])}>
        <option value="linear">linear</option>
        <option value="cubic-bezier">cubic-bezier</option>
        <option value="steps">steps</option>
        <option value="spring">spring</option>
      </select>
    </span>
    {easing.kind === 'cubic-bezier' ? <>
      <span className="hqc-presets" role="group" aria-label="Presets">
        {Object.entries(EASING_PRESETS).map(([name, preset]) => <button key={name} type="button" onClick={() => onChange(preset)}>{name}</button>)}
      </span>
      <NumberField label="x1" value={easing.x1} min={0} max={1} step={0.01} onChange={(x1) => apply({ ...easing, x1 })} />
      <NumberField label="y1" value={easing.y1} min={-5} max={5} step={0.01} onChange={(y1) => apply({ ...easing, y1 })} />
      <NumberField label="x2" value={easing.x2} min={0} max={1} step={0.01} onChange={(x2) => apply({ ...easing, x2 })} />
      <NumberField label="y2" value={easing.y2} min={-5} max={5} step={0.01} onChange={(y2) => apply({ ...easing, y2 })} />
    </> : null}
    {easing.kind === 'steps' ? <>
      <NumberField label="count" value={easing.count} min={1} max={1000} step={1} onChange={(count) => apply({ ...easing, count })} />
      <span className="hqc-field">
        <label htmlFor={`${kindId}-position`}>position</label>
        <select id={`${kindId}-position`} value={easing.position} onChange={(event) => apply({ ...easing, position: event.target.value })}>
          {['jump-start', 'jump-end', 'jump-none', 'jump-both'].map((position) => <option key={position} value={position}>{position}</option>)}
        </select>
      </span>
    </> : null}
    {easing.kind === 'spring' ? <>
      <NumberField label="stiffness" value={easing.stiffness} min={1} max={5000} step={1} onChange={(stiffness) => apply({ ...easing, stiffness })} />
      <NumberField label="damping" value={easing.damping} min={0.1} max={500} step={0.5} onChange={(damping) => apply({ ...easing, damping })} />
      <NumberField label="mass" value={easing.mass} min={0.1} max={100} step={0.1} onChange={(mass) => apply({ ...easing, mass })} />
    </> : null}
    <CurvePreview easing={easing} segmentMs={segmentMs} />
    <code className="hqc-mono">{easingToCss(easing, segmentMs)}</code>
  </div>;
}

/**
 * Motion study player: timeline, easing parameters, scrub and replay. The
 * shown frame is always `sampleStudy(draft, t)` for the current `t`.
 */
export function MotionPlayer({ study, target, clock, onSaveDraft, runner }: MotionPlayerProps) {
  const [draft, setDraft] = useState(study);
  const [player, setPlayer] = useState<PlayerState>(INITIAL_PLAYER);
  const [now, setNow] = useState(() => clock.now());
  const [segment, setSegment] = useState<{ trackId: string; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const scrubId = useId();

  useEffect(() => {
    setDraft(study);
    setPlayer(INITIAL_PLAYER);
    setSegment(null);
  }, [study]);

  useEffect(() => {
    if (player.status !== 'playing') return;
    let handle = 0;
    const step = () => {
      const reading = clock.now();
      setNow(reading);
      setPlayer((state) => tick(draft, state, reading));
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [player.status, draft, clock]);

  const total = totalDuration(draft);
  const t = currentTime(draft, player, now);
  const frame = useMemo(() => frameAt(draft, player, now), [draft, player, now]);
  const { iteration, progress } = progressAt(draft, t);
  const dirty = draft !== study;
  const selectedTrack = segment === null ? undefined : draft.tracks.find((track) => track.id === segment.trackId);
  const selectedFrame = segment === null ? undefined : selectedTrack?.keyframes[segment.index];
  const nextFrame = segment === null ? undefined : selectedTrack?.keyframes[segment.index + 1];
  const motion = useMemo(() => ({ study: draft, time: t }), [draft, t]);

  const toggle = () => {
    const reading = clock.now();
    setNow(reading);
    setPlayer((state) => (state.status === 'playing' ? pause(draft, state, reading) : play(draft, state, reading)));
  };

  return <section className="hqc-motion" aria-label={`Motion study ${draft.title}`}>
    <header className="hqc-motion-head">
      <h2>{draft.title} <span className="hqc-mono">r{study.revision}</span></h2>
      {dirty ? <span className="hqc-badge">Unsaved draft</span> : null}
      {onSaveDraft === undefined ? null : <button type="button" disabled={!dirty || saving} onClick={() => {
        setSaving(true);
        void onSaveDraft(draft).finally(() => setSaving(false));
      }}>Save as new revision</button>}
    </header>

    <div className="hqc-motion-stage">
      {target === null ? <p className="hqc-note">This study has no bound component revision.</p>
        : <ComponentSurface source={target.source} input={target.input} motion={motion} runner={runner} />}
    </div>

    <div className="hqc-transport" role="group" aria-label="Playback">
      <button type="button" onClick={toggle} aria-pressed={player.status === 'playing'}>{player.status === 'playing' ? 'Pause' : 'Play'}</button>
      <button type="button" onClick={() => {
        const reading = clock.now();
        setNow(reading);
        setPlayer((state) => replay(draft, state, reading));
      }}>Replay</button>
      <label className="hqc-radio">
        <input type="checkbox" checked={player.loop} onChange={(event) => {
          const reading = clock.now();
          setNow(reading);
          setPlayer((state) => setLoop(draft, state, event.target.checked, reading));
        }} />Loop
      </label>
      <label htmlFor={scrubId} className="hqc-visually-hidden">Scrub time</label>
      <input id={scrubId} className="hqc-scrub" type="range" min={0} max={total} step={1} value={Math.round(t)}
        aria-valuetext={`${Math.round(t)} of ${total} milliseconds`}
        onChange={(event) => setPlayer((state) => scrub(draft, state, event.target.valueAsNumber))} />
      <output className="hqc-mono" htmlFor={scrubId}>{Math.round(t)} / {total} ms{draft.iterations > 1 ? ` · iteration ${iteration + 1} of ${draft.iterations}` : ''}</output>
    </div>

    <div className="hqc-timeline" aria-label="Timeline">
      {draft.tracks.map((track) => <div key={track.id} className="hqc-track">
        <span className="hqc-track-label">{track.target}.{track.property}</span>
        <div className="hqc-lane">
          {track.keyframes.map((keyframe, index) => {
            const isSegment = index < track.keyframes.length - 1;
            const selected = segment?.trackId === track.id && segment.index === index;
            return <button
              key={index}
              type="button"
              className="hqc-key"
              data-selected={selected ? 'true' : 'false'}
              style={{ left: `${keyframe.offset * 100}%` }}
              disabled={!isSegment}
              aria-label={`${track.id} keyframe at ${Math.round(keyframe.offset * 100)}%, value ${keyframe.value}${isSegment ? `, easing ${keyframe.easing.kind}` : ''}`}
              onClick={() => setSegment({ trackId: track.id, index })}
            />;
          })}
          <span className="hqc-value hqc-mono">{(frame[track.id] ?? 0).toFixed(2)}</span>
        </div>
      </div>)}
      <div className="hqc-playhead" style={{ left: `calc(var(--hqc-track-label) + (100% - var(--hqc-track-label)) * ${progress})` }} aria-hidden="true" />
    </div>

    {segment !== null && selectedFrame !== undefined && nextFrame !== undefined ? <div className="hqc-segment" aria-label="Segment easing">
      <p className="hqc-note">{segment.trackId}: {Math.round(selectedFrame.offset * 100)}% → {Math.round(nextFrame.offset * 100)}%</p>
      <EasingEditor
        easing={selectedFrame.easing}
        segmentMs={(nextFrame.offset - selectedFrame.offset) * draft.duration}
        onChange={(easing) => setDraft((current) => withSegmentEasing(current, segment.trackId, segment.index, easing))}
      />
    </div> : <p className="hqc-note">Select a keyframe to edit the easing of the segment it starts.</p>}
  </section>;
}
