import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SaveIndicator, animateElement, type SaveState } from '@hq/ui';

export interface SaveStatusProps {
  readonly state: SaveState;
  /** What follows "Saved", for example "v4 · 2:31 PM". */
  readonly savedAt?: string;
  readonly onRetry?: () => void;
  readonly onCheck?: () => void;
}

/**
 * The save state: Unsaved, Saving…, Saved v4 · 2:31 PM, Not saved, or Save result unknown. The indicator stays
 * mounted, so its live region keeps announcing; the label fades and rises into place on each change, and the
 * moment a save lands it gets a one-shot wash. Both are instant under reduced motion.
 */
export function SaveStatus({ state, savedAt, onRetry, onCheck }: SaveStatusProps) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef(state);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (previous.current === state) return;
    const from = previous.current;
    previous.current = state;
    if (node.current) animateElement(node.current, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 'base', easing: 'enter' });
    if (state === 'saved' && from === 'saving') {
      setLanded(true);
      const timer = setTimeout(() => setLanded(false), 1300);
      return () => clearTimeout(timer);
    }
    setLanded(false);
    return undefined;
  }, [state]);
  return (
    <span className={landed ? 'soc-save-status hq-flash' : 'soc-save-status'} ref={node} data-state={state}>
      <SaveIndicator state={state} savedAt={savedAt} onRetry={onRetry} onCheck={onCheck} />
    </span>
  );
}

/**
 * The composer's sticky bar. Notices that belong to saving (a conflict, a service error) sit on top of it, where the
 * eye already is after pressing Save; the state and the actions sit below.
 */
export function SaveBar({ notices, status, actions, hint }: {
  readonly notices?: ReactNode;
  readonly status: ReactNode;
  readonly actions: ReactNode;
  readonly hint?: string;
}) {
  return (
    <div className="soc-savebar">
      {notices && <div className="soc-savebar-notices">{notices}</div>}
      <div className="soc-savebar-row">
        {status}
        <span className="soc-savebar-actions">
          {actions}
          {hint && <kbd className="soc-kbd" aria-hidden="true">{hint}</kbd>}
        </span>
      </div>
    </div>
  );
}
