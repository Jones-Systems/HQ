import { useId } from 'react';
import { Button, StatusChip, useListMotion, type ReferencePort, type StatusTone } from '@hq/ui';
import { localToday, parseContentDestination } from '../content';
import { isActiveRun, isRunId, type Brand, type DraftEditor, type RunRecord, type WorkspaceLoad, type WorkspaceSnapshot } from '../core';
import { ChannelBadge, EmptyState, PageHeader, SocialIcon, useSocialFrame, type SocialIconName } from '../ui';
import { DELIVERED_LIMITS } from '../workbench';
import { brandInitials } from './BrandSwitcher';
import { Freshness, isOffline } from './freshness';
import { LinkedAcrossHq } from './LinkedAcrossHq';
import {
  ATTENTION_LIMIT, attentionItems, dateParts, LIST_LIMIT, nextUp, plannedLabel, relativeDay, unsavedLabel, whenLabel, type AttentionItem,
} from './overview-model';
import './pages.css';

export interface OverviewProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly load: WorkspaceLoad;
  readonly editors: Readonly<Record<string, DraftEditor>>;
  /** The selected brand, or null for all brands. */
  readonly brand: Brand | null;
  readonly navigate: (destination: string) => void;
  readonly now: () => Date;
  /** The active HQ project. Links into any other project are read-only. */
  readonly projectId?: string;
  /** The shell's reference service, used by *Open* in Linked across HQ. */
  readonly references?: ReferencePort;
}

