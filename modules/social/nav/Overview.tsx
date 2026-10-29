import type { ReactNode } from 'react';
import { Button, StatusChip, type StatusTone } from '@hq/ui';
import { dateLabel, localToday } from '../content';
import {
  FEATURE_HQ_REFERENCES, hasFeature, isActiveRun, isDirty, isRunId,
  type Brand, type DraftEditor, type RunRecord, type WorkspaceLoad, type WorkspaceSnapshot,
} from '../core';
import { DELIVERED_LIMITS, startDraftRunId } from '../workbench';
import { Freshness, clockTime, isOffline, isStale } from './freshness';

export interface OverviewProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly load: WorkspaceLoad;
  readonly editors: Readonly<Record<string, DraftEditor>>;
  /** The selected brand, or null for all brands. */
  readonly brand: Brand | null;
  readonly navigate: (destination: string) => void;
  readonly now: () => Date;
  /** Reads the workspace again; a read never resends a run or a save. */
  readonly onCheck: () => void;
}

const LIST_LIMIT = 5;

/** Where an unsaved editor's text is shown: a Start draft on its run receipt, otherwise its Library editor. */
function editorDestination(key: string): string {
  const runId = startDraftRunId(key);
  return runId === null ? `library/${key}` : `runs/${runId}`;
}

export const CAPABILITIES: readonly { readonly name: string; readonly tone: StatusTone; readonly label: string; readonly detail: string }[] = [
  { name: 'Analysis', tone: 'success', label: 'Available', detail: 'eight workbenches, offline, on material you supply' },
  { name: 'Drafts & calendar', tone: 'success', label: 'Available', detail: 'planned dates are editorial labels only' },
  { name: 'Live collection', tone: 'unavailable', label: 'Not available', detail: 'HQ collects nothing' },
  { name: 'Accounts & posting', tone: 'unavailable', label: 'Not available', detail: 'no account connections; nothing is posted' },
];

function runStatus(run: RunRecord, offline: boolean): { tone: StatusTone; label: string } {
  // A run last seen queued or running while the service is unreachable has an unknown status (RX-5).
  if (offline && isActiveRun(run)) return { tone: 'unknown', label: 'Unknown' };
  switch (run.status) {
    case 'queued': return { tone: 'info', label: 'Queued' };
    case 'running': return { tone: 'info', label: 'Running' };
    case 'succeeded': return { tone: 'success', label: 'Succeeded' };
    case 'failed': return { tone: 'danger', label: 'Failed' };
    case 'interrupted': return { tone: 'warning', label: 'Interrupted' };
  }
}

function Card({ title, freshness, children }: { readonly title: string; readonly freshness?: ReactNode; readonly children: ReactNode }) {
  const id = `sd-card-${title.toLowerCase().replace(/[^a-z]+/gu, '-')}`;
  return (
    <section className="sd-card" aria-labelledby={id}>
      <header className="sd-card-head"><h2 id={id}>{title}</h2>{freshness}</header>
      {children}
    </section>
  );
}

