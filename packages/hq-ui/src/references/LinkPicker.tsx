import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { referenceKey, type ReferencePort } from './types';

export interface LinkPickerProps {
  readonly open: boolean;
  readonly projectId: string;
  readonly port: Pick<ReferencePort, 'find'>;
  readonly existing?: readonly ReferenceEnvelope[];
  readonly onClose: () => void;
  /** Selection only. The source owner controls capability gating, persistence and creation Undo. */
  readonly onSelect: (envelope: ReferenceEnvelope) => void;
}
interface SearchState {
  readonly query: string;
  readonly projectId: string;
  readonly port: LinkPickerProps['port'];
  readonly status: 'loading' | 'ready' | 'error';
  readonly results: readonly ReferenceEnvelope[];
}
export function LinkPicker(props: LinkPickerProps) {
  // Unmount the session on close so reopening cannot retain results or a previous project's selection.
  return props.open ? <PickerSession {...props} /> : null;
}
function PickerSession({ projectId, port, existing = [], onClose, onSelect }: LinkPickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>();
  useEffect(() => {
    let current = true;
    setActive(-1);
    setState({ query, projectId, port, status: 'loading', results: [] });
    Promise.resolve().then(() => port.find(query, { projectId, limit: 30 })).then((results) => {
      if (!current) return;
      const unique = new Map<string, ReferenceEnvelope>();
      for (const value of results) {
        const envelope = parseReference(value);
        if (envelope?.projectId === projectId) unique.set(referenceKey(envelope), envelope);
        if (unique.size === 30) break;
      }
      setState({ query, projectId, port, status: 'ready', results: [...unique.values()] });
    }).catch(() => { if (current) setState({ query, projectId, port, status: 'error', results: [] }); });
    return () => { current = false; };
  }, [query, projectId, port, retry]);
  const current = state?.query === query && state.projectId === projectId && state.port === port;
  const status = current ? state.status : 'loading';
  const results = current && status === 'ready' ? state.results : [];
  const selected = new Set(existing.map(referenceKey));
  const full = existing.length >= 30;
  const disabled = (envelope: ReferenceEnvelope) => full || selected.has(referenceKey(envelope));
  const choose = (index: number) => {
    const envelope = results[index];
    if (envelope && !disabled(envelope)) onSelect(envelope);
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = !results.length ? -1 : event.key === 'ArrowDown'
        ? (active + 1) % results.length : (active <= 0 ? results.length - 1 : active - 1);
      setActive(next);
    } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
  };
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);
  return <Dialog open onClose={onClose} title="Link to…" description={`Search references in project ${projectId}. Selection never starts work.`}
    initialFocusRef={inputRef} actions={<Button onClick={onClose}>Cancel</Button>} className="hq-link-picker">
    <label className="hq-reference-search-label" htmlFor={`${id}-query`}>Search references</label>
    <input ref={inputRef} id={`${id}-query`} className="hq-reference-search" role="combobox" autoComplete="off"
      aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`}
      aria-describedby={`${id}-hint`} aria-activedescendant={results[active] ? `${id}-option-${active}` : undefined}
      value={query} onChange={(event) => { setActive(-1); setQuery(event.target.value); }} onKeyDown={keyboard} />
    <p id={`${id}-hint`} className="hq-reference-freshness">Use ↑ and ↓ to browse, Enter to select, Escape to cancel.</p>
    {full && <p role="status">30-link limit reached. Unlink a reference before adding another.</p>}
    <p role="status" aria-live="polite">{status === 'loading' ? 'Searching…' : status === 'error' ? 'Search unavailable.' : results.length ? `${results.length} results` : 'No references found.'}</p>
    {status === 'error' && <><p role="alert">Could not search references. Existing links are unchanged.</p><Button onClick={() => { setRetry(retry + 1); inputRef.current?.focus(); }}>Retry search</Button></>}
    <ul id={`${id}-results`} role="listbox" aria-label="Reference results" aria-busy={status === 'loading'} className="hq-reference-results">
      {results.map((envelope, index) => <li key={referenceKey(envelope)} id={`${id}-option-${index}`} role="option"
        aria-selected={index === active} aria-disabled={disabled(envelope)} className="hq-reference-option"
        onMouseDown={(event) => event.preventDefault()} onClick={() => { setActive(index); choose(index); }}>
        <span className="hq-reference-title">{envelope.title}</span>
        <span className="hq-reference-provenance">{envelope.domain} · {envelope.kind} · {envelope.entityId} · Project {envelope.projectId}</span>
        <span className="hq-reference-freshness">{selected.has(referenceKey(envelope)) ? 'Already linked' : 'Snapshot · Not resolved'}</span>
      </li>)}
    </ul>
  </Dialog>;
}
