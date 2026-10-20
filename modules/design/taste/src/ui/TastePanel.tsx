import { useCallback, useEffect, useId, useState } from 'react';
import {
  RATING_VALUES,
  type JournalStatus, type ProfileExport, type ProjectId, type RatingValue, type TasteClientPort, type TasteCommand,
  type TasteFeatureFlags, type TasteProfile, type TasteScope, type TasteSnapshot, type TasteSubject,
} from '../contract.ts';
import { DEFAULT_TASTE_FLAGS } from '../flags.ts';
import {
  DEFAULT_ASPECTS, LIKING_LABELS, contributionCommand, counterevidenceCommand, describeResult, describeUnknown,
  formatMean, noteCommand, randomId, ratingCommand, ratingSlots, scopeFor,
  type AspectDefinition, type NewId, type RatingSlot, type SubmitOutcome,
} from './view-model.ts';
import './taste.css';

export interface TastePanelProps {
  readonly client: TasteClientPort;
  readonly subject: TasteSubject;
  readonly projectId: ProjectId | null;
  readonly projectName?: string;
  readonly flags?: TasteFeatureFlags;
  readonly aspects?: readonly AspectDefinition[];
  readonly newId?: NewId;
  /** Test seam: a preloaded snapshot renders immediately. */
  readonly initialSnapshot?: TasteSnapshot;
}

