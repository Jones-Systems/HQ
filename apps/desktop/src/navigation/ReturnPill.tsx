import { useEffect, useMemo, useRef } from 'react';
import { usePresence } from '@hq/ui';
import { backChord, chordKeys, chordText, currentPlatformIsMac } from './platform';
import { isEditableTarget, modalDialogOpen, resolveShellShortcut } from './shortcuts';
import './navigation.css';

export interface ReturnPillProps {
  /** Where Back goes, for example `Work · Status board`. `null` plays the exit motion; unmounting skips it. */
  readonly label: string | null;
  readonly onBack: () => void;
  /** Keep the pill mounted but out of sight and out of the shortcut, for example while Settings covers the page. */
  readonly hidden?: boolean;
  /** Override platform detection. */
  readonly mac?: boolean;
}

/**
 * Compact "← Back to <label>" that floats at the top of the workspace without taking layout space: it sits in a
 * zero-height anchor, so mount it as the first child of the workspace column. While shown it also answers Alt+←
 * (⌘[ on macOS) unless a module already handled the key, a dialog is open, or the key came from a text field.
 */
export function ReturnPill({ label, onBack, hidden = false, mac }: ReturnPillProps) {
  const isMac = useMemo(() => mac ?? currentPlatformIsMac(), [mac]);
  const lastLabel = useRef(label);
  if (label !== null) lastLabel.current = label;
  const presence = usePresence<HTMLButtonElement>(label !== null, { motion: 'drop' });
  const available = label !== null && !hidden;
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveShellShortcut(event, { mac: isMac, modalOpen: modalDialogOpen(), editable: isEditableTarget(event.target), backAvailable: true });
      if (shortcut?.type !== 'back') return;
      event.preventDefault();
      handler.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [available, isMac]);
  if (!presence.mounted) return null;
  const chord = backChord(isMac);
  const leaving = label === null;
  return <div className="hq-return-anchor" hidden={hidden}>
    <div className="hq-return-row">
      <button type="button" ref={presence.ref} {...presence.props} className="hq-return-pill" onClick={onBack}
        aria-keyshortcuts={isMac ? 'Meta+[' : 'Alt+ArrowLeft'} title={`Back to ${lastLabel.current} (${chordText(chord, isMac)})`}
        {...(leaving ? { tabIndex: -1, 'aria-hidden': true } : {})}>
        <svg className="hq-return-arrow" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
        <span className="hq-return-label">Back to {lastLabel.current}</span>
        <span className="hq-return-keys" aria-hidden="true">{chordKeys(chord, isMac).map(key => <kbd key={key}>{key}</kbd>)}</span>
      </button>
    </div>
  </div>;
}
