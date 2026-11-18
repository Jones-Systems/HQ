import { useState } from 'react';
import { Button, InlineNotice, Presence } from '@hq/ui';
import type { ServiceConfigTransport, ServiceDomain } from '@hq/contracts/services';
import { SOURCE_NAMES } from '../services/data-source-status';
import { useDataSources } from './DataSources';
import { useSourceCheck } from './use-source-check';
import { useSettingsActions, type SettingsActions } from './actions';
import { ActionButton, ChipStatus, Disclosure, Field, FailureNotice, Icon, Panel, RotateLabel, Row, SettingsHeading, closeOnEscape, useDisclosure } from './parts';
import { SERVICE_BLURB, chipFor } from './status';

const NO_CONFIG = 'Service configuration is unavailable in this window.';

function DomainRow({ domain, config, selected, actions }: { domain: ServiceDomain; config?: ServiceConfigTransport; selected: boolean; actions: SettingsActions }) {
  const { statuses, busy: checkingAny, reload } = useDataSources();
  const runCheck = useSourceCheck();
  const status = statuses[domain];
  const name = SOURCE_NAMES[domain];
  const [input, setInput] = useState('');
  const [addressError, setAddressError] = useState('');
  const form = useDisclosure();
  const checkId = `check:${domain}`, saveId = `save:${domain}`;
  const checking = actions.pendingId === checkId || status.text === 'Checking…';
  const saving = actions.pendingId === saveId;
  const rejected = status.text === 'Address rejected';

  const check = () => actions.run({
    id: checkId, row: domain, lost: `Couldn't check ${name}`, check: () => { void check(); },
    work: async () => {
      const result = await runCheck(domain);
      if (result.label === 'Reachable') return { ok: true, toast: { title: `${name} is reachable` } };
      if (result.label === 'Unreachable') return { ok: false, title: `Couldn't reach ${name}`, detail: 'The saved address was kept.', retry: true };
      if (result.text === 'Unavailable') return { ok: false, title: `Couldn't read ${name} settings`, detail: 'Service settings are unavailable in this window. Nothing was changed.', retry: true };
      return { ok: true };
    },
  });
  const save = () => {
    if (!config) return Promise.resolve(false);
    return actions.run({
      id: saveId, row: domain, lost: `Couldn't confirm the ${name} address was saved`, check: () => { void runCheck(domain); },
      work: async () => {
        setAddressError('');
        const result = await config.set({ domain, baseUrl: input });
        reload();
        if (result.policy === 'rejected' || !result.configured) {
          setAddressError('That address is not allowed. Use HTTPS, or HTTP on localhost, with no credentials, query or fragment.');
          return { ok: false, title: 'Address rejected', detail: 'Use HTTPS, or HTTP on localhost. HQ cleared the previous address, so nothing is connected until you save an allowed one.' };
        }
        setInput('');
        form.close();
        return { ok: true, toast: { title: `${name} address saved`, meta: 'Reload HQ to use it' } };
      },
    });
  };

  const unavailable = !config ? NO_CONFIG : null;
  const checkReason = unavailable ?? (status.text === 'Sample data · not set up' ? 'Add an address first.' : rejected ? 'Save an allowed address first.'
    : actions.blocked(checkId) ?? (checkingAny && !checking ? 'Another check is running.' : null));
  const failure = actions.failures[domain];

  return <Row region={`${name} data source`} id={`settings-${domain}`} icon={domain} target={selected} flash={actions.flashes[domain] ?? 0}
    title={name} description={SERVICE_BLURB[domain]} status={<ChipStatus chip={chipFor(status)} live />}
    control={<>
      <ActionButton size="sm" working={checking} reason={checkReason} onClick={() => void check()} aria-label={`Check connection for ${name}`}><RotateLabel busy={checking} label="Check connection" busyLabel="Checking" /></ActionButton>
      <ActionButton ref={form.trigger} size="sm" variant="ghost" aria-expanded={form.open} aria-controls={`address-form-${domain}`} reason={unavailable ?? actions.blocked(saveId)} onClick={form.toggle}>
        <span>Change {name} address</span><Icon name="chevron" className="settings-chevron" />
      </ActionButton>
    </>}>
    <Presence show={rejected} motion="collapse" initial={false}>
      <div className="settings-row-notice"><InlineNotice variant="bar" tone="warning" live="off" title="Address rejected">Use an allowed address and save it successfully.</InlineNotice></div>
    </Presence>
    <FailureNotice failure={failure} onDismiss={() => actions.dismiss(domain)} />
    <Disclosure open={form.open} id={`address-form-${domain}`} label={`Change ${name} address`}>
      <form className="settings-form" onKeyDown={closeOnEscape(form.close)} onSubmit={event => { event.preventDefault(); void save(); }}>
        <Field label={`New ${domain} base URL`} error={addressError} help="Use HTTPS, or HTTP on localhost, 127.0.0.1 or ::1. Addresses must not include credentials, a query or a fragment. Saved addresses stay in the native app and are never shown here.">
          {props => <input {...props} type="url" autoComplete="off" spellCheck={false} value={input} onChange={event => { setInput(event.target.value); setAddressError(''); }} readOnly={saving} required />}
        </Field>
        <div className="settings-form-actions">
          <ActionButton type="submit" size="sm" variant="primary" busy={saving} busyLabel="Saving" reason={actions.blocked(saveId)}>Save address</ActionButton>
          <Button size="sm" variant="ghost" onClick={() => form.close()}>Cancel</Button>
        </div>
      </form>
    </Disclosure>
  </Row>;
}

export function ServicesPanel({ headingId, config, selected }: { headingId: string; config?: ServiceConfigTransport; selected: ServiceDomain | null }) {
  const actions = useSettingsActions();
  return <>
    <SettingsHeading id={headingId} title="Social & Work">Service addresses for the Social and Work domains. Without one, each shows sample data kept only in this window.</SettingsHeading>
    <Presence show={!config} motion="collapse" initial={false}>
      <InlineNotice variant="bar" tone="warning" live="off" title={NO_CONFIG} />
    </Presence>
    <Panel>
      <DomainRow domain="social" config={config} selected={selected === 'social'} actions={actions} />
      <DomainRow domain="work" config={config} selected={selected === 'work'} actions={actions} />
    </Panel>
    <p className="settings-footnote">After changing a service address, reload HQ to use it in that domain. Checking a connection sends one read-only request and never changes the address.</p>
  </>;
}
