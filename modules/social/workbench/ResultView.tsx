import type { CSSProperties } from 'react';
import { StatusChip } from '@hq/ui';
import type { ResultSummary, SummaryFact } from './results';

/** Only a plain count animates: dates, scores and free text keep their own text. */
const COUNTABLE = /^(\d{1,7})((?: records?| fields?)?)$/u;

function sentence(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * One summary tile. A whole-number value counts up from zero in CSS (`.sw-count`); the real number is also in the
 * DOM as text, so assistive technology and copy get the final value, and reduced motion shows it at once.
 */
function Tile({ fact }: { readonly fact: SummaryFact }) {
  const count = COUNTABLE.exec(fact.value);
  return (
    <div className="sx-tile">
      <dt className="sx-tile-label">{sentence(fact.label)}</dt>
      <dd className="sx-tile-value">
        {count ? (
          <>
            <span className="sw-count" style={{ '--sw-target': Number(count[1]) } as CSSProperties}>
              <span className="hq-sr-only">{count[1]}</span>
            </span>
            {count[2]}
          </>
        ) : fact.value}
      </dd>
    </div>
  );
}

/**
 * A finished run's result: summary tiles that count up, then the entries as a table whose rows stream in with a short
 * stagger. Everything shown comes from `summarizeRun`; the raw JSON stays one disclosure away on the receipt.
 */
export function ResultView({ summary }: { readonly summary: ResultSummary }) {
  const hasStatus = summary.entries.some((entry) => entry.status);
  return (
    <section className={`sw-result sw-result--${summary.kind}`} aria-label="Result summary">
      <h4 tabIndex={-1}>{summary.heading}</h4>
      {summary.error && <p className="sw-error">{summary.error}</p>}
      {summary.notices.map((notice) => <p key={notice} className="sw-note">{notice}</p>)}
      {summary.facts.length > 0 && (
        <dl className="sx-tiles sw-tiles">
          {summary.facts.map((fact) => <Tile key={fact.label} fact={fact} />)}
        </dl>
      )}
      {summary.draftText && summary.entries.length === 0 && <pre className="sw-draft-text">{summary.draftText}</pre>}
      {summary.entries.length > 0 && (
        <div className="sx-table-wrap sw-entries">
          <table className="sx-table">
            <caption className="hq-sr-only">{summary.heading}</caption>
            <thead>
              <tr>
                <th scope="col">{summary.entryLabel ?? 'Item'}</th>
                {hasStatus && <th scope="col">Result</th>}
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody className="sw-stream">
              {summary.entries.map((entry, index) => (
                <tr key={index} style={{ '--sw-i': index } as CSSProperties}>
                  <th scope="row" className="sw-rowhead">{entry.title}</th>
                  {hasStatus && <td>{entry.status ? <StatusChip tone={entry.status.tone} label={entry.status.label} /> : null}</td>}
                  <td>
                    {entry.detail && <p>{entry.detail}</p>}
                    {entry.meta && <p className="sw-hint">{entry.meta}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary.more > 0 && <p className="sw-hint">{summary.more} more in the raw result and the receipt download.</p>}
    </section>
  );
}
