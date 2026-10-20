import type { EvidenceStorePort, OutboxStorePort } from '../../../connector/src/contract.ts';
import type { ConnectorController } from '../../../connector/src/controller.ts';
import type { HostCatalog } from '../../../connector/src/host-catalog.ts';
import type { CompareSlot, RequestsEnvironment, SectionClock, SectionIds } from '../requests/env.ts';
import { createRunsPipeline, type RunsPipeline } from './pipeline.ts';

export interface RunsEnvironmentOptions {
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
  return { pipeline, controller: pipeline.controller, catalog: pipeline.catalog, compareSlot: options.compareSlot };
}
