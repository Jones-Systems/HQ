import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ConnectorPanelHost } from '../../../connector/src/ConnectorPanel.ts';
import { createConnectorController } from '../../../connector/src/controller.ts';
import { createOutbox } from '../../../connector/src/outbox.ts';
import { createFakeClock, createMemoryEvidenceStore, createMemoryOutboxStore, syntheticCatalog, syntheticPacket } from '../../../connector/src/fakes.ts';
import '../../../connector/src/connector.css';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

/**
 * No transport is registered, not even the lane's fake receiver: every
 * destination renders "Not qualified" and nothing can be selected or sent.
 */
const load = perProject(async (project) => {
  const clock = createFakeClock();
  const transports = {};
  const outbox = createOutbox({ store: createMemoryOutboxStore(), transports, clock, sessionId: `preview-${project.id}` });
  const controller = createConnectorController({
    outbox, transports, clock, evidence: createMemoryEvidenceStore(), getCatalog: () => syntheticCatalog(),
  });
  await controller.setPacket(await syntheticPacket(`preview-${project.id}`));
  return controller;
});

export function ConnectorPreview({ context }: DesignSectionProps) {
  const controller = use(load(context));
  return <PreviewFrame lane="T12 connector" entry="connector/src/ConnectorPanel.ts › ConnectorPanelHost"
    notes={['no transport registered: every destination is not qualified', 'synthetic host catalog and packet']}>
    <ConnectorPanelHost controller={controller} />
  </PreviewFrame>;
}