/** Overview (RC-6): capability, coming up, needs attention, recent research and links across HQ, each with its freshness. */
export function Overview({ snapshot, load, editors, brand, navigate, now, onCheck }: OverviewProps) {
  const offline = isOffline(load);
  const fresh = <Freshness load={load} snapshot={snapshot} />;
  const inBrand = (brandId: string) => !brand || brandId === brand.id;
  const toolName = (run: RunRecord) => snapshot.tools.find((tool) => tool.id === run.tool)?.name ?? run.tool;
  const today = localToday(now());

  const comingUp = snapshot.content
    .filter((draft) => draft.archived === 0 && inBrand(draft.brand_id) && draft.planned_date !== '' && draft.planned_date >= today)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.title.localeCompare(b.title))
    .slice(0, LIST_LIMIT);

  const unsaved = Object.entries(editors)
    .filter(([key, editor]) => !key.startsWith('change:') && inBrand(editor.fields.brand_id) && (isDirty(editor) || editor.status !== 'editing'))
    .slice(0, LIST_LIMIT);
  const attentionRuns = snapshot.runs
    .filter((run) => run.status === 'failed' || run.status === 'interrupted' || (offline && isActiveRun(run)))
    .slice(0, LIST_LIMIT);

  const recent = snapshot.runs.slice(0, LIST_LIMIT);
  const references = hasFeature(snapshot, FEATURE_HQ_REFERENCES);
  const links = snapshot.content
    .filter((draft) => draft.archived === 0 && inBrand(draft.brand_id))
    .flatMap((draft) => (draft.links ?? []).map((link) => ({ draft, link })));

  const runRow = (run: RunRecord, note?: string) => {
    const status = runStatus(run, offline);
    return (
      <li key={run.id} className="sd-row">
        <button type="button" className="sd-row-main" onClick={() => navigate(`runs/${run.id}`)}>
          <strong>{toolName(run)}</strong>
          <span className="hq-meta">{clockTime(run.created_at)}{note ? ` · ${note}` : ''}</span>
        </button>
        {run.is_example === 1 && <span className="sd-tag">Example data</span>}
        <StatusChip tone={status.tone} label={status.label} />
      </li>
    );
  };

  return (
    <div className="sd-page">
      <header className="sd-page-head">
        <h1>Overview</h1>
        <p className="hq-meta">{brand ? brand.name : 'All brands'}</p>
        {isStale(load) && (
          <span className="sd-inline" role="status">
            <span>{isOffline(load) ? 'The Social service is unreachable.' : 'The workspace could not be refreshed.'} Showing the last synced data.</span>
            <Button size="sm" variant="secondary" onClick={onCheck}>Check again</Button>
          </span>
        )}
      </header>

      <section className="sd-capabilities" aria-label="What Social can do here">
        <ul>
          {CAPABILITIES.map((item) => (
            <li key={item.name}><span>{item.name}</span><StatusChip tone={item.tone} label={item.label} detail={item.detail} /></li>
          ))}
        </ul>
        <p className="sd-limits" role="note"><b>Delivered limits</b> {DELIVERED_LIMITS}</p>
      </section>

      <div className="sd-cards">
        <Card title="Coming up" freshness={fresh}>
          {comingUp.length ? (
            <ul className="sd-rows">
              {comingUp.map((draft) => (
                <li key={draft.id} className="sd-row">
                  <button type="button" className="sd-row-main" onClick={() => navigate(`library/${draft.id}`)}>
                    <strong>{draft.title}</strong>
                    <span className="hq-meta">{draft.channel} · planned {dateLabel(draft.planned_date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sd-empty">Nothing has a planned date from today on. <Button size="sm" variant="ghost" onClick={() => navigate('calendar')}>Open calendar</Button></p>
          )}
          <p className="hq-meta">Planned dates are editorial intent; nothing is posted.</p>
        </Card>

        <Card title="Needs attention" freshness={fresh}>
          {unsaved.length + attentionRuns.length ? (
            <ul className="sd-rows">
              {unsaved.map(([key, editor]) => (
                <li key={`editor-${key}`} className="sd-row">
                  <button type="button" className="sd-row-main" onClick={() => navigate(editorDestination(key))}>
                    <strong>{editor.fields.title || 'Untitled draft'}</strong>
                    <span className="hq-meta">{editor.status === 'conflict' ? 'Changed elsewhere' : 'Not saved yet'} · kept in this session</span>
                  </button>
                  <StatusChip tone="warning" label="Unsaved changes" />
                </li>
              ))}
              {attentionRuns.map((run) => runRow(run, offline && isActiveRun(run) ? "don't start it again until its status is known" : run.error ?? undefined))}
            </ul>
          ) : <p className="sd-empty">Nothing needs attention.</p>}
          <p className="hq-meta">Stale sources aren't tracked: the source registry is proposed.</p>
        </Card>

        <Card title="Recent research" freshness={fresh}>
          {recent.length ? <ul className="sd-rows">{recent.map((run) => runRow(run))}</ul> : (
            <p className="sd-empty">No runs yet. <Button size="sm" variant="ghost" onClick={() => navigate('workbenches')}>Open workbenches</Button></p>
          )}
          <p className="hq-meta">Runs are not tied to a brand; this lists the workspace's latest runs.</p>
        </Card>

        <Card title="Linked across HQ" freshness={references ? fresh : undefined}>
          {!references ? (
            <p className="sd-empty"><StatusChip tone="unavailable" label="Not available" detail="needs Social service support (hq-references-v1)" /></p>
          ) : links.length ? (
            <ul className="sd-rows">
              {links.map(({ draft, link }) => {
                const inSocial = link.domain === 'social' && link.kind === 'run' && isRunId(link.entityId);
                return (
                  <li key={`${draft.id}/${link.domain}/${link.kind}/${link.entityId}`} className="sd-row">
                    <span className="sd-row-main sd-row-static">
                      <strong>{link.title}</strong>
                      <span className="hq-meta">{link.domain} · {link.kind}{link.sourceRevision ? ` · as of ${link.sourceRevision}` : ''} · from “{draft.title}”</span>
                    </span>
                    <StatusChip tone="unknown" label="Not checked" detail="the owner's current state isn't read yet" />
                    {inSocial && <Button size="sm" variant="ghost" onClick={() => navigate(`runs/${link.entityId}`)}>Open run</Button>}
                  </li>
                );
              })}
            </ul>
          ) : <p className="sd-empty">No drafts{brand ? ` of ${brand.name}` : ''} link to anything across HQ.</p>}
          <p className="hq-meta">Links are shown as saved snapshots. Opening Design or Work records from here arrives with HQ references.</p>
        </Card>
      </div>
    </div>
  );
}
