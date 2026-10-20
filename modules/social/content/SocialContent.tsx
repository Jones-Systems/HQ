import { useEffect } from 'react';
import { StateView, StatusChip } from '@hq/ui';
import { useSocialSession, workspaceSnapshot, type SocialWorkspacePort } from '../core';
import { Calendar } from './Calendar';
import { Library } from './Library';
import { localToday, parseContentDestination } from './model';
import './content.css';

export interface SocialContentProps {
  readonly port: SocialWorkspacePort;
  /** The HQ project ID; session state is kept per project and survives remounts. */
  readonly projectId: string;
  /** `library[/<draftId>|/new]` or `calendar[/<YYYY-MM>]`. Anything else shows the library. */
  readonly destination: string;
  readonly navigate: (destination: string) => void;
  readonly now?: () => Date;
}

function clock(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Social content pages: the library with its draft editor, and the editorial calendar.
 * Only content-class calls are made; nothing here can start a run.
 */
export function SocialContent({ port, projectId, destination, navigate, now = () => new Date() }: SocialContentProps) {
  const { state, session } = useSocialSession(projectId);
  const location = parseContentDestination(destination) ?? { page: 'library' as const };
  const load = state.workspace;
  const snapshot = workspaceSnapshot(load);

  // Load once per session; a remount reuses the session's snapshot instead of reloading.
  useEffect(() => {
    if (session.getState().workspace.status === 'idle') void session.load(port);
  }, [session, port]);

  if (!snapshot) {
    if (load.status === 'error') {
      const offline = load.error.kind === 'unavailable';
      return (
        <StateView
          state={offline ? 'unavailable' : 'error'}
          title={offline ? 'The Social service is unreachable' : 'The workspace could not be loaded'}
          description="Nothing was changed. Unsaved text in open drafts is kept for this session."
          action={{ label: 'Try again', onAction: () => void session.load(port) }}
        />
      );
    }
    return <StateView state="loading" title="Loading the Social workspace…" />;
  }

  const stale = load.status === 'error';
  const paused = stale && load.error.kind === 'unavailable' ? 'The Social service is unreachable. Saving is paused; your text is kept.' : undefined;
  const brand = typeof state.view.calendarBrand === 'string' ? state.view.calendarBrand : 'all';

  return (
    <div className="soc-content">
      <div className="soc-freshness" role="status">
        {load.status === 'loading' && <StatusChip tone="info" label="Refreshing" />}
        {stale
          ? <StatusChip tone={load.error.kind === 'unavailable' ? 'unavailable' : 'warning'} label={load.error.kind === 'unavailable' ? 'Offline' : 'Stale'} detail={`showing data last synced ${clock(snapshot.observedAt)}`} />
          : <span className="hq-meta">Last synced {clock(snapshot.observedAt)}</span>}
        {stale && <button type="button" className="hq-save-action" onClick={() => void session.load(port)}>Check again</button>}
      </div>
      {location.page === 'calendar' ? (
        <Calendar
          session={session} port={port} snapshot={snapshot} month={location.month ?? localToday(now()).slice(0, 7)}
          brand={brand} onBrandChange={(value) => session.setView('calendarBrand', value)} navigate={navigate} paused={paused} now={now}
        />
      ) : (
        <Library session={session} state={state} port={port} snapshot={snapshot} draftId={location.draftId} navigate={navigate} paused={paused} />
      )}
    </div>
  );
}
