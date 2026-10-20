import type { ReactNode } from 'react';
import type { EvidenceTag } from '../labels.ts';

export interface SectionFrameProps {
  /** Lane label, e.g. "T2 projects". */
  readonly lane: string;
  /** The real section entry composed inside, e.g. "projects/src › ProjectsSection". */
  readonly entry: string;
  /** What the data under this view is. Never omitted: composed data is always labelled. */
  readonly tags: readonly EvidenceTag[];
  /** Holds and limits specific to this section. */
  readonly notes?: readonly string[];
  /** Give the section a bounded box (canvas-like views size to their container). */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

/**
 * Labelled wrapper around a real section view. Until the store adapters and real capabilities land, every
 * composed section says what its data is, so fake or synthetic data cannot pass as real.
 */
export function SectionFrame({ lane, entry, tags, notes = [], fill = false, children }: SectionFrameProps) {
  return <div className="hqd-compose-frame" data-compose-lane={lane}>
    <p className="hqd-compose-strip" role="note">
      <strong>{tags.map((tag) => tag.status).join(' · ')}</strong> {lane} · real entry <code>{entry}</code>
      {tags.map((tag) => <span key={tag.text}> · {tag.text}</span>)}
      {notes.map((note) => <span key={note}> · {note}</span>)}
    </p>
    <div className={fill ? 'hqd-compose-body is-fill' : 'hqd-compose-body'}>{children}</div>
  </div>;
}