/** HQ taste rating controls. Saving appends to the journal; it never changes model defaults. */
export function TastePanel({
  client, subject, projectId, projectName, flags = DEFAULT_TASTE_FLAGS, aspects = DEFAULT_ASPECTS,
  newId = randomId, initialSnapshot,
}: TastePanelProps) {
  const [snapshot, setSnapshot] = useState<TasteSnapshot | null>(initialSnapshot ?? null);
  const [loadError, setLoadError] = useState(false);
  const [scopeKind, setScopeKind] = useState<'general' | 'project'>(projectId ? 'project' : 'general');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const titleId = useId();

  const reload = useCallback(async () => {
    try {
      setSnapshot(await client.snapshot(projectId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [client, projectId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!projectId) setScopeKind('general'); }, [projectId]);

  const submit = useCallback(async (command: TasteCommand | null) => {
    if (!command) return;
    setBusy(true);
    try {
      setOutcome(describeResult(await client.submit(command)));
    } catch {
      setOutcome(describeUnknown(command));
    } finally {
      setBusy(false);
      await reload();
    }
  }, [client, reload]);

  if (!flags.ratingControls) return null;
  const scope = scopeFor(scopeKind, projectId);
  const header = <header className="taste-header">
    <span className="eyebrow">Taste</span>
    <h2 id={titleId}>{subject.label}</h2>
    {snapshot && <JournalBadge status={snapshot.journal} />}
  </header>;

  if (!snapshot || !scope) {
    return <section className="taste" aria-labelledby={titleId}>{header}
      <p className="taste-muted" role="status">{loadError ? 'Taste is unavailable right now.' : 'Loading taste…'}</p>
    </section>;
  }

  const readOnly = snapshot.journal.state !== 'open' || busy;
  const slots = ratingSlots(snapshot, scope, subject, aspects);
  const profile = scope.kind === 'project' ? snapshot.project : snapshot.general;
  const examples = snapshot.examples.filter((item) => item.subject.id === subject.id);

  return <section className="taste" aria-labelledby={titleId}>
    {header}
    <div className="taste-scope" role="radiogroup" aria-label="Rating scope">
      <ScopeOption name={`${titleId}-scope`} value="general" checked={scopeKind === 'general'} onSelect={setScopeKind}
        label="General taste" />
      <ScopeOption name={`${titleId}-scope`} value="project" checked={scopeKind === 'project'} onSelect={setScopeKind}
        label={projectName ? `Project · ${projectName}` : 'This project'} disabled={!projectId} />
    </div>
    <p className="taste-muted taste-scope-note">{scope.kind === 'general'
      ? 'General taste describes your preferences across all work.'
      : 'Project ratings stay with this project unless you include them in general taste.'}</p>

    <div className="taste-body">
      <div className="taste-ratings">
        <section aria-labelledby={`${titleId}-liking`}>
          <h3 id={`${titleId}-liking`}>Liking</h3>
          <p className="taste-muted">How much do you like it?</p>
          {slots.liking.map((slot) => <RatingRow key={slot.key} slot={slot} name={`${titleId}-${scopeKind}-${slot.key}`}
            disabled={readOnly} labels={LIKING_LABELS}
            onRate={(value) => submit(ratingCommand(scope, subject, slot, value, newId))} />)}
        </section>
        <section aria-labelledby={`${titleId}-descriptive`}>
          <h3 id={`${titleId}-descriptive`}>Description</h3>
          <p className="taste-muted">How strongly does it show each quality? This records what it is, not whether you like it.</p>
          {slots.descriptive.map((slot) => {
            const aspect = aspects.find((item) => slot.target.kind === 'aspect' && item.id === slot.target.aspect);
            return <RatingRow key={slot.key} slot={slot} name={`${titleId}-${scopeKind}-${slot.key}`} disabled={readOnly}
              anchors={aspect ? [aspect.low, aspect.high] : undefined}
              onRate={(value) => submit(ratingCommand(scope, subject, slot, value, newId))} />;
          })}
        </section>
        <NotesEditor disabled={readOnly} slots={[...slots.liking, ...slots.descriptive]}
          onNote={(text) => submit(noteCommand(scope, subject, text, newId))}
          onCounterevidence={(slot, text) => submit(counterevidenceCommand(scope, subject, slot, text, newId))} />
      </div>

      <aside className="taste-profile" aria-label="Taste profile">
        {profile && <ProfileSummary profile={profile} aspects={aspects}
          title={scope.kind === 'general' ? 'General profile' : 'Project profile'} />}
        {projectId && <label className="taste-check">
          <input type="checkbox" checked={snapshot.contributions[projectId] === true} disabled={readOnly}
            onChange={(event) => submit(contributionCommand(projectId, event.target.checked, newId))} />
          <span>Include this project&rsquo;s ratings in general taste</span>
        </label>}
        {examples.length > 0 && <section className="taste-examples" aria-label="Imported examples">
          <h4>Imported examples</h4>
          <p className="taste-muted">Shown for reference. They are not your judgments and are not counted.</p>
          <ul>{examples.map((example) => <li key={example.exampleId}>
            <span className="taste-tag">Imported · not your judgment</span>
            <span>{example.source.label}</span>
            {example.claimed.length > 0 && <span className="taste-muted">
              Source claims: {example.claimed.map((claim) => `${claim.judgment} ${claim.target.kind === 'overall' ? 'overall' : claim.target.aspect} ${claim.value}`).join(', ')}
            </span>}
          </li>)}</ul>
        </section>}
        <ExportControls client={client} scope={scope} />
      </aside>
    </div>

    <div className="taste-status" role="status" aria-live="polite">
      {outcome && <span data-outcome={outcome.kind}>{outcome.message}</span>}
      {outcome?.kind === 'unknown' && <button type="button" className="taste-button" disabled={busy}
        onClick={() => submit(outcome.retry)}>Retry</button>}
    </div>
  </section>;
}

function JournalBadge({ status }: { readonly status: JournalStatus }) {
  if (status.state === 'open') return <span className="taste-badge" data-state="open">{status.head.seq} {status.head.seq === 1 ? 'entry' : 'entries'} · verified</span>;
  if (status.state === 'closed') return <span className="taste-badge" data-state="closed">Closed</span>;
  return <span className="taste-badge" data-state="fail-closed" role="alert">
    Read-only: storage fault ({status.reason}) after {status.verifiedRecords} verified entries. Nothing was removed.
  </span>;
}

function ScopeOption({ name, value, checked, onSelect, label, disabled = false }: {
  readonly name: string; readonly value: 'general' | 'project'; readonly checked: boolean;
  readonly onSelect: (value: 'general' | 'project') => void; readonly label: string; readonly disabled?: boolean;
}) {
  return <label className="taste-segment" data-checked={checked || undefined}>
    <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onSelect(value)} />
    <span>{label}</span>
  </label>;
}

function RatingRow({ slot, name, disabled, onRate, labels, anchors }: {
  readonly slot: RatingSlot; readonly name: string; readonly disabled: boolean;
  readonly onRate: (value: RatingValue) => void;
  readonly labels?: Readonly<Record<RatingValue, string>>;
  readonly anchors?: readonly [string, string];
}) {
  const previous = slot.history.map((item) => item.value).join(', ');
  return <fieldset className="taste-row" disabled={disabled}>
    <legend>{slot.label}</legend>
    <div className="taste-scale">
      {anchors && <span className="taste-anchor" aria-hidden="true">{anchors[0]}</span>}
      {RATING_VALUES.map((value) => <label key={value} className="taste-point" data-checked={slot.current?.value === value || undefined}
        title={labels?.[value]}>
        <input type="radio" name={name} value={value} checked={slot.current?.value === value}
          aria-label={labels ? `${slot.label}: ${value}, ${labels[value]}` : `${slot.label}: ${value} of 5`}
          onChange={() => onRate(value)} />
        <span aria-hidden="true">{value}</span>
      </label>)}
      {anchors && <span className="taste-anchor" aria-hidden="true">{anchors[1]}</span>}
    </div>
    {slot.history.length > 0 && <span className="taste-history">Re-rated; earlier {previous}</span>}
  </fieldset>;
}

function NotesEditor({ disabled, slots, onNote, onCounterevidence }: {
  readonly disabled: boolean; readonly slots: readonly RatingSlot[];
  readonly onNote: (text: string) => Promise<void>;
  readonly onCounterevidence: (slot: RatingSlot, text: string) => Promise<void>;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [counter, setCounter] = useState('');
  const [slotKey, setSlotKey] = useState(slots[0]?.key ?? '');
  const slot = slots.find((item) => item.key === slotKey) ?? slots[0];
  return <section className="taste-notes" aria-labelledby={`${id}-notes`}>
    <h3 id={`${id}-notes`}>Notes</h3>
    <label htmlFor={`${id}-note`}>Note</label>
    <textarea id={`${id}-note`} value={note} disabled={disabled} rows={2} onChange={(event) => setNote(event.target.value)} />
    <button type="button" className="taste-button" disabled={disabled || !note.trim()}
      onClick={() => { void onNote(note).then(() => setNote('')); }}>Add note</button>

    <label htmlFor={`${id}-counter-target`}>Counterevidence against</label>
    <select id={`${id}-counter-target`} value={slot?.key ?? ''} disabled={disabled} onChange={(event) => setSlotKey(event.target.value)}>
      {slots.map((item) => <option key={item.key} value={item.key}>
        {item.judgment === 'liking' ? 'Liking' : 'Description'} · {item.label}
      </option>)}
    </select>
    <textarea aria-label="Counterevidence" value={counter} disabled={disabled} rows={2}
      onChange={(event) => setCounter(event.target.value)} />
    <button type="button" className="taste-button" disabled={disabled || !counter.trim() || !slot}
      onClick={() => { if (slot) void onCounterevidence(slot, counter).then(() => setCounter('')); }}>Add counterevidence</button>
  </section>;
}

function ProfileSummary({ profile, title, aspects }: {
  readonly profile: TasteProfile; readonly title: string; readonly aspects: readonly AspectDefinition[];
}) {
  const name = (summary: TasteProfile['summaries'][number]) => summary.target.kind === 'overall'
    ? 'Overall'
    : aspects.find((aspect) => summary.target.kind === 'aspect' && aspect.id === summary.target.aspect)?.label ?? summary.target.aspect;
  return <section className="taste-summary" aria-label={title}>
    <h3>{title}</h3>
    {profile.sample.label && <p className="taste-sample" data-limited="true">{profile.sample.label}</p>}
    {profile.scope.kind === 'general' && <p className="taste-muted">{profile.scope.includedProjects.length === 0
      ? 'No projects included.'
      : `Includes ${profile.scope.includedProjects.length} project${profile.scope.includedProjects.length === 1 ? '' : 's'} you chose.`}</p>}
    {profile.summaries.length === 0 ? <p className="taste-muted">No ratings yet.</p> : <dl>
      {profile.summaries.map((summary) => <div key={`${summary.judgment}:${name(summary)}`} className="taste-summary-row">
        <dt>{summary.judgment === 'liking' ? 'Liking' : 'Description'} · {name(summary)}</dt>
        <dd>
          <strong>{formatMean(summary.mean)}</strong> <span className="taste-muted">({summary.count} rating{summary.count === 1 ? '' : 's'})</span>
          {summary.counterevidence > 0 && <span className="taste-tag">{summary.counterevidence} counterevidence</span>}
          {summary.sample.label && <span className="taste-sample-inline">{summary.sample.label}</span>}
        </dd>
      </div>)}
    </dl>}
    {profile.importedExamples.count > 0 && <p className="taste-muted">
      {profile.importedExamples.count} imported example{profile.importedExamples.count === 1 ? '' : 's'} not counted.
    </p>}
  </section>;
}

function ExportControls({ client, scope }: { readonly client: TasteClientPort; readonly scope: TasteScope }) {
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeCounterevidence, setIncludeCounterevidence] = useState(false);
  const [result, setResult] = useState<ProfileExport | null>(null);
  const [failed, setFailed] = useState(false);
  return <section className="taste-export" aria-label="Export profile">
    <h4>Export profile</h4>
    <label className="taste-check"><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
      <span>Include notes</span></label>
    <label className="taste-check"><input type="checkbox" checked={includeCounterevidence}
      onChange={(event) => setIncludeCounterevidence(event.target.checked)} /><span>Include counterevidence</span></label>
    <button type="button" className="taste-button" onClick={async () => {
      try {
        setResult(await client.exportProfile({ scope, includeNotes, includeCounterevidence }));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }}>Export</button>
    {failed && <p className="taste-muted" role="alert">Export failed. Nothing was written.</p>}
    {result && <details className="taste-export-result">
      <summary>sha256 {result.digest.slice(0, 12)}… · omits {result.omitted.join(', ')}</summary>
      <pre>{result.json}</pre>
    </details>}
  </section>;
}
