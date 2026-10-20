import { SecondaryPanel } from '../../ui/src/secondary-panels.tsx';
import { useId } from 'react';
import { IconButton } from '@hq/ui';
import type { CaptureId, SubjectId } from '../src/graph-contract.ts';
import type { CaptureRow, GraphViewModel, SubjectRow } from './graph-view-model.ts';
import './references.css';

export interface ReferenceGraphActions {
  readonly onSelectSubject: (id: SubjectId | null) => void;
  readonly onSelectCapture: (id: CaptureId) => void;
  readonly onPinCapture: (id: CaptureId) => void;
  readonly onReload: () => void;
}

export interface ReferenceGraphViewProps extends ReferenceGraphActions {
  readonly view: GraphViewModel;
}

/** Presentational graph browser. Every action is explicit and local; none dispatches work. */
export function ReferenceGraphView(props: ReferenceGraphViewProps) {
  const { view } = props;
  const titleId = useId();
  return <section className="hq-refs hq-graph" aria-labelledby={titleId}>
    <header className="hq-refs-header">
      <div className="hq-refs-heading">
        <span className="eyebrow">Design</span>
        <h2 id={titleId}>Reference graph</h2>
        <p className="hq-refs-count">{view.rows.length} {view.rows.length === 1 ? 'subject' : 'subjects'}</p>
      </div>
    </header>
    {view.banner === null ? null : <div className="hq-refs-banner" role="status">
      <span>{view.banner}</span>
      <button type="button" onClick={props.onReload}>Reload</button>
    </div>}
    {view.emptyMessage !== null ? <p className="hq-refs-empty">{view.emptyMessage}</p> : <div className="hq-graph-body">
      <ul className="hq-graph-tree" aria-label="Sites, apps and their screens">
        {view.rows.map((row) => <li key={row.id} style={{ paddingLeft: `${row.depth * 16}px` }}><Row row={row} onSelectSubject={props.onSelectSubject} /></li>)}
      </ul>
      {view.detail === null ? <p className="hq-refs-muted">Select a site, page, app, flow or screen.</p> : <SecondaryPanel name="reference-graph-detail" label="Subject details" initial={340}><aside className="hq-refs-detail hq-graph-detail" aria-label="Subject details">
        <div className="hq-refs-detail-head">
          <h3>{view.detail.subject.title}</h3>
          <IconButton size="sm" label="Close subject details" icon="×" onClick={() => props.onSelectSubject(null)} />
        </div>
        <p className="hq-refs-muted">{view.detail.subject.kindLabel}{view.detail.subject.rating === null ? '' : ` · Rated ${view.detail.subject.rating} of 5`}</p>
        <h4>Captures, newest first</h4>
        {view.detail.captures.length === 0 ? <p className="hq-refs-muted">No captures yet.</p>
          : <ul className="hq-graph-captures">{view.detail.captures.map((capture) => <li key={capture.id}><CaptureItem capture={capture} {...props} /></li>)}</ul>}
        {view.detail.anchors.length === 0 ? null : <>
          <h4>Sections and elements</h4>
          <ul className="hq-graph-anchors" aria-label="Anchors of the selected capture">
            {view.detail.anchors.map((anchor) => <li key={anchor.id} style={{ paddingLeft: `${anchor.depth * 12}px` }}>
              <span className="hq-refs-badge">{anchor.kindLabel}</span> {anchor.label}
            </li>)}
          </ul>
        </>}
      </aside></SecondaryPanel>}
    </div>}
  </section>;
}

function Row({ row, onSelectSubject }: { row: SubjectRow; onSelectSubject: ReferenceGraphActions['onSelectSubject'] }) {
  return <button type="button" className="hq-graph-row" aria-current={row.selected ? 'true' : undefined} onClick={() => onSelectSubject(row.id)}>
    <span className="hq-refs-badge">{row.kindLabel}</span>
    <span className="hq-graph-title">{row.title}</span>
    <span className="hq-refs-muted">{row.detail}</span>
    {row.captureCount === 0 ? null : <span className="hq-refs-muted">{row.captureCount} {row.captureCount === 1 ? 'capture' : 'captures'}</span>}
    {row.availability === null ? null : <span className={`hq-refs-badge hq-graph-avail-${row.availability.label}`}>{row.availability.text}</span>}
  </button>;
}

function CaptureItem({ capture, view, onSelectCapture, onPinCapture }: { capture: CaptureRow } & ReferenceGraphViewProps) {
  const project = view.currentProject;
  return <article className="hq-refs-card" aria-current={capture.selected ? 'true' : undefined}>
    <button type="button" className="hq-refs-open" onClick={() => onSelectCapture(capture.id)}>
      <h3>{capture.capturedAt}{capture.isLatest ? ' · latest' : ''}</h3>
      <p className="hq-refs-source">{capture.evidenceLabel}{capture.producer === null ? '' : ` · ${capture.producer}`}</p>
    </button>
    <p className="hq-refs-badges">
      <span className={`hq-refs-badge hq-graph-avail-${capture.availability.label}`}>{capture.availability.text}</span>
      <span className={capture.rights.publishable ? 'hq-refs-badge hq-refs-ok' : 'hq-refs-badge hq-refs-warn'}>{capture.rights.label}</span>
    </p>
    {capture.caveat === null ? null : <p className="hq-refs-caveat">{capture.caveat}</p>}
    <button type="button" className="hq-refs-use" disabled={project === null || capture.pinnedInCurrentProject || !view.canEdit}
      onClick={() => onPinCapture(capture.id)}>
      {project === null ? 'Open a project to pin' : capture.pinnedInCurrentProject ? `Pinned in ${project.name}` : `Pin this capture in ${project.name}`}
    </button>
  </article>;
}
