import { useId } from 'react';
import { Button } from '@hq/ui';
import type { ToolId } from '../../core';
import { SocialIcon } from '../../ui';
import type { HandoffFit } from '../../workbench/handoff';

const keyOf = (fit: HandoffFit) => `${fit.tool}:${fit.slot}`;

export interface FitListProps {
  readonly fits: readonly HandoffFit[];
  /** The workbench names come from the service's catalog; false until the workspace has loaded. */
  readonly toolsLoaded: boolean;
  readonly toolName: (tool: ToolId) => string;
  /** What opening would overwrite, said before the click. */
  readonly replaces: (fit: HandoffFit) => string | null;
  /** A hand-off HQ refused, with its reason. */
  readonly blocked: { readonly fit: HandoffFit; readonly reason: string } | null;
  readonly onOpen: (fit: HandoffFit) => void;
  /** Opens the tool page as it is, loading nothing. */
  readonly onOpenTool: (tool: ToolId) => void;
}

/**
 * The workbenches that accept the selected file: those HQ recognizes by its contents first, then the places a file of
 * that shape could go. *Open in …* loads the file into that tool's form and goes there; nothing runs.
 */
export function FitList({ fits, toolsLoaded, toolName, replaces, blocked, onOpen, onOpenTool }: FitListProps) {
  const id = useId();
  const recognized = fits.filter((fit) => fit.strength === 'recognized');
  const possible = fits.filter((fit) => fit.strength === 'possible');
  const row = (fit: HandoffFit, primary: boolean) => {
    const name = toolName(fit.tool);
    const ambiguous = fits.filter((other) => other.tool === fit.tool).length > 1;
    const note = replaces(fit);
    const refused = blocked && keyOf(blocked.fit) === keyOf(fit) ? blocked.reason : null;
    return (
      <li key={keyOf(fit)} className="sd-fit">
        <div className="sx-row-main">
          <span className="sx-row-title">{name}</span>
          <span className="sx-row-meta">{fit.label} · {fit.reason}</span>
          {note && <span className="sd-fit-note">Replaces {note}.</span>}
          {refused && (
            <span className="sd-fit-note sd-fit-note--danger" role="alert">
              {refused}{' '}
              <Button size="sm" variant="ghost" onClick={() => onOpenTool(fit.tool)}>Open {name} without loading</Button>
            </span>
          )}
        </div>
        <Button
          size="sm" variant={primary ? 'primary' : 'secondary'} className="hq-press"
          {...(ambiguous ? { 'aria-label': `Open in ${name} as ${fit.label}` } : {})}
          onClick={() => onOpen(fit)}
        >
          Open in {name}<SocialIcon name="arrow-right" />
        </Button>
      </li>
    );
  };
  return (
    <section className="sd-fits" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="sd-subhead">Open in a workbench</h3>
      {!toolsLoaded ? (
        <p className="sd-muted">The workbench list hasn't loaded, so HQ can't offer a match yet. Checking the file still works.</p>
      ) : (
        <>
          {recognized.length > 0 ? (
            <ul className="sx-list hq-stagger">{recognized.map((fit, index) => row(fit, index === 0))}</ul>
          ) : (
            <p className="sd-muted">
              {possible.length > 0
                ? "HQ can't tell from this file's contents which workbench reads it. These workbenches accept a file of this shape; you choose."
                : 'No workbench accepts a file of this shape.'}
            </p>
          )}
          {possible.length > 0 && (
            <details className="sd-more" open={recognized.length === 0}>
              <summary>{recognized.length > 0 ? `Other places this shape fits (${possible.length})` : `Where it could go (${possible.length})`}</summary>
              <ul className="sx-list">{possible.map((fit) => row(fit, false))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
