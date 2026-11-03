import { useEffect, useId, useMemo, useState } from 'react';
import type { ReferenceEnvelope } from '@hq/contracts';
import { Button, StatusChip, referenceKey, type ReferencePort, type ReferenceResolution, type StatusTone } from '@hq/ui';
import { FEATURE_HQ_REFERENCES, hasFeature, isRunId, type Brand, type Draft, type WorkspaceSnapshot } from '../core';
import { EmptyState, SocialIcon } from '../ui';

const LINK_LIMIT = 6;
const OPENABLE = ['available', 'changed', 'archived'];

export interface LinkedAcrossHqProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly brand: Brand | null;
  /** The active HQ project. Links into any other project are read-only. */
  readonly projectId?: string;
  /** The shell's reference service: reads the owner's current state and opens a record in its own area. */
  readonly references?: ReferencePort;
  readonly navigate: (destination: string) => void;
}

interface Item { readonly key: string; readonly draft: Draft; readonly link: ReferenceEnvelope }

interface RowState {
  readonly tone: StatusTone;
  readonly label: string;
  /** Why Open is unavailable; null when it works. */
  readonly why: string | null;
}

const READ_ONLY = 'Another project: read-only. HQ stays in this project.';

function titleCase(status: string): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

const TONES: Readonly<Record<string, StatusTone>> = {
  available: 'success', changed: 'warning', archived: 'neutral', missing: 'danger', moved: 'info', forbidden: 'danger', unavailable: 'unavailable', unknown: 'unknown',
};

/**
 * Overview › Linked across HQ: the Design and Work records and Social runs that drafts link to. *Open* goes to the
 * record in its own area, with a way back to the Overview; it never starts anything. A link into another project is
 * shown but read-only. Only the status of a link is read here (through the reference service); nothing is written.
 */
