import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, InlineNotice, Presence, Skeleton, useListMotion } from '@hq/ui';
import type { SourceResult, SourceStatus } from '@hq/contracts/catalog';
import type { JonesResult, JonesSelection, JonesStatus } from '@hq/contracts/jones-code';
import { useSettingsActions, type Outcome } from './actions';
import { ActionButton, ChipBadge, ChipStatus, Disclosure, FailureNotice, Field, Icon, Panel, Row, SettingsHeading, closeOnEscape, useDisclosure } from './parts';
import { JONES_STATE, projectSourceChip, projectSourceKind } from './status';

const changed = () => window.dispatchEvent(new Event('hq-sources-changed'));
const NO_SOURCES = "Native source enrollment isn't available in this window.";
const NO_JONES = "Native Jones connection isn't available in this window.";

/** No request was sent and nothing was changed by any of these. */
const SAFE = 'No work was sent and nothing was changed.';
const refusedSource = (what: string, kind: Extract<SourceResult<unknown>, { ok: false }>['kind']): Outcome =>
  ({ ok: false, title: `Couldn't ${what}`, detail: kind === 'stale' ? `The sources changed. ${SAFE} Refresh, then try again.` : kind === 'invalid' ? `That wasn't accepted. ${SAFE}` : `The native app did not answer. ${SAFE}`, retry: kind !== 'invalid' });
const refusedJones = (what: string, result: Extract<JonesResult<unknown>, { ok: false }>): Outcome =>
  result.kind === 'unknown'
    ? { ok: false, unknown: true, title: `Couldn't confirm ${what}`, detail: 'The Jones connection did not confirm. Check its status before trying again.' }
    : { ok: false, title: `Couldn't ${what}`, detail: result.kind === 'invalid' ? `That wasn't accepted. ${SAFE}` : `The Jones connection did not answer. ${SAFE}`, retry: result.kind === 'unavailable' };

