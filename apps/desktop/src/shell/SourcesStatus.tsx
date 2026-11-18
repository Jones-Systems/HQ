import { useEffect, useId, useRef, useState } from 'react';
import { usePresence } from '@hq/ui';
import { Connections, SOURCE_TONES } from '../Connections';
import { useDataSources } from '../settings/DataSources';
import { SOURCE_NAMES, worstSource, type DataSource } from '../services/data-source-status';
import { ShellIcon } from './icons';

export interface SourcesStatusProps {
  /** Opens Settings at `source` (or at the top). `opener` is where focus returns when Settings closes. */
  readonly onManage: (source: DataSource | null, opener: HTMLElement) => void;
}

/**
 * One top-bar entry for data-source status: the worst status's shape on a "Sources" button, every source's words in
 * its name, and a popover with each source's row (open its settings, or recheck it). Opening the popover runs no
 * check; only an explicit recheck does.
 */
export function SourcesStatus({ onManage }: SourcesStatusProps) {
  const { statuses } = useDataSources();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const presence = usePresence<HTMLDivElement>(open, { motion: 'drop' });
  const worst = worstSource(statuses);
  const summary = (Object.keys(statuses) as DataSource[]).map((source) => `${SOURCE_NAMES[source]}: ${statuses[source].text}`).join('; ');

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.shell-popover button')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const manage = (source: DataSource | null) => {
    setOpen(false);
    if (trigger.current) onManage(source, trigger.current);
  };

  return (
    <div ref={root} className="shell-sources">
      <button ref={trigger} type="button" className="shell-chip" aria-label={`Data sources: ${summary}`} title={summary}
        aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => (open ? close(false) : setOpen(true))}>
        <span className={`hq-status hq-status--${SOURCE_TONES[worst.tone]}`} aria-hidden="true"><span className="hq-status-shape" /></span>
        <span className="shell-chip-label">Sources</span>
        <ShellIcon name="chevron" className="shell-chevron" />
      </button>
      {presence.mounted && (
        <div id={panelId} ref={presence.ref} {...presence.props} className="shell-popover shell-popover--end" data-hq-overlay="open"
          inert={!open || undefined}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
          <Connections onManage={(source) => manage(source ?? null)} />
          <div className="shell-popover-foot">
            <button type="button" className="shell-link-button" onClick={() => manage(null)}>Manage in Settings</button>
          </div>
        </div>
      )}
    </div>
  );
}
