import type { EvidenceReadbackRegistry, EvidenceStorePort, OutboxStorePort, TransportRegistry } from '../../../connector/src/contract.ts';
import type { ConnectorController } from '../../../connector/src/controller.ts';
import type { HostCatalog } from '../../../connector/src/host-catalog.ts';
import type { CompareSlot, RequestsEnvironment, SectionClock, SectionIds } from '../requests/env.ts';
import { createRunsPipeline, type RunsPipeline } from './pipeline.ts';

export interface RunsConnection {
  readonly getCatalog: () => HostCatalog;
  readonly transports: TransportRegistry;
  readonly readback?: EvidenceReadbackRegistry;
}

export interface RunsEnvironmentOptions {
  readonly mode?: 'production' | 'example';
  readonly connection?: RunsConnection;
  readonly requests: RequestsEnvironment;
  readonly outboxStore: OutboxStorePort;
  readonly evidenceStore: EvidenceStorePort;
  readonly clock: SectionClock;
  readonly ids: SectionIds;
  readonly compareSlot: CompareSlot;
}

export interface RunsEnvironment {
  readonly controller: ConnectorController;
  readonly pipeline: RunsPipeline;
  readonly catalog: HostCatalog;
  readonly compareSlot: CompareSlot;
}

export async function createRunsEnvironment(options: RunsEnvironmentOptions): Promise<RunsEnvironment> {
  const pipeline = await createRunsPipeline(options);
  return { pipeline, controller: pipeline.controller, get catalog() { return pipeline.catalog; }, compareSlot: options.compareSlot };
}
