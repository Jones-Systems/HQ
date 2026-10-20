import type { ReactNode } from 'react';

export interface PreviewFrameProps {
  /** Lane label, e.g. "T2 projects". */
  readonly lane: string;
  /** The real section entry point mounted inside, e.g. "projects/src/views/section.ts › ProjectsSection". */
  readonly entry: string;
  /** Holds and limits specific to this section in the preview. */
  readonly notes?: readonly string[];
  /** Give the section a bounded box (canvas-like views size to their container). */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

/** Labelled wrapper around a real section view. Every section in the preview is shown through it. */
export function PreviewFrame({ lane, entry, notes = [], fill = false, children }: PreviewFrameProps) {
  return <div className="hqd-preview-frame" data-preview-lane={lane}>
    <p className="hqd-preview-strip" role="note">
      <strong>Preview</strong> {lane} · real entry <code>{entry}</code> · labelled fakes, synthetic data
      {notes.map((note) => <span key={note}> · {note}</span>)}
    </p>
    <div className={fill ? 'hqd-preview-body is-fill' : 'hqd-preview-body'}>{children}</div>
  </div>;
}
