import { IconButton } from '@hq/ui';
import { useDataSources } from './settings/DataSources';
import { SOURCE_NAMES, worstSource, type DataSource } from './services/data-source-status';
import './connections/connections.css';
export function Connections({ onManage, compact = false }: { onManage: (source?: DataSource, opener?: HTMLElement) => void; compact?: boolean }) {
  const { statuses, busy, check } = useDataSources();
  const summary = Object.entries(statuses).map(([source, status]) => `${SOURCE_NAMES[source as DataSource]}: ${status.text}`).join('; ');
  if (compact) {
    const status = worstSource(statuses);
    return <section className="connections connections--compact" aria-label="Data sources">
      <button className={`rail-action source-summary connection-row--${status.tone}`} aria-label={`Data sources: ${summary}`} title={summary} onClick={event => onManage(undefined, event.currentTarget)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></svg>
        <span className="connection-summary-dot" aria-hidden="true" />
      </button>
    </section>;
  }
  return <section className="connections" aria-label="Data sources">
    <div className="connections-heading">Data sources</div>
    {(['social', 'work', 'wiki'] as const).map(source => {
      const name = SOURCE_NAMES[source]; const status = statuses[source];
      return <div key={source} className={`connection-row connection-row--${status.tone}`}>
        <button className="rail-action source-action" title={`${name}: ${status.text}`} aria-label={`${name}: ${status.text}`} onClick={event => onManage(source, event.currentTarget)}>
          <span aria-hidden="true" className="connection-shape">{status.tone === 'good' ? '●' : status.tone === 'bad' ? '▲' : '○'}</span>
          <span className="connection-copy"><strong>{name}</strong><span role="status">{status.text}</span></span>
        </button>
        <IconButton className="source-recheck" label={`Recheck ${name}: ${status.text}`} icon="↻" size="sm" disabled={busy || status.text === 'Checking…'} onClick={() => void check(source)} />
      </div>;
    })}
  </section>;
}