export const CAPABILITIES: readonly { readonly name: string; readonly tone: StatusTone; readonly label: string; readonly detail: string }[] = [
  { name: 'Analysis', tone: 'success', label: 'Available', detail: 'on material you supply' },
  { name: 'Drafts & calendar', tone: 'success', label: 'Available', detail: 'dates are editorial only' },
  { name: 'Live collection', tone: 'unavailable', label: 'Not available', detail: 'HQ collects nothing' },
  { name: 'Accounts & posting', tone: 'unavailable', label: 'Not available', detail: 'nothing is posted' },
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

/**
 * Where an unsaved editor's text is shown: its Library page when the key is a draft (or `new`); for a key that names a
 * run (`<kind>:<runId>`, a draft started from a result) that run's receipt; otherwise the Library, which lists drafts.
 */
function editorDestination(key: string): string {
  if (parseContentDestination(`library/${key}`)) return `library/${key}`;
  const runId = key.split(':')[1];
  return runId !== undefined && isRunId(runId) ? `runs/${runId}` : 'library';
}

const ATTENTION_ICONS: { readonly [K in AttentionItem['kind']]: { readonly icon: SocialIconName; readonly tone: StatusTone } } = {
  unsaved: { icon: 'file', tone: 'warning' },
  failed: { icon: 'alert', tone: 'danger' },
  interrupted: { icon: 'clock', tone: 'warning' },
  unknown: { icon: 'offline', tone: 'unknown' },
};

/**
 * Overview (RC-6): the selected brand, what Social can do here, what is next, what needs attention, recent research
 * and links across HQ. The page header's sync pill carries freshness and the example-workspace note, and the frame's
 * bar under the title says what is paused while the service is unreachable, so the page repeats none of them;
 * mounted on its own it shows one freshness line itself.
 */
export function Overview({ snapshot, load, editors, brand, navigate, now, projectId, references }: OverviewProps) {
  const id = useId();
  const framed = useSocialFrame() !== null;
  const offline = isOffline(load);
  const clock = now();
  const today = localToday(clock);
  const toolOf = (run: RunRecord) => snapshot.tools.find((tool) => tool.id === run.tool);

  const upcoming = nextUp(snapshot.content, brand?.id ?? null, today);
  const attention = attentionItems(snapshot, editors, brand?.id ?? null, offline);
  const attentionShown = attention.slice(0, ATTENTION_LIMIT);
  const recent = snapshot.runs.slice(0, LIST_LIMIT);

  const nextRef = useListMotion<HTMLUListElement>(upcoming.drafts.map((draft) => draft.id));
  const attentionRef = useListMotion<HTMLUListElement>(attentionShown.map((item) => (item.kind === 'unsaved' ? item.key : `${item.kind}:${item.run.id}`)));
  const recentRef = useListMotion<HTMLUListElement>(recent.map((run) => run.id));

  const runRow = (run: RunRecord, note?: string, mark?: { readonly icon: SocialIconName; readonly tone: StatusTone }) => {
    const tool = toolOf(run);
    const status = runStatus(run, offline);
    return (
      <button type="button" className="sx-row sd-row" onClick={() => navigate(`runs/${run.id}`)}>
        {mark
          ? <span className="sx-mark sd-mark" aria-hidden="true" data-tone={mark.tone}><SocialIcon name={mark.icon} /></span>
          : <span className="sx-mark" aria-hidden="true">{tool?.mark ?? '··'}</span>}
        <span className="sx-row-main">
          <span className="sx-row-title">{tool?.name ?? run.tool}</span>
          <span className="sx-row-meta sd-wrap">{whenLabel(run.created_at, clock)}{note ? ` · ${note}` : ''}</span>
        </span>
        <span className="sx-row-side">
          {run.is_example === 1 && <span className="sx-tag sx-tag--example">Example data</span>}
          <StatusChip tone={status.tone} label={status.label} />
        </span>
      </button>
    );
  };

  return (
    <div className="sx-page sd-overview">
      <PageHeader
        title="Overview"
        description={
          <>
            <span className="sd-avatar" aria-hidden="true" data-all={brand ? undefined : ''}>{brand ? brandInitials(brand.name) : <SocialIcon name="brands" />}</span>
            {brand ? brand.name : 'All brands'}
          </>
        }
        actions={<Button variant="primary" onClick={() => navigate('library/new')}><SocialIcon name="plus" />New draft</Button>}
      >
        {!framed && <span className="sd-inline"><Freshness load={load} snapshot={snapshot} /></span>}
      </PageHeader>

      <div className="sx-grid sx-grid--2 sd-overview-grid hq-stagger">
        <section className="sd-capabilities" aria-label="What Social can do here">
          <ul>
            {CAPABILITIES.map((item) => (
              <li key={item.name}><span>{item.name}</span><StatusChip tone={item.tone} label={item.label} detail={item.detail} /></li>
            ))}
          </ul>
          <p className="sd-limits" role="note"><b>Delivered limits</b> {DELIVERED_LIMITS}</p>
        </section>

        <section className="sx-panel sd-card hq-lift" aria-labelledby={`${id}-next`}>
          <header className="sx-panel-head">
            <h2 id={`${id}-next`}>Next up</h2>
            {upcoming.past && <span className="sx-tag">Past</span>}
            <Button size="sm" variant="ghost" onClick={() => navigate('calendar')}>Calendar<SocialIcon name="arrow-right" /></Button>
          </header>
          {upcoming.drafts.length ? (
            <ul className="sx-list" ref={nextRef}>
              {upcoming.drafts.map((draft) => {
                const { weekday, day, month } = dateParts(draft.planned_date);
                return (
                  <li key={draft.id} data-hq-motion-key={draft.id}>
                    <button type="button" className="sx-row sd-row" onClick={() => navigate(`library/${draft.id}`)}>
                      <span className="sd-date" aria-hidden="true" data-past={upcoming.past ? '' : undefined}><span>{weekday}</span><b>{day}</b><span>{month}</span></span>
                      <span className="sx-row-main">
                        <span className="sx-row-title">{draft.title}</span>
                        <span className="sx-row-meta"><ChannelBadge channel={draft.channel} label /> planned {plannedLabel(draft.planned_date, today)} · {relativeDay(draft.planned_date, today)}</span>
                      </span>
                      <SocialIcon name="chevron-right" className="sd-row-arrow" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="calendar" title="Nothing has a planned date" action={<Button size="sm" variant="secondary" onClick={() => navigate('calendar')}>Open calendar</Button>}>
              Plan a draft on the calendar and it shows up here.
            </EmptyState>
          )}
          <p className="sx-panel-foot">
            {upcoming.past ? 'Nothing is planned from today on, so these are the nearest past dates. ' : ''}Planned dates are editorial intent; nothing is posted.
          </p>
        </section>

        <section className="sx-panel sd-card hq-lift" aria-labelledby={`${id}-attention`}>
          <header className="sx-panel-head">
            <h2 id={`${id}-attention`}>Needs attention</h2>
            {attention.length > 0 && <span className="hq-meta">{attention.length}</span>}
          </header>
          {attentionShown.length ? (
            <ul className="sx-list" ref={attentionRef}>
              {attentionShown.map((item) => {
                const mark = ATTENTION_ICONS[item.kind];
                const motionKey = item.kind === 'unsaved' ? item.key : `${item.kind}:${item.run.id}`;
                if (item.kind === 'unsaved') {
                  const label = unsavedLabel(item.editor, item.save);
                  return (
                    <li key={motionKey} data-hq-motion-key={motionKey}>
                      <button type="button" className="sx-row sd-row" onClick={() => navigate(editorDestination(item.key))}>
                        <span className="sx-mark sd-mark" aria-hidden="true" data-tone={mark.tone}><SocialIcon name={mark.icon} /></span>
                        <span className="sx-row-main">
                          <span className="sx-row-title">{item.editor.fields.title || 'Untitled draft'}</span>
                          <span className="sx-row-meta sd-wrap">{label.meta}</span>
                        </span>
                        <span className="sx-row-side"><StatusChip tone={label.tone} label={label.label} /></span>
                      </button>
                    </li>
                  );
                }
                const note = item.kind === 'unknown' ? "don't start it again until its status is known" : item.run.error ?? undefined;
                return (
                  <li key={motionKey} data-hq-motion-key={motionKey}>{runRow(item.run, note, mark)}</li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="check" title="Nothing needs attention">Unsaved drafts and failed or interrupted runs show up here.</EmptyState>
          )}
          <p className="sx-panel-foot">
            {attention.length > attentionShown.length ? `${attention.length - attentionShown.length} more in Run history and the Library. ` : ''}
            Stale sources aren't tracked: the source registry is proposed.
          </p>
        </section>

        <section className="sx-panel sd-card hq-lift" aria-labelledby={`${id}-recent`}>
          <header className="sx-panel-head">
            <h2 id={`${id}-recent`}>Recent research</h2>
            <Button size="sm" variant="ghost" onClick={() => navigate('runs')}>All runs<SocialIcon name="arrow-right" /></Button>
          </header>
          {recent.length ? (
            <ul className="sx-list" ref={recentRef}>{recent.map((run) => <li key={run.id} data-hq-motion-key={run.id}>{runRow(run)}</li>)}</ul>
          ) : (
            <EmptyState icon="workbenches" title="No runs yet" action={<Button size="sm" variant="secondary" onClick={() => navigate('workbenches')}>Open workbenches</Button>}>
              Run a workbench on material you supply and its result shows up here.
            </EmptyState>
          )}
          <p className="sx-panel-foot">Runs are not tied to a brand; this lists the workspace's latest runs.</p>
        </section>

        <LinkedAcrossHq
          snapshot={snapshot} brand={brand} navigate={navigate}
          {...(projectId !== undefined ? { projectId } : {})} {...(references ? { references } : {})}
        />
      </div>
    </div>
  );
}