/** Project sources (local folder, gallery, enrolled rows) and Jones change requests. */
export function ProjectSources({ headingId }: { headingId?: string }) {
  const fallbackId = useId();
  const heading = headingId ?? fallbackId;
  const sources = window.hqServices?.sources, jones = window.hqServices?.jonesCode;
  const actions = useSettingsActions();
  const [rows, setRows] = useState<readonly SourceStatus[]>([]), [status, setStatus] = useState<JonesStatus>();
  const [loading, setLoading] = useState(Boolean(sources || jones)), [readFailed, setReadFailed] = useState(false);
  const [gallery, setGallery] = useState(''), [sourceLabel, setSourceLabel] = useState('Gallery'), [galleryError, setGalleryError] = useState('');
  const [base, setBase] = useState(''), [receiverLabel, setReceiverLabel] = useState('Jones Code'), [baseError, setBaseError] = useState('');
  const [choices, setChoices] = useState<readonly JonesSelection[]>([]), [project, setProject] = useState('');
  const [threads, setThreads] = useState<readonly JonesSelection[]>([]), [thread, setThread] = useState('');
  const [removing, setRemoving] = useState<string>();
  const galleryForm = useDisclosure(), jonesForm = useDisclosure();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const list = useListMotion<HTMLDivElement>(rows.map(row => row.sourceId));

  const refresh = useCallback(async () => {
    try {
      const [sourceResult, receiverResult] = await Promise.all([sources?.call('status', {}), jones?.call('jonesCode.status', {})]);
      if (!alive.current) return;
      if (sourceResult?.ok) setRows(sourceResult.value);
      if (receiverResult?.ok) setStatus(receiverResult.value);
      setReadFailed((Boolean(sources) && !sourceResult?.ok) || (Boolean(jones) && !receiverResult?.ok));
    } catch { if (alive.current) setReadFailed(true); }
    finally { if (alive.current) setLoading(false); }
  }, [sources, jones]);
  useEffect(() => { void refresh(); }, [refresh]);
  const settle = async () => { await refresh(); changed(); };

  const state = status?.state;
  const jonesReason = !jones ? NO_JONES : null;
  const needsConnection = !jones ? NO_JONES : state === 'not-configured' || !state ? 'Save a Jones connection first.' : state === 'needs-authorization' ? 'Authorize in your browser first.' : state === 'authorizing' ? 'Finish authorizing in your browser first.' : state === 'unavailable' ? 'The Jones connection is unavailable.' : null;
  const sourceReason = !sources ? NO_SOURCES : null;

  const chooseLocal = () => actions.run({
    id: 'local', row: 'local', lost: "Couldn't confirm the folder was enrolled", check: () => { void refresh(); },
    work: async () => {
      const result = await sources!.call('chooseLocal', {});
      if (!result.ok) return refusedSource('choose a projects folder', result.kind);
      const added = result.value.length > rows.length;
      setRows(result.value); await settle();
      return added ? { ok: true, toast: { title: 'Local projects folder enrolled' } } : { ok: true };
    },
  });
  const enrollGallery = () => actions.run({
    id: 'gallery', row: 'gallery', lost: "Couldn't confirm the gallery was enrolled", check: () => { void refresh(); },
    work: async () => {
      setGalleryError('');
      const result = await sources!.call('enrollGallery', { baseUrl: gallery, label: sourceLabel });
      if (!result.ok) {
        if (result.kind === 'invalid') setGalleryError('That address was not accepted. Use the gallery directory URL ending in /, over HTTPS or loopback HTTP.');
        return refusedSource('enroll the gallery', result.kind);
      }
      const label = sourceLabel;
      setGallery(''); setRows(result.value); galleryForm.close(); await settle();
      return { ok: true, toast: { title: 'Gallery enrolled', description: label } };
    },
  });
  const refreshRow = (row: SourceStatus) => actions.run({
    id: `refresh:${row.sourceId}`, row: row.sourceId, lost: `Couldn't confirm ${row.label} refreshed`, check: () => { void refresh(); },
    work: async () => {
      const result = await sources!.call('refresh', { sourceId: row.sourceId });
      if (!result.ok) return refusedSource(`refresh ${row.label}`, result.kind);
      setRows(result.value); await settle();
      return { ok: true, toast: { title: `${row.label} refreshed` } };
    },
  });
  const removeRow = (row: SourceStatus) => actions.run({
    id: `remove:${row.sourceId}`, row: row.sourceId, lost: `Couldn't confirm ${row.label} was removed`, check: () => { void refresh(); },
    work: async () => {
      const result = await sources!.call('remove', { sourceId: row.sourceId });
      setRemoving(undefined);
      if (!result.ok) return refusedSource(`remove ${row.label}`, result.kind);
      setRows(result.value); await settle();
      return { ok: true, toast: { title: `${row.label} removed`, description: 'Project files were not touched.' } };
    },
  });
  const selectProfile = (token: string) => actions.run({
    id: 'profile', row: 'connection', lost: "Couldn't confirm the Jones environment changed", check: () => { void refresh(); },
    work: async () => {
      const result = await jones!.call('jonesCode.selectProfile', { token });
      if (!result.ok) return refusedJones('switch the Jones environment', result);
      setStatus(result.value); setChoices([]); setThreads([]); await settle();
      return { ok: true, toast: { title: 'Jones environment switched' } };
    },
  });
  const configure = () => actions.run({
    id: 'configure', row: 'connection', lost: "Couldn't confirm the Jones connection was saved", check: () => { void refresh(); },
    work: async () => {
      setBaseError('');
      const result = await jones!.call('jonesCode.configure', { baseUrl: base, label: receiverLabel });
      if (!result.ok) {
        if (result.kind === 'invalid') setBaseError('That address was not accepted. Use HTTPS, or HTTP on localhost.');
        return refusedJones('save the Jones connection', result);
      }
      setStatus(result.value); setBase(''); setChoices([]); setThreads([]); jonesForm.close(); await settle();
      return { ok: true, toast: { title: 'Jones connection saved', ...(result.value.state === 'needs-authorization' ? { meta: 'Authorize in your browser next' } : {}) } };
    },
  });
  const authorize = () => actions.run({
    id: 'authorize', row: 'connection', lost: "Couldn't confirm the Jones authorization", check: () => { void refresh(); },
    work: async () => {
      const result = await jones!.call('jonesCode.authorize', {});
      if (!result.ok) return refusedJones('start the Jones authorization', result);
      setStatus(result.value); await settle();
      return { ok: true, toast: { title: result.value.state === 'connected' ? 'Jones connected' : 'Finish authorizing in your browser' } };
    },
  });
  const readProjects = () => actions.run({
    id: 'projects', row: 'requests', lost: "Couldn't confirm the Jones projects were read",
    work: async () => {
      const result = await jones!.call('jonesCode.projects', {});
      if (!result.ok) return refusedJones('read Jones projects', result);
      setChoices(result.value); setProject(''); setThreads([]); setThread('');
      return { ok: true };
    },
  });
  const enrollJones = () => actions.run({
    id: 'enroll-jones', row: 'requests', lost: "Couldn't confirm the Jones projects were enrolled", check: () => { void refresh(); },
    work: async () => {
      const result = await sources!.call('enrollJones', { label: receiverLabel });
      if (!result.ok) return refusedSource('enroll Jones projects', result.kind);
      setRows(result.value); await settle();
      return { ok: true, toast: { title: 'Jones projects enrolled' } };
    },
  });
  const bind = (mode: 'new-thread' | 'existing-thread') => actions.run({
    id: `bind:${mode}`, row: 'requests', lost: "Couldn't confirm the destination was saved", check: () => { void refresh(); },
    work: async () => {
      const token = mode === 'new-thread' ? project : thread, pool = mode === 'new-thread' ? choices : threads;
      const label = pool.find(choice => choice.token === token)?.label ?? '';
      const result = await jones!.call('jonesCode.bind', { token, mode, label });
      if (!result.ok) return refusedJones('save the destination', result);
      setStatus(result.value); await settle();
      return { ok: true, toast: { title: `${mode === 'new-thread' ? 'New-thread' : 'Existing-thread'} destination saved`, description: label } };
    },
  });
  const readThreads = () => actions.run({
    id: 'threads', row: 'requests', lost: "Couldn't confirm the Jones threads were read",
    work: async () => {
      const result = await jones!.call('jonesCode.listThreads', { token: project });
      if (!result.ok) return refusedJones('read Jones threads', result);
      setThreads(result.value); setThread('');
      return { ok: true };
    },
  });

  const lock = (id: string, reason?: string | null) => reason ?? actions.blocked(id);
  const active = status?.profiles?.find(profile => profile.active)?.token ?? '';
  const jonesChip = state ? JONES_STATE[state] : undefined;
  const qualification = status?.descriptor.qualification;

  return <>
    <SettingsHeading id={heading} title="Projects & Jones">Where HQ finds your projects, and where change requests go. Refreshing reads project metadata only: it never runs a project or sends a request.</SettingsHeading>
    <Presence show={readFailed} motion="collapse" initial={false}>
      <InlineNotice variant="bar" tone="danger" title="Couldn't read project settings" actions={[{ label: 'Retry', onAction: () => { setLoading(true); void refresh(); } }]}>Showing what loaded earlier. Nothing was changed.</InlineNotice>
    </Presence>

    <div className="settings-subheading"><h3>Project sources</h3><p>Local folders, galleries and Jones projects HQ can read.</p></div>
    <Panel aria-label="Project sources" role="group" busy={loading}>
      <Presence show={!sources} motion="collapse" initial={false}><div className="settings-row-notice"><InlineNotice variant="bar" tone="warning" live="off" title={NO_SOURCES} /></div></Presence>
      <Row icon="projects" title="Local projects folder" description="Read project folders from this device."
        control={<ActionButton size="sm" busy={actions.pendingId === 'local'} busyLabel="Choosing" reason={lock('local', sourceReason)} onClick={() => void chooseLocal()}>Choose local projects folder…</ActionButton>}>
        <FailureNotice failure={actions.failures.local} onDismiss={() => actions.dismiss('local')} />
      </Row>
      <Row icon="social" title="Gallery" description="An interactive gallery, enrolled by its directory URL."
        control={<ActionButton ref={galleryForm.trigger} size="sm" variant="ghost" aria-expanded={galleryForm.open} aria-controls="gallery-form" reason={lock('gallery', sourceReason)} onClick={galleryForm.toggle}><span>Enroll a gallery…</span><Icon name="chevron" className="settings-chevron" /></ActionButton>}>
        <FailureNotice failure={actions.failures.gallery} onDismiss={() => actions.dismiss('gallery')} />
        <Disclosure open={galleryForm.open} id="gallery-form" label="Enroll a gallery">
          <form className="settings-form" onKeyDown={closeOnEscape(galleryForm.close)} onSubmit={event => { event.preventDefault(); void enrollGallery(); }}>
            <Field label="Gallery label">{props => <input {...props} value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} maxLength={160} required />}</Field>
            <Field label="Gallery base URL" help="Use the gallery directory URL ending in /. HTTPS or loopback HTTP only. Saved addresses stay in the native app." error={galleryError}>
              {props => <input {...props} type="url" value={gallery} onChange={event => { setGallery(event.target.value); setGalleryError(''); }} autoComplete="off" spellCheck={false} required />}
            </Field>
            <div className="settings-form-actions">
              <ActionButton type="submit" size="sm" variant="primary" busy={actions.pendingId === 'gallery'} busyLabel="Enrolling" reason={lock('gallery', sourceReason)}>Enroll gallery</ActionButton>
              <Button size="sm" variant="ghost" onClick={() => galleryForm.close()}>Cancel</Button>
            </div>
          </form>
        </Disclosure>
      </Row>
      <div className="settings-list" ref={list}>
        {loading ? <Row title={<Skeleton width="150px" />} description={<Skeleton width="45%" />} status={<Skeleton width="72px" />} />
          : rows.map(row => <Row key={row.sourceId} motionKey={row.sourceId} icon={row.kind === 'jones' ? 'jones' : row.kind === 'gallery' ? 'social' : 'projects'} flash={actions.flashes[row.sourceId] ?? 0}
            title={<>{row.label} <span className="settings-row-id">{projectSourceKind(row.kind)}</span></>}
            description={row.detail ?? 'Project metadata only.'} status={<ChipStatus chip={projectSourceChip(row.state)} />}
            control={<>
              <ActionButton size="sm" busy={actions.pendingId === `refresh:${row.sourceId}`} busyLabel="Refreshing" reason={lock(`refresh:${row.sourceId}`, sourceReason)} aria-label={`Refresh ${row.label}`} onClick={() => void refreshRow(row)}>Refresh</ActionButton>
              <ActionButton size="sm" variant="ghost" aria-expanded={removing === row.sourceId} reason={lock(`remove:${row.sourceId}`, sourceReason)} aria-label={`Remove enrollment for ${row.label}`} onClick={() => setRemoving(value => value === row.sourceId ? undefined : row.sourceId)}>Remove…</ActionButton>
            </>}>
            <FailureNotice failure={actions.failures[row.sourceId]} onDismiss={() => actions.dismiss(row.sourceId)} />
            <Disclosure open={removing === row.sourceId} id={`remove-${row.sourceId}`} label={`Confirm removal of ${row.label}`}>
              <div className="settings-form" onKeyDown={closeOnEscape(() => setRemoving(undefined))}>
                <p className="settings-confirm">Remove {row.label} from HQ? Project files are not touched.</p>
                <div className="settings-form-actions">
                  <ActionButton size="sm" variant="danger" busy={actions.pendingId === `remove:${row.sourceId}`} busyLabel="Removing" reason={actions.blocked(`remove:${row.sourceId}`)} onClick={() => void removeRow(row)}>Remove enrollment</ActionButton>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(undefined)}>Cancel</Button>
                </div>
              </div>
            </Disclosure>
          </Row>)}
      </div>
    </Panel>

    <div className="settings-subheading"><h3>Jones change requests</h3><p>Connect explicitly in your browser. Credentials stay in protected native storage. Delivery stays unavailable until native qualification.</p></div>
    <Panel aria-label="Jones change requests" role="group" busy={loading}>
      <Presence show={!jones} motion="collapse" initial={false}><div className="settings-row-notice"><InlineNotice variant="bar" tone="warning" live="off" title={NO_JONES} /></div></Presence>
      <Row icon="jones" title="Connection" statusInline
        status={loading ? <Skeleton width="72px" /> : jonesChip && <ChipBadge chip={jonesChip} />}
        description={loading ? <Skeleton width="50%" /> : <>{qualification?.level === 'qualified' ? 'Qualified for delivery.' : 'Delivery is not qualified yet.'}{status?.state === 'connected' ? ' Authorized in your browser.' : ''}</>}
        flash={actions.flashes.connection ?? 0}
        control={<>
          <ActionButton size="sm" busy={actions.pendingId === 'authorize'} busyLabel="Authorizing" reason={lock('authorize', jonesReason ?? (state === 'not-configured' ? 'Save a Jones connection first.' : null))} onClick={() => void authorize()}>Authorize in browser…</ActionButton>
          <ActionButton ref={jonesForm.trigger} size="sm" variant="ghost" aria-expanded={jonesForm.open} aria-controls="jones-form" reason={lock('configure', jonesReason)} onClick={jonesForm.toggle}><span>Save a connection…</span><Icon name="chevron" className="settings-chevron" /></ActionButton>
        </>}>
        <FailureNotice failure={actions.failures.connection} onDismiss={() => actions.dismiss('connection')} />
        <Disclosure open={jonesForm.open} id="jones-form" label="Save a Jones connection">
          <form className="settings-form" onKeyDown={closeOnEscape(jonesForm.close)} onSubmit={event => { event.preventDefault(); void configure(); }}>
            <Field label="Environment label">{props => <input {...props} value={receiverLabel} onChange={event => setReceiverLabel(event.target.value)} required maxLength={160} />}</Field>
            <Field label="Jones server URL" help="HTTPS, or HTTP on localhost. The address stays in the native app." error={baseError}>
              {props => <input {...props} type="url" value={base} onChange={event => { setBase(event.target.value); setBaseError(''); }} autoComplete="off" spellCheck={false} required />}
            </Field>
            <div className="settings-form-actions">
              <ActionButton type="submit" size="sm" variant="primary" busy={actions.pendingId === 'configure'} busyLabel="Saving" reason={lock('configure', jonesReason)}>Save Jones connection</ActionButton>
              <Button size="sm" variant="ghost" onClick={() => jonesForm.close()}>Cancel</Button>
            </div>
          </form>
        </Disclosure>
      </Row>
      {status?.profiles && status.profiles.length > 0 && <Row title="Saved environment" description="Switch between saved Jones environments." control={
        <Field label="Saved Jones environment">{props => <select {...props} value={active} disabled={actions.pending} onChange={event => void selectProfile(event.target.value)}><option value="">Choose environment</option>{status.profiles?.map(profile => <option key={profile.token} value={profile.token}>{profile.label}</option>)}</select>}</Field>} />}
      <Row icon="projects" title="Projects and threads" description="Read the projects this environment offers, then choose where change requests go."
        control={<>
          <ActionButton size="sm" busy={actions.pendingId === 'projects'} busyLabel="Reading" reason={lock('projects', needsConnection)} onClick={() => void readProjects()}>Read Jones projects</ActionButton>
          <ActionButton size="sm" busy={actions.pendingId === 'enroll-jones'} busyLabel="Enrolling" reason={lock('enroll-jones', needsConnection ?? sourceReason)} onClick={() => void enrollJones()}>Enroll Jones projects</ActionButton>
        </>}>
        <FailureNotice failure={actions.failures.requests} onDismiss={() => actions.dismiss('requests')} />
        <Disclosure open={choices.length > 0} id="jones-destination" label="Choose a request destination">
          <div className="settings-form">
            <Field label="Request destination project">{props => <select {...props} value={project} onChange={event => { setProject(event.target.value); setThreads([]); setThread(''); }}><option value="">Select project</option>{choices.map(choice => <option key={choice.token} value={choice.token}>{choice.label}</option>)}</select>}</Field>
            <div className="settings-form-actions">
              <ActionButton size="sm" variant="primary" busy={actions.pendingId === 'bind:new-thread'} busyLabel="Saving" reason={lock('bind:new-thread', !project ? 'Choose a project first.' : null)} onClick={() => void bind('new-thread')}>Save new-thread destination</ActionButton>
              <ActionButton size="sm" busy={actions.pendingId === 'threads'} busyLabel="Reading" reason={lock('threads', !project ? 'Choose a project first.' : null)} onClick={() => void readThreads()}>Read existing threads</ActionButton>
            </div>
            {threads.length > 0 && <>
              <Field label="Existing thread">{props => <select {...props} value={thread} onChange={event => setThread(event.target.value)}><option value="">Select thread</option>{threads.map(choice => <option key={choice.token} value={choice.token}>{choice.label}</option>)}</select>}</Field>
              <div className="settings-form-actions"><ActionButton size="sm" variant="primary" busy={actions.pendingId === 'bind:existing-thread'} busyLabel="Saving" reason={lock('bind:existing-thread', !thread ? 'Choose a thread first.' : null)} onClick={() => void bind('existing-thread')}>Save existing-thread destination</ActionButton></div>
            </>}
          </div>
        </Disclosure>
      </Row>
      {status?.destinations.map(destination => <Row key={destination.destinationId} icon="jones"
        title={<>{destination.label} <span className="settings-row-id">{destination.mode === 'new-thread' ? 'new thread' : 'existing thread'}</span></>}
        description={destination.deliveryQualified ? 'Qualified for delivery.' : destination.deliveryReason}
        status={<ChipStatus chip={destination.deliveryQualified ? { tone: destination.status === 'reachable' ? 'success' : 'unknown', label: destination.status === 'reachable' ? 'Reachable' : 'Not checked' } : { tone: 'unavailable', label: 'Not qualified' }} />} />)}
    </Panel>
  </>;
}
