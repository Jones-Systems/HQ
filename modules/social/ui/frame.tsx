import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@hq/ui';
import { workspaceSnapshot, type WorkspaceLoad, type WorkspaceSnapshot } from '../core';
import { SocialIcon } from './icons';

/** What every Social page needs to know about the workspace read, provided once by the Social domain. */
export interface SocialFrame {
  readonly load: WorkspaceLoad;
  /** True for the fictional example workspace (no Social service configured). */
  readonly example: boolean;
  /** Reads the workspace again. A read never resends a run or a save. */
  readonly onCheck: () => void;
  /** The plain-language limits of what Social can do here. */
  readonly limits: string;
  /** The example workspace explanation, shown only when `example`. */
  readonly exampleNote: string;
}

export const SocialFrameContext = createContext<SocialFrame | null>(null);

/**
 * The domain frame, or null when a section is mounted on its own (tests, harnesses). Sections hide their own
 * freshness and limits notices when a frame is present, because the page header's sync pill carries them.
 */
export function useSocialFrame(): SocialFrame | null {
  return useContext(SocialFrameContext);
}

export function shortTime(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function longTime(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export type SyncTone = 'example' | 'synced' | 'refreshing' | 'connecting' | 'offline' | 'stale';

/** The one-word state of the workspace read, and the time it refers to. Never reads as current when it isn't. */
export function syncState(load: WorkspaceLoad, example: boolean): { readonly tone: SyncTone; readonly label: string; readonly snapshot?: WorkspaceSnapshot } {
  const snapshot = workspaceSnapshot(load);
  if (load.status === 'error') {
    const at = snapshot ? ` · last synced ${shortTime(snapshot.observedAt)}` : '';
    return load.error.kind === 'unavailable'
      ? { tone: 'offline', label: `Offline${at}`, ...(snapshot ? { snapshot } : {}) }
      : { tone: 'stale', label: `Not refreshed${at}`, ...(snapshot ? { snapshot } : {}) };
  }
  if (load.status === 'loading' || load.status === 'idle') {
    return snapshot ? { tone: 'refreshing', label: 'Refreshing…', snapshot } : { tone: 'connecting', label: 'Connecting…' };
  }
  if (example) return { tone: 'example', label: 'Example workspace', snapshot: load.snapshot };
  return { tone: 'synced', label: `Synced ${shortTime(load.snapshot.observedAt)}`, snapshot: load.snapshot };
}

/**
 * The page header's status pill: example workspace, synced, refreshing, offline or not refreshed. It opens a
 * small panel with the details, the limits and *Check again*. Renders nothing outside the Social frame.
 */
export function SyncPill() {
  const frame = useSocialFrame();
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (!frame) return null;
  const state = syncState(frame.load, frame.example);
  const busy = state.tone === 'refreshing' || state.tone === 'connecting';
  return (
    <div className="sx-sync" ref={root} data-tone={state.tone}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }}>
      <button
        ref={trigger} type="button" className="sx-sync-pill" aria-expanded={open} aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sx-sync-dot" aria-hidden="true" />
        {/* Not a live region: connection changes are announced once by the domain's notice, not on every read. */}
        <span>{state.label}</span>
        <SocialIcon name="chevron-down" className="sx-sync-chevron" />
      </button>
      {/* Always in the DOM so `aria-controls` resolves; hidden until opened. */}
      {(
        <div className="sx-sync-panel" id={`${id}-panel`} role="group" aria-label="Social workspace status" hidden={!open}>
          <p className="sx-sync-title">
            {state.tone === 'offline' ? 'The Social service is unreachable'
              : state.tone === 'stale' ? 'The workspace could not be refreshed'
                : state.tone === 'example' ? 'Example workspace'
                  : state.tone === 'synced' ? 'Synced with the Social service' : 'Reading the Social workspace…'}
          </p>
          {state.snapshot && <p className="hq-meta">Data as of {longTime(state.snapshot.observedAt)}</p>}
          {(state.tone === 'offline' || state.tone === 'stale') && (
            <p>Saving, calendar moves and runs pause until it answers. Your text is kept. Checking again never resends a run.</p>
          )}
          {frame.example && <p>{frame.exampleNote}</p>}
          <p className="sx-sync-limits"><b>Delivered limits</b> {frame.limits}</p>
          <Button size="sm" variant="secondary" busy={busy} busyLabel="Checking…" onClick={frame.onCheck}>
            <SocialIcon name="refresh" />Check again
          </Button>
        </div>
      )}
    </div>
  );
}

export interface PageHeaderProps {
  readonly title: ReactNode;
  /** One line saying what the page is for. */
  readonly description?: ReactNode;
  /** Small text above the title, for example the parent page ("Workbenches"). */
  readonly eyebrow?: ReactNode;
  /** Page actions, primary last. The sync pill is added after them. */
  readonly actions?: ReactNode;
  /** Extra content under the title row (filters, tabs). */
  readonly children?: ReactNode;
  readonly headingId?: string;
}

/**
 * The shared Social page header: title and purpose on the left; actions and the sync pill on the right. It is the
 * page's only `h1`. Pages use it instead of stacking notices above their content.
 */
export function PageHeader({ title, description, eyebrow, actions, children, headingId }: PageHeaderProps) {
  return (
    <header className="sx-head">
      <div className="sx-head-row">
        <div className="sx-head-text">
          {eyebrow && <p className="sx-head-eyebrow">{eyebrow}</p>}
          <h1 id={headingId}>{title}</h1>
          {description && <p className="sx-head-description">{description}</p>}
        </div>
        <div className="sx-head-actions">
          {actions}
          <SyncPill />
        </div>
      </div>
      {children}
    </header>
  );
}