export function LinkedAcrossHq({ snapshot, brand, projectId, references, navigate }: LinkedAcrossHqProps) {
  const id = useId();
  const supported = hasFeature(snapshot, FEATURE_HQ_REFERENCES);
  const items = useMemo<readonly Item[]>(() => snapshot.content
    .filter((draft) => draft.archived === 0 && (!brand || draft.brand_id === brand.id))
    .flatMap((draft) => (draft.links ?? []).map((link) => ({ key: `${draft.id}/${referenceKey(link)}`, draft, link }))), [snapshot, brand]);
  const shown = items.slice(0, LINK_LIMIT);
  const [resolved, setResolved] = useState<Readonly<Record<string, ReferenceResolution>>>({});
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [opening, setOpening] = useState<string | null>(null);

  const keys = shown.map((item) => item.key).join('|');
  useEffect(() => {
    if (!supported || !references) return;
    let current = true;
    void Promise.all(shown.map(async ({ key, link }): Promise<[string, ReferenceResolution]> => {
      if (projectId !== undefined && link.projectId !== projectId) return [key, { status: 'unknown', observedAt: new Date().toISOString() }];
      try { return [key, await references.resolve(link)]; }
      catch { return [key, { status: 'unavailable', observedAt: new Date().toISOString() }]; }
    })).then((pairs) => { if (current) setResolved(Object.fromEntries(pairs)); });
    return () => { current = false; };
    // `shown` changes with the snapshot and brand; the keys identify what to read.
  }, [supported, references, projectId, keys]);

  const runIds = useMemo(() => new Set(snapshot.runs.map((run) => run.id)), [snapshot]);
  const isSocialRun = (link: ReferenceEnvelope) => link.domain === 'social' && link.kind === 'run' && isRunId(link.entityId);

  const stateOf = ({ key, link }: Item): RowState => {
    if (projectId !== undefined && link.projectId !== projectId) return { tone: 'info', label: 'Another project', why: READ_ONLY };
    if (isSocialRun(link)) {
      // A Social run is in this workspace's own snapshot: no reference service is needed to read or open it.
      return runIds.has(link.entityId) ? { tone: 'success', label: 'Available', why: null } : { tone: 'unknown', label: 'Not checked', why: null };
    }
    const resolution = resolved[key];
    const target = resolution?.targetProjectId;
    if (resolution && (resolution.status === 'moved' || (target !== undefined && projectId !== undefined && target !== projectId))) {
      return { tone: 'info', label: 'Another project', why: READ_ONLY };
    }
    if (!references) return { tone: 'unknown', label: 'Not checked', why: "Opening needs the HQ reference service, which isn't connected here." };
    return resolution ? { tone: TONES[resolution.status] ?? 'unknown', label: titleCase(resolution.status), why: null } : { tone: 'unknown', label: 'Not checked', why: null };
  };

  const open = async (item: Item) => {
    const { key, link } = item;
    const say = (note: string) => setNotes((current) => ({ ...current, [key]: note }));
    if (isSocialRun(link)) { navigate(`runs/${link.entityId}`); return; }
    if (!references) return;
    setOpening(key);
    try {
      // Read the owner's current state right before opening, so a stale or moved record is never opened blindly.
      const resolution = await references.resolve(link);
      setResolved((current) => ({ ...current, [key]: resolution }));
      if (resolution.status === 'moved' || (resolution.targetProjectId !== undefined && projectId !== undefined && resolution.targetProjectId !== projectId)) say(READ_ONLY);
      else if (!OPENABLE.includes(resolution.status)) say(`Can't open it: its status is ${resolution.status}. Nothing was changed.`);
      else {
        say('');
        references.open(link, { label: 'Social overview', to: { domain: 'social', destination: 'overview' } });
      }
    } catch {
      say("Couldn't check this link, so nothing was opened.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className="sx-panel sd-card hq-lift" aria-labelledby={`${id}-title`}>
      <header className="sx-panel-head">
        <h2 id={`${id}-title`}>Linked across HQ</h2>
        {supported && items.length > 0 && <span className="hq-meta">{items.length} {items.length === 1 ? 'link' : 'links'}</span>}
      </header>
      {!supported ? (
        <p className="sd-muted"><StatusChip tone="unavailable" label="Not available" detail="needs Social service support (hq-references-v1)" /></p>
      ) : shown.length ? (
        <ul className="sx-list">
          {shown.map((item) => {
            const state = stateOf(item);
            const whyId = `${id}-${item.key.replace(/[^A-Za-z0-9]+/gu, '-')}-why`;
            const note = notes[item.key];
            return (
              <li key={item.key} className="sx-row sd-link-row">
                <span className="sx-mark" aria-hidden="true"><SocialIcon name="link" /></span>
                <span className="sx-row-main">
                  <span className="sx-row-title">{item.link.title}</span>
                  <span className="sx-row-meta">{item.link.domain} · {item.link.kind}{item.link.sourceRevision ? ` · as of ${item.link.sourceRevision}` : ''} · from “{item.draft.title}”</span>
                  {(state.why || note) && <span className="sd-fit-note" id={whyId} role={note ? 'status' : undefined}>{note || state.why}</span>}
                </span>
                <span className="sx-row-side">
                  <StatusChip tone={state.tone} label={state.label} />
                  <Button
                    size="sm" variant="secondary" disabled={state.why !== null && !isSocialRun(item.link)} aria-label={`Open ${item.link.title}`}
                    aria-describedby={state.why || note ? whyId : undefined} busy={opening === item.key} busyLabel="Checking" onClick={() => void open(item)}
                  >
                    Open
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon="link" title={`No drafts${brand ? ` of ${brand.name}` : ''} link to anything across HQ`} action={<Button size="sm" variant="secondary" onClick={() => navigate('library')}>Open Library</Button>}>
          Link a draft to a Design asset, a Work card or a run from its editor in the Library.
        </EmptyState>
      )}
      <p className="sx-panel-foot">
        {supported
          ? "Open goes to the record in its own area, with a way back here, and never starts anything. Links into another project are read-only: they're shown but can't be opened from here."
          : 'Links are shown as saved snapshots once the service supports HQ references.'}
      </p>
    </section>
  );
}
