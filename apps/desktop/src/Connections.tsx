import { IconButton, type StatusTone } from '@hq/ui';
import { useDataSources } from './settings/DataSources';
import { SOURCE_NAMES, type DataSource, type SourceStatus } from './services/data-source-status';
import './connections/connections.css';

/** Status shapes (`StatusChip`'s): reachable a filled dot, needs attention a half dot, not checked an open ring. */
export const SOURCE_TONES: Readonly<Record<SourceStatus['tone'], StatusTone>> = { good: 'success', bad: 'warning', neutral: 'neutral' };
const RECHECK_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19.5 4.5V9H15" /></svg>;

export function Connections({ onManage }: { onManage: (source?: DataSource, opener?: HTMLElement) => void }) {
  const { statuses, busy, check } = useDataSources();
  return <section className="connections" aria-label="Data sources">
    <div className="connections-heading">Data sources</div>
    {(['social', 'work', 'wiki'] as const).map(source => {
      const name = SOURCE_NAMES[source]; const status = statuses[source];
      return <div key={source} className={`connection-row connection-row--${status.tone}`}>
        <button type="button" className="source-action" title={`${name}: ${status.text}`} aria-label={`${name}: ${status.text}`} onClick={event => onManage(source, event.currentTarget)}>
          <span aria-hidden="true" className={`connection-shape hq-status hq-status--${SOURCE_TONES[status.tone]}`}><span className="hq-status-shape" /></span>
          <span className="connection-copy"><strong>{name}</strong><span role="status">{status.text}</span></span>
        </button>
        <IconButton className="source-recheck" label={`Recheck ${name}: ${status.text}`} icon={RECHECK_ICON} size="sm" disabled={busy || status.text === 'Checking…'} onClick={() => void check(source)} />
      </div>;
    })}
  </section>;
}
