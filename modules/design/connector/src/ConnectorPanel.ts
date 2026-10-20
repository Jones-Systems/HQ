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
  /** Optional so v1 hosts keep working; without it a packet with route history cannot be confirmed from the panel. */
  readonly onAcknowledgeRouteHistory?: (acknowledged: boolean) => void;
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

function Confirmation({ view, onConfirm, onCancel, onAcknowledgeRouteHistory }: Pick<ConnectorPanelProps, 'view' | 'onConfirm' | 'onCancel' | 'onAcknowledgeRouteHistory'>): ReactElement | null {
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
    view.routeHistory.required
      ? h('div', { className: 'hq-connector__route-history', role: 'group', 'aria-labelledby': 'hq-connector-route-history-title' },
        h('p', { id: 'hq-connector-route-history-title' }, 'This request was already handed off another way:'),
        h('ul', null, view.routeHistory.labels.map((label) => h('li', { key: label }, label))),
        h('label', null,
          h('input', {
            type: 'checkbox',
            checked: view.routeHistory.acknowledged,
            disabled: view.busy || !onAcknowledgeRouteHistory,
            onChange: (event) => onAcknowledgeRouteHistory?.(event.currentTarget.checked),
          }),
          'I know it was already handed off and still want to send it here.'))
      : null,
    h('div', { className: 'hq-connector__actions' },
      h('button', { type: 'button', onClick: onConfirm, disabled: view.busy || (view.routeHistory.required && !view.routeHistory.acknowledged) }, 'Confirm send'),
      h('button', { type: 'button', onClick: onCancel, disabled: view.busy }, 'Cancel')));
}

function Route({ view }: Pick<ConnectorPanelProps, 'view'>): ReactElement | null {
  const route = view.route;
  if (!route) return null;
  return h('section', { className: 'hq-connector__route', 'aria-labelledby': 'hq-connector-route-title' },
    h('h3', { id: 'hq-connector-route-title' }, route.pinnedLabel),
    h('dl', { className: 'hq-connector__facts' },
      h('dt', null, 'Host'), h('dd', null, route.hostLabel),
      h('dt', null, 'Receiver'), h('dd', null, route.receiverLabel),
      h('dt', null, 'Model'), h('dd', null, route.modelLabel),
      route.observedLabel ? h('dt', null, 'Reported') : null, route.observedLabel ? h('dd', null, route.observedLabel) : null,
      h('dt', null, 'Freshness'), h('dd', null, route.freshnessLabel)),
    h('p', { className: 'hq-connector__reason' }, route.fallbackLabel),
    route.driftLabels.length > 0
      ? h('ul', { className: 'hq-connector__variances' }, route.driftLabels.map((label) => h('li', { key: label }, `Catalog now differs: ${label}`)))
      : null);
}

function Lifecycle({ view, onCheckStatus }: Pick<ConnectorPanelProps, 'view' | 'onCheckStatus'>): ReactElement | null {
  const lifecycle = view.lifecycle;
  if (!lifecycle) return null;
  return h('section', { className: 'hq-connector__lifecycle', 'data-tone': lifecycle.tone, 'data-stage': lifecycle.stage, 'aria-labelledby': 'hq-connector-lifecycle-title' },
    h('h3', { id: 'hq-connector-lifecycle-title' }, lifecycle.stageLabel),
    h('p', null, lifecycle.explanation),
    lifecycle.executionLabel ? h('p', { className: 'hq-connector__meta' }, lifecycle.executionLabel) : null,
    lifecycle.evidenceLabel ? h('p', { className: 'hq-connector__meta' }, lifecycle.evidenceLabel) : null,
    h('p', { className: 'hq-connector__meta' }, lifecycle.sendLabel),
    lifecycle.routeAcknowledgementLabel ? h('p', { className: 'hq-connector__reason' }, lifecycle.routeAcknowledgementLabel) : null,
    lifecycle.anomalyLabels.length > 0
      ? h('ul', { className: 'hq-connector__variances' }, lifecycle.anomalyLabels.map((label) => h('li', { key: label }, label)))
      : null,
    lifecycle.canCheckForResults
      ? h('button', { type: 'button', onClick: onCheckStatus, disabled: view.busy }, 'Check for results (read-only)')
      : null);
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
    h(Route, { view }),
    h(Confirmation, {
      view, onConfirm: props.onConfirm, onCancel: props.onCancel,
      ...(props.onAcknowledgeRouteHistory ? { onAcknowledgeRouteHistory: props.onAcknowledgeRouteHistory } : {}),
    }),
    h('div', { role: 'status', 'aria-live': 'polite', className: 'hq-connector__live' }, view.message ?? ''),
    h(Lifecycle, { view, onCheckStatus: props.onCheckStatus }),
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
    onAcknowledgeRouteHistory: (acknowledged) => controller.acknowledgeRouteHistory(acknowledged),
  });
}
