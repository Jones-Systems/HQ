/**
 * Connector panel: destination choice, explicit confirmation, dispatch status
 * and returned evidence. Written with createElement (no JSX) so it stays
 * erasable TypeScript runnable under `node --test`. Presentational only; the
 * controller owns behaviour. Styles: connector.css, using shell theme tokens.
 */

import { createElement as h, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { ConnectorController, ConnectorView } from './controller.ts';
import type { DestinationId } from './ids.ts';

export interface ConnectorPanelProps {
  readonly view: ConnectorView;
  readonly onSelect: (destinationId: DestinationId) => void;
  readonly onRequestSend: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onCheckStatus: () => void;
}

const reasonId = (destinationId: string) => `hq-connector-reason-${destinationId.replace(/[^a-zA-Z0-9_-]/gu, '_')}`;

function DestinationList({ view, onSelect }: Pick<ConnectorPanelProps, 'view' | 'onSelect'>): ReactElement {
  return h('fieldset', { className: 'hq-connector__destinations', disabled: view.busy },
    h('legend', null, 'Destination'),
    view.rows.map((row) => h('div', {
      key: row.destinationId,
      className: 'hq-connector__destination',
      'data-qualification': row.qualification,
      'data-selectable': row.selectable ? 'true' : 'false',
    },
    h('label', null,
      h('input', {
        type: 'radio',
        name: 'hq-connector-destination',
        value: row.destinationId,
        checked: view.selectedId === row.destinationId,
        disabled: !row.selectable,
        'aria-describedby': row.disabledReason ? reasonId(row.destinationId) : undefined,
        onChange: () => onSelect(row.destinationId),
      }),
      h('span', { className: 'hq-connector__destination-label' }, row.label),
      h('span', { className: 'hq-connector__badge', 'data-kind': row.qualification }, row.qualificationLabel)),
    h('dl', { className: 'hq-connector__facts' },
      h('dt', null, 'Mode'), h('dd', null, row.modeLabel),
      h('dt', null, 'Receiver'), h('dd', null, row.transportLabel),
      h('dt', null, 'Identity'), h('dd', null, row.identityLabel),
      h('dt', null, 'Freshness'), h('dd', null, row.freshnessLabel),
      h('dt', null, 'Reachability'), h('dd', null, row.reachabilityLabel)),
    row.disabledReason ? h('p', { id: reasonId(row.destinationId), className: 'hq-connector__reason' }, row.disabledReason) : null)));
}

function NewThread({ view }: Pick<ConnectorPanelProps, 'view'>): ReactElement {
  return h('div', { className: 'hq-connector__new-thread' },
    h('button', { type: 'button', disabled: true, 'aria-describedby': 'hq-connector-new-thread-reason' }, view.newThread.label),
    h('p', { id: 'hq-connector-new-thread-reason', className: 'hq-connector__reason' }, view.newThread.reason));
}

function Confirmation({ view, onConfirm, onCancel }: Pick<ConnectorPanelProps, 'view' | 'onConfirm' | 'onCancel'>): ReactElement | null {
  const card = view.confirmation;
  if (!card) return null;
  return h('section', { className: 'hq-connector__confirm', 'aria-labelledby': 'hq-connector-confirm-title' },
    h('h3', { id: 'hq-connector-confirm-title' }, 'Confirm send'),
    h('p', null, 'Sending is the execution boundary. HQ sends this exact request to this exact receiver once, with no fallback.'),
    h('dl', { className: 'hq-connector__facts' },
      h('dt', null, 'Destination'), h('dd', null, card.destinationLabel),
      h('dt', null, 'Identity'), h('dd', null, card.identityLabel),
      h('dt', null, 'Request'), h('dd', null, card.packetLabel)),
    card.fake ? h('p', { className: 'hq-connector__fake' }, 'This is the labelled fake receiver.') : null,
    h('div', { className: 'hq-connector__actions' },
      h('button', { type: 'button', onClick: onConfirm, disabled: view.busy }, 'Confirm send'),
      h('button', { type: 'button', onClick: onCancel, disabled: view.busy }, 'Cancel')));
}

function Status({ view, onCheckStatus }: Pick<ConnectorPanelProps, 'view' | 'onCheckStatus'>): ReactElement | null {
  const status = view.status;
  if (!status) return null;
  return h('section', { className: 'hq-connector__status', 'data-tone': status.tone, 'data-state': status.state, 'aria-labelledby': 'hq-connector-status-title' },
    h('h3', { id: 'hq-connector-status-title' }, `${status.stateLabel} · ${status.attemptLabel}`),
    h('p', null, status.explanation),
    status.reason ? h('p', { className: 'hq-connector__reason' }, status.reason) : null,
    status.varianceLabels.length > 0
      ? h('ul', { className: 'hq-connector__variances' }, status.varianceLabels.map((label) => h('li', { key: label }, label)))
      : null,
    status.lastCheckedLabel ? h('p', { className: 'hq-connector__meta' }, status.lastCheckedLabel) : null,
    status.canCheckStatus
      ? h('button', { type: 'button', onClick: onCheckStatus, disabled: view.busy }, 'Check status (read-only)')
      : null);
}

function Evidence({ view }: Pick<ConnectorPanelProps, 'view'>): ReactElement | null {
  if (view.evidence.length === 0) return null;
  return h('section', { className: 'hq-connector__evidence', 'aria-labelledby': 'hq-connector-evidence-title' },
    h('h3', { id: 'hq-connector-evidence-title' }, 'Returned evidence'),
    h('ul', null, view.evidence.map((row) => h('li', { key: row.evidenceId, 'data-fake': row.fake ? 'true' : 'false' },
      h('strong', null, row.summary),
      h('span', { className: 'hq-connector__badge', 'data-kind': row.fake ? 'labelled-fake' : 'qualified' }, row.provenanceLabel),
      h('span', null, row.claimLabel),
      h('span', { className: 'hq-connector__meta' }, `${row.executionLabel} · ${row.packetLabel}`)))));
}

export function ConnectorPanel(props: ConnectorPanelProps): ReactElement {
  const { view } = props;
  return h('section', { className: 'hq-connector', 'aria-labelledby': 'hq-connector-title', 'aria-busy': view.busy },
    h('header', { className: 'hq-connector__header' },
      h('h2', { id: 'hq-connector-title' }, 'Send request'),
      h('p', { className: 'hq-connector__meta' }, view.packetLabel ?? 'No frozen request selected')),
    view.fakeBanner ? h('p', { className: 'hq-connector__fake', role: 'note' }, view.fakeBanner) : null,
    h(DestinationList, { view, onSelect: props.onSelect }),
    h(NewThread, { view }),
    h('div', { className: 'hq-connector__actions' },
      h('button', {
        type: 'button',
        onClick: props.onRequestSend,
        disabled: !view.sendEnabled || view.confirmation !== null,
        'aria-describedby': view.sendDisabledReason ? 'hq-connector-send-reason' : undefined,
      }, 'Send…'),
      view.sendDisabledReason ? h('p', { id: 'hq-connector-send-reason', className: 'hq-connector__reason' }, view.sendDisabledReason) : null),
    h(Confirmation, { view, onConfirm: props.onConfirm, onCancel: props.onCancel }),
    h('div', { role: 'status', 'aria-live': 'polite', className: 'hq-connector__live' }, view.message ?? ''),
    h(Status, { view, onCheckStatus: props.onCheckStatus }),
    h(Evidence, { view }));
}

/** Binds the panel to a controller. Root supplies the controller with injected ports. */
export function ConnectorPanelHost({ controller }: { readonly controller: ConnectorController }): ReactElement {
  const view = useSyncExternalStore(controller.subscribe, controller.view, controller.view);
  return h(ConnectorPanel, {
    view,
    onSelect: (id) => { void controller.select(id); },
    onRequestSend: () => controller.requestSend(),
    onConfirm: () => { void controller.confirm(); },
    onCancel: () => controller.cancel(),
    onCheckStatus: () => { void controller.checkStatus(); },
  });
}
