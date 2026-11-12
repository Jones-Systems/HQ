import type { CSSProperties } from 'react';
import type { MotionFrame, MotionStudy } from '../src/contract.ts';
import { frameToStyles } from '../src/model/motion.ts';

export interface MotionProxyProps {
  readonly study: MotionStudy;
  /** The sampled frame to show: `sampleStudy(study, t)`. */
  readonly frame: MotionFrame;
  /** Reduced motion: the frame steps between a few samples instead of gliding. */
  readonly reduced: boolean;
}

/**
 * HQ-drawn stand-in for the animated component while execution is held. Each motion target in the study is one
 * plain box that follows the sampled opacity and transform values through React style objects. The box has no CSS
 * transition, so it always shows exactly the sampled frame. It is not the component and says so.
 */
export function MotionProxy({ study, frame, reduced }: MotionProxyProps) {
  const styles = frameToStyles(study, frame);
  const targets = [...new Set(study.tracks.map((track) => track.target))];
  return <div className="hqc-proxy" data-held-proxy="true">
    <div className="hqc-proxy-stage">
      {targets.map((target) => {
        const sampled = styles[target];
        const style: CSSProperties = {
          ...(sampled?.opacity === undefined ? {} : { opacity: Number(sampled.opacity) }),
          ...(sampled?.transform === undefined ? {} : { transform: sampled.transform }),
        };
        return <div key={target} className="hqc-proxy-slot"><div className="hqc-proxy-box" data-target={target} style={style}><span>{target}</span></div></div>;
      })}
    </div>
    <p className="hqc-proxy-label">
      <i aria-hidden="true" />Proxy · the component itself is held{reduced ? ' · reduced motion: sampled frames' : ''}
    </p>
  </div>;
}
