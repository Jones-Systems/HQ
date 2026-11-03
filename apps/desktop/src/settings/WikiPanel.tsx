import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, InlineNotice, Presence, Skeleton, StateView, StatusIndicator, useToast } from '@hq/ui';
import type { WikiAdminNamespace, WikiAdminResult, WikiAdminStatus, WikiAdminTransport, WikiSelection } from '@hq/contracts/wiki-admin';
import { useSettingsActions, type Outcome } from './actions';
import { ActionButton, ChipStatus, Disclosure, FailureNotice, Icon, Panel, RotateLabel, Row, SettingsHeading, closeOnEscape } from './parts';
import { WIKI_NAMES, WIKI_NAMESPACES, wikiRowChip, wikiRowDetail } from './status';

const POLL_MS = 2000;
export const POLL_LIMIT_MS = 120_000;
const UNAVAILABLE_WINDOW = "Native Wiki management isn't available in this window.";
const changed = () => window.dispatchEvent(new Event('hq-connections-changed'));

type Kind = Extract<WikiAdminResult<unknown>, { ok: false }>['kind'];
/** Plain words for a refused Wiki request. Nothing was changed by any of these. */
function refused(kind: Kind, what: string, recheck: () => void): Outcome {
  switch (kind) {
    case 'conflict': return { ok: false, title: `Couldn't ${what}`, detail: 'The Wiki configuration changed. Nothing was changed. Recheck, then choose the source again.', check: recheck };
    case 'source-unavailable': return { ok: false, title: `Couldn't ${what}`, detail: 'The repository could not be read. Check that the selected bare repository matches the profile’s remote and branch. Nothing was changed.' };
    case 'invalid': return { ok: false, title: `Couldn't ${what}`, detail: 'That profile or repository was not accepted. Import or choose the source again. Nothing was changed.' };
    default: return { ok: false, title: `Couldn't ${what}`, detail: 'Wiki management did not answer. Nothing was changed. Recheck, then try again.', check: recheck };
  }
}

