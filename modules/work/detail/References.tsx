import { useState } from 'react';
import { Button, StatusChip } from '@hq/ui';
import { LIMITS, REFERENCE_KINDS, REFERENCE_LABEL, type ItemReference, type ReferenceInput, type UrlReference } from '../core';

// Ordinary Planner links remain independent of the optional HQ reference mount.
// Without project context HQ envelopes remain readable, with no mutation controls.

type UrlKind = UrlReference['kind'];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The write form of the current links, unchanged. */
function inputsOf(references: readonly ItemReference[]): ReferenceInput[] {
  return references.map((ref) => (ref.kind === 'hq'
    ? { id: ref.id, kind: 'hq', label: ref.label, target: ref.target }
    : { id: ref.id, kind: ref.kind, label: ref.label, url: ref.url }));
}

export interface ReferencesProps {
  references: readonly ItemReference[];
  onSave(next: ReferenceInput[]): Promise<string | null>;
  disabled?: boolean;
  hideHq?: boolean;
}

export function References({ references, onSave, disabled, hideHq }: ReferencesProps) {
  const [adding, setAdding] = useState<{ kind: UrlKind; label: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: ReferenceInput[]) => {
    const problem = await onSave(next);
    setError(problem);
    return problem;
  };

  const add = async () => {
    if (!adding) return;
    const problem = await save([...inputsOf(references), { kind: adding.kind, label: adding.label.trim(), url: adding.url.trim() }]);
    if (!problem) setAdding(null);
  };

  return (
    <div className="work-links">
      {references.length === 0 && !adding && <p className="work-empty-line">No links.</p>}
      <ul className="work-link-list">
        {references.filter((ref) => !hideHq || ref.kind !== 'hq').map((ref) => (
          <li key={ref.id} className={`work-link${ref.kind === 'hq' ? ' work-link--hq' : ''}`}>
            {ref.kind === 'hq' ? (
              <>
                <span className="work-link-kind">HQ · {ref.target.domain} · {ref.target.kind}</span>
                <span className="work-link-body">
                  <span>{ref.target.title}</span>
                  <span className="hq-meta">Snapshot title{ref.target.sourceRevision ? ` · source revision ${ref.target.sourceRevision}` : ''}. Read-only here; following it never starts anything.</span>
                </span>
                <StatusChip tone="unknown" label="Not resolved" />
              </>
            ) : (
              <>
                <span className="work-link-kind">{REFERENCE_LABEL[ref.kind]}</span>
                {ref.url
                  ? <a className="work-link-body" href={ref.url} target="_blank" rel="noopener noreferrer">{ref.label || ref.url}<span className="hq-sr-only"> (opens outside HQ)</span></a>
                  : <span className="work-link-body">{ref.label}</span>}
                {ref.url && <span className="hq-meta">{hostOf(ref.url)}</span>}
              </>
            )}
            <Button size="sm" variant="ghost" disabled={disabled || ref.kind === 'hq'} onClick={() => void save(inputsOf(references).filter((r) => r.id !== ref.id))}>Remove</Button>
          </li>
        ))}
      </ul>
      {adding ? (
        <fieldset className="work-link-form">
          <legend>Add a link</legend>
          <label className="work-field">
            <span className="work-field-label">Kind</span>
            <select className="work-input" value={adding.kind} onChange={(event) => setAdding({ ...adding, kind: event.target.value as UrlKind })}>
              {REFERENCE_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
            </select>
          </label>
          <label className="work-field">
            <span className="work-field-label">Label</span>
            <input className="work-input" value={adding.label} maxLength={LIMITS.referenceLabel} onChange={(event) => setAdding({ ...adding, label: event.target.value })} />
          </label>
          <label className="work-field work-field--wide">
            <span className="work-field-label">Web address (http or https)</span>
            <input className="work-input" type="url" value={adding.url} maxLength={LIMITS.referenceUrl} spellCheck={false} onChange={(event) => setAdding({ ...adding, url: event.target.value })} />
          </label>
          <span className="work-date-form-actions">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setError(null); }}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void add()}>Save link</Button>
          </span>
        </fieldset>
      ) : (
        <Button size="sm" variant="ghost" disabled={disabled || references.length >= LIMITS.references} onClick={() => setAdding({ kind: 'url', label: '', url: '' })}>+ Add link</Button>
      )}
      {error && <p className="work-field-error" role="alert">{error}</p>}
    </div>
  );
}
