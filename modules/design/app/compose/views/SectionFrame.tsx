import type { ReactNode } from 'react';
import { StatusChip } from '@hq/ui';
import type { EvidenceTag } from '../labels.ts';

export interface SectionFrameProps {
  /** Compatibility metadata; never shown as product chrome. */
  readonly lane: string;
  /** Source entry retained for callers; never displayed to the user. */
  readonly entry: string;
  /** Non-real provenance stays visible; storage details remain available in About data. */
  readonly tags: readonly EvidenceTag[];
  /** Holds and limits specific to this section. */
  readonly notes?: readonly string[];
  /** Give the section a bounded box (canvas-like views size to their container). */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

/** Non-real data always has a visible badge; details retain capability and durability limits. */
export function SectionFrame({ lane, tags, notes = [], fill = false, children }: SectionFrameProps) {
  const nonReal = tags.filter((tag) => tag.status !== 'workspace');
  const details = [...new Set([...tags.map((tag) => tag.text), ...notes])];
  return <div className="hqd-compose-frame" data-compose-lane={lane}>
    {(nonReal.length > 0 || details.length > 0) && <div className="hqd-compose-provenance" role="note">
      {nonReal.map((tag) => <StatusChip key={`${tag.status}:${tag.text}`} tone={tag.status === 'cached' ? 'warning' : 'info'}
        label={tag.status === 'fake' ? 'Example' : tag.status === 'cached' ? 'Cached' : 'Synthetic'} />)}
      <details className="hqd-about-data">
        <summary>About data</summary>
        <ul>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
      </details>
    </div>}
    <div className={fill ? 'hqd-compose-body is-fill' : 'hqd-compose-body'}>{children}</div>
  </div>;
}