/** Setup for the Local Wiki and one row per repository: Reindex, Change repository…, Remove…. */
export function WikiPanel({ headingId, admin, selected }: { headingId: string; admin?: WikiAdminTransport; selected: boolean }) {
  const toast = useToast();
  const actions = useSettingsActions();
  const [status, setStatus] = useState<WikiAdminStatus>();
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>(admin ? 'loading' : 'ready');
  const [selection, setSelection] = useState<WikiSelection>();
  const [confirm, setConfirm] = useState<WikiAdminNamespace>();
  const [stalled, setStalled] = useState(false);
  const [pollRun, setPollRun] = useState(0);
  const latest = useRef<WikiAdminStatus | undefined>(undefined);
  const lastSelection = useRef<WikiSelection | undefined>(undefined);
  if (selection) lastSelection.current = selection;
  const { flash, fail } = actions;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Takes a status from the host, announces repositories that just finished indexing, and tells the shell. */
  const apply = useCallback((next: WikiAdminStatus, announce = true) => {
    const previous = latest.current;
    latest.current = next;
    if (!alive.current) return;
    setStatus(next);
    setLoad('ready');
    if (!previous) return;
    let differs = previous.sources.length !== next.sources.length;
    for (const source of next.sources) {
      const before = previous.sources.find(item => item.namespace === source.namespace)?.state;
      if (before !== source.state) differs = true;
      if (!announce || before !== 'indexing' || source.state === 'indexing') continue;
      const name = WIKI_NAMES[source.namespace];
      if (source.state === 'ready') { flash(source.namespace); toast.success(`${name} reindexed`); }
      else {
        const detail = 'The index could not be completed. Check the repository, then reindex.';
        fail(source.namespace, { title: `Couldn't finish indexing ${name}`, detail, tone: 'danger' });
        toast.error(`Couldn't finish indexing ${name}`, { description: detail });
      }
    }
    if (differs) changed();
  }, [flash, fail, toast]);

  const refresh = useCallback(async () => {
    if (!admin) return;
    setLoad(current => latest.current ? current : 'loading');
    try {
      const result = await admin.call('status', {});
      if (!alive.current) return;
      if (result.ok) apply(result.value); else if (!latest.current) setLoad('failed');
    } catch { if (alive.current && !latest.current) setLoad('failed'); }
  }, [admin, apply]);
  useEffect(() => { void refresh(); }, [refresh]);

  // While any repository is indexing, read the status every two seconds: until none is, the page closes, or two minutes pass.
  const indexing = status?.sources.some(source => source.state === 'indexing') ?? false;
  useEffect(() => {
    if (!admin || !indexing) return;
    setStalled(false);
    let live = true, reading = false;
    const timer = window.setInterval(() => {
      if (reading) return;
      reading = true;
      void admin.call('status', {}).then(result => { if (live && result.ok) apply(result.value); }, () => undefined).finally(() => { reading = false; });
    }, POLL_MS);
    const stop = window.setTimeout(() => { window.clearInterval(timer); if (live) setStalled(true); }, POLL_LIMIT_MS);
    return () => { live = false; window.clearInterval(timer); window.clearTimeout(stop); };
  }, [admin, indexing, apply, pollRun]);

  const recheck = (): Promise<boolean> => actions.run({
    id: 'recheck', row: 'panel', lost: "Couldn't recheck the Local Wiki", check: () => { void recheck(); },
    work: async () => {
      if (!admin) return { ok: false, title: "Couldn't recheck the Local Wiki", detail: UNAVAILABLE_WINDOW };
      setSelection(undefined);
      const result = await admin.call('recheck', {});
      if (!result.ok) return refused(result.kind, 'recheck the Local Wiki', () => { void recheck(); });
      apply(result.value, false); setStalled(false); setPollRun(value => value + 1);
      return { ok: true, toast: { title: 'Local Wiki rechecked' } };
    },
  });
  const importProfile = () => actions.run({
    id: 'import', row: 'panel', lost: "Couldn't import the source profile",
    work: async () => {
      if (!admin) return { ok: false, title: "Couldn't import the source profile", detail: UNAVAILABLE_WINDOW };
      const result = await admin.call('importProfile', {});
      if (!result.ok) return refused(result.kind, 'import the source profile', () => { void refresh(); });
      if (result.value) setSelection(result.value);
      return { ok: true };
    },
  });
  const chooseRepository = (namespace: WikiAdminNamespace, token?: string) => actions.run({
    id: `choose:${namespace}`, row: namespace, lost: `Couldn't choose a repository for ${WIKI_NAMES[namespace]}`,
    work: async () => {
      if (!admin) return { ok: false, title: "Couldn't choose a repository", detail: UNAVAILABLE_WINDOW };
      const result = await admin.call('chooseRepository', token ? { namespace, token } : { namespace });
      if (!result.ok) { setSelection(undefined); return refused(result.kind, `choose a repository for ${WIKI_NAMES[namespace]}`, () => { void refresh(); }); }
      if (result.value) setSelection(result.value);
      return { ok: true };
    },
  });
  const saveSource = (chosen: WikiSelection) => actions.run({
    id: `save:${chosen.namespace}`, row: chosen.namespace, lost: `Couldn't confirm ${WIKI_NAMES[chosen.namespace]} was saved`, check: () => { void recheck(); },
    work: async () => {
      if (!admin || !status) return { ok: false, title: `Couldn't save ${WIKI_NAMES[chosen.namespace]}`, detail: UNAVAILABLE_WINDOW };
      const result = await admin.call('saveSource', { expectedRevision: status.revision, token: chosen.token });
      setSelection(undefined);
      if (!result.ok) return refused(result.kind, `save ${WIKI_NAMES[chosen.namespace]}`, () => { void recheck(); });
      apply(result.value, false); setStalled(false); setPollRun(value => value + 1);
      const state = result.value.sources.find(source => source.namespace === chosen.namespace)?.state;
      return { ok: true, toast: { title: `${WIKI_NAMES[chosen.namespace]} saved`, ...(state === 'indexing' ? { meta: 'Indexing now' } : {}) } };
    },
  });
  const removeSource = (namespace: WikiAdminNamespace) => actions.run({
    id: `remove:${namespace}`, row: namespace, lost: `Couldn't confirm ${WIKI_NAMES[namespace]} was removed`, check: () => { void recheck(); },
    work: async () => {
      if (!admin || !status) return { ok: false, title: `Couldn't remove ${WIKI_NAMES[namespace]}`, detail: UNAVAILABLE_WINDOW };
      const result = await admin.call('removeSource', { namespace, expectedRevision: status.revision, confirmed: true });
      setConfirm(undefined); setSelection(undefined);
      if (!result.ok) return refused(result.kind, `remove ${WIKI_NAMES[namespace]}`, () => { void recheck(); });
      apply(result.value, false);
      return { ok: true, toast: { title: `${WIKI_NAMES[namespace]} removed`, description: 'Repository files remain on disk.' } };
    },
  });
  const reindex = (namespace: WikiAdminNamespace) => actions.run({
    id: `reindex:${namespace}`, row: namespace, lost: `Couldn't confirm ${WIKI_NAMES[namespace]} started indexing`, check: () => { void recheck(); },
    work: async () => {
      if (!admin) return { ok: false, title: `Couldn't reindex ${WIKI_NAMES[namespace]}`, detail: UNAVAILABLE_WINDOW };
      const result = await admin.call('reindex', { namespace });
      if (!result.ok) return refused(result.kind, `reindex ${WIKI_NAMES[namespace]}`, () => { void recheck(); });
      apply(result.value, false); setStalled(false); setPollRun(value => value + 1);
      const state = result.value.sources.find(source => source.namespace === namespace)?.state;
      if (state === 'indexing') return { ok: true };
      if (state === 'ready') return { ok: true, toast: { title: `${WIKI_NAMES[namespace]} reindexed` } };
      return { ok: false, title: `Couldn't reindex ${WIKI_NAMES[namespace]}`, detail: 'The index could not be rebuilt. Check the repository, then try again.', retry: true };
    },
  });

  const reasonFor = (id: string) => admin ? actions.blocked(id) : UNAVAILABLE_WINDOW;
  const sources = status?.sources ?? (admin ? [] : WIKI_NAMESPACES.map(namespace => ({ namespace, state: 'source-unavailable' as const })));
  const nothingSetUp = Boolean(status) && status!.sources.every(source => source.state === 'not-configured');
  const importButton = <ActionButton size="sm" variant={nothingSetUp ? 'primary' : 'secondary'} busy={actions.pendingId === 'import'} busyLabel="Importing" reason={reasonFor('import')} onClick={() => void importProfile()}>Import source profile…</ActionButton>;
  const recheckWorking = actions.pendingId === 'recheck';

  return <>
    <SettingsHeading id={headingId} title="Local Wiki" actions={<>
      {!nothingSetUp && importButton}
      <ActionButton size="sm" working={recheckWorking} reason={reasonFor('recheck')} onClick={() => void recheck()} aria-label="Recheck Local Wiki sources"><RotateLabel busy={recheckWorking} label="Recheck" busyLabel="Rechecking" /></ActionButton>
    </>}>Search and read your own Git repositories. Each repository is indexed on this device.</SettingsHeading>

    <Presence show={!admin} motion="collapse" initial={false}><InlineNotice variant="bar" tone="warning" live="off" title={UNAVAILABLE_WINDOW} /></Presence>
    <FailureNotice failure={actions.failures.panel} onDismiss={() => actions.dismiss('panel')} />

    {admin && load === 'failed' ? <StateView state="unavailable" title="Local Wiki settings are unavailable" description="HQ could not read the Wiki configuration. Nothing was changed."
      action={{ label: 'Try again', onAction: () => void refresh() }} /> : <>
      {admin && nothingSetUp && <Panel className="settings-guide" role="group" aria-label="Set up Local Wiki">
        <div className="settings-guide-body">
          <h3>Set up your first repository</h3>
          <ol>
            <li><b>Import a source profile.</b> A JSON file that names the repository’s remote, branch and field mappings.</li>
            <li><b>Choose the repository.</b> Pick the local bare Git repository it describes. Paths stay in the native app.</li>
            <li><b>Save the source.</b> HQ builds the search index, then the Wiki opens on it.</li>
          </ol>
          <div className="settings-form-actions">{importButton}</div>
        </div>
      </Panel>}
      <Panel id="settings-wiki" role="group" aria-label="Local Wiki repositories" className={selected ? 'is-target' : undefined} busy={load === 'loading'}>
        {load === 'loading' ? [0, 1].map(index => <Row key={index} title={<Skeleton width="140px" />} description={<Skeleton width="50%" />} status={<Skeleton width="72px" />} />)
          : sources.map(source => {
            const namespace = source.namespace, name = WIKI_NAMES[namespace];
            const pendingHere = actions.pendingId?.endsWith(`:${namespace}`) ? actions.pendingId.split(':')[0] : undefined;
            const chip = pendingHere === 'reindex' ? { tone: 'neutral' as const, label: 'Reindexing', busy: true }
              : pendingHere === 'remove' ? { tone: 'neutral' as const, label: 'Removing', busy: true } : wikiRowChip(source.state);
            const configured = source.state !== 'not-configured' && admin;
            const chosen = selection?.namespace === namespace ? selection : undefined;
            const kept = chosen ?? (lastSelection.current?.namespace === namespace ? lastSelection.current : undefined);
            return <Row key={namespace} id={`wiki-${namespace}`} icon="wiki" flash={actions.flashes[namespace] ?? 0}
              title={<>{name} <span className="settings-row-id">{namespace}</span></>}
              description={admin ? wikiRowDetail(source.state) : 'Native management is needed to read this repository.'}
              status={stalled && source.state === 'indexing' && !pendingHere
                ? <StatusIndicator tone="unknown" label="Still indexing" detail="not updating" live={false} action={{ label: 'Check', onAction: () => void recheck() }} />
                : <ChipStatus chip={chip} />}
              control={configured || !admin ? <>
                <ActionButton size="sm" working={pendingHere === 'reindex'} reason={reasonFor(`reindex:${namespace}`)} aria-label={`Reindex ${name}`} onClick={() => void reindex(namespace)}><RotateLabel busy={pendingHere === 'reindex'} label="Reindex" busyLabel="Reindexing" /></ActionButton>
                <ActionButton size="sm" variant="ghost" reason={reasonFor(`choose:${namespace}`)} aria-label={`Change repository for ${name}`} onClick={() => void chooseRepository(namespace)}>Change repository…</ActionButton>
                <ActionButton size="sm" variant="ghost" aria-expanded={confirm === namespace} reason={reasonFor(`remove:${namespace}`)} aria-label={`Remove ${name}…`} onClick={() => setConfirm(value => value === namespace ? undefined : namespace)}>Remove…</ActionButton>
              </> : <ActionButton size="sm" reason={reasonFor('import')} aria-label={`Set up ${name}`} onClick={() => void importProfile()}>Set up…</ActionButton>}>
              <FailureNotice failure={actions.failures[namespace]} onDismiss={() => actions.dismiss(namespace)} />
              <Disclosure open={Boolean(chosen)} id={`wiki-selection-${namespace}`} label={`Selected repository for ${name}`}>
                {kept && <div className="settings-form">
                  <p className="settings-selection"><Icon name="projects" />Selected {name}: {kept.label}</p>
                  <div className="settings-form-actions">
                    <ActionButton size="sm" variant="primary" busy={actions.pendingId === `save:${namespace}`} busyLabel="Saving" reason={status ? actions.blocked(`save:${namespace}`) : 'Reading the Wiki settings…'} onClick={() => void saveSource(kept)}>Save source</ActionButton>
                    <ActionButton size="sm" busy={actions.pendingId === `choose:${namespace}`} busyLabel="Choosing" reason={actions.blocked(`choose:${namespace}`)} onClick={() => void chooseRepository(namespace, kept.token)}>Choose repository…</ActionButton>
                    <Button size="sm" variant="ghost" onClick={() => setSelection(undefined)}>Cancel</Button>
                  </div>
                </div>}
              </Disclosure>
              <Disclosure open={confirm === namespace} id={`wiki-confirm-${namespace}`} label={`Confirm removal of ${name}`}>
                <div className="settings-form" onKeyDown={closeOnEscape(() => setConfirm(undefined))}>
                  <p className="settings-confirm">Remove {name} from HQ? Repository files remain on disk.</p>
                  <div className="settings-form-actions">
                    <ActionButton size="sm" variant="danger" busy={actions.pendingId === `remove:${namespace}`} busyLabel="Removing" reason={status ? actions.blocked(`remove:${namespace}`) : 'Reading the Wiki settings…'} onClick={() => void removeSource(namespace)}>Remove source</ActionButton>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(undefined)}>Cancel</Button>
                  </div>
                </div>
              </Disclosure>
            </Row>;
          })}
      </Panel>
    </>}
    <p className="settings-footnote">Local bare Git repositories only: remote VPS and Mac Mini Wiki transports are not supported. An unavailable index is not a host outage. Paths stay in the native app.</p>
  </>;
}
