import { StatusChip, useListMotion } from '@hq/ui';
import { cx } from './GuardedButton.tsx';
import { useSessionStates } from './hooks.ts';
import { requestMeta, requestStatus, requestTitle } from './model.ts';
import type { RequestSession } from '../src/session.ts';
import './requests.css';

export interface RequestListProps {
  readonly sessions: readonly RequestSession[];
  readonly selectedId: string | null;
  readonly onSelect: (session: RequestSession) => void;
  /** Accessible name of the list. */
  readonly label: string;
  /** A request that was just created; its row takes the accent wash once. */
  readonly highlightId?: string | null;
}

/**
 * The project's requests, newest first, each with its title and a status chip (Draft, Frozen, Returned n). Titles
 * and statuses follow the sessions, so renaming a request or freezing it updates its row here. Rows glide into
 * place when one is added.
 */
export function RequestList({ sessions, selectedId, onSelect, label, highlightId = null }: RequestListProps) {
  const states = useSessionStates(sessions);
  const ids = sessions.map((session) => session.state.requestId as string);
  const listRef = useListMotion<HTMLUListElement>(ids);
  return <ul ref={listRef} className="hqr-request-list" aria-label={label}>
    {sessions.map((session, index) => {
      const state = states[index] ?? session.state;
      const id = state.requestId as string;
      const status = requestStatus(state);
      return <li key={id} data-hq-motion-key={id}>
        <button type="button" className={cx('hqr-request-row hq-press', highlightId === id && 'hq-flash')} data-status={status.kind}
          aria-current={id === selectedId ? 'true' : undefined} onClick={() => onSelect(session)}>
          <span className="hqr-request-row-top">
            <span className="hqr-request-title">{requestTitle(state)}</span>
            <StatusChip tone={status.tone} label={status.label} />
          </span>
          <span className="hqr-request-meta">{requestMeta(state)}</span>
        </button>
      </li>;
    })}
  </ul>;
}
