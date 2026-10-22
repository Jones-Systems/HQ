import { examplePlanner } from '@hq/work';
import { createFixturePlanner } from '../../../../modules/work/core/fixtures/adapter';
import { EXAMPLE_SETTINGS } from '../../../../modules/work/core/fixtures/examples';
import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES } from '../../../../modules/social/core';
import { MODULES } from '../modules';
import { createServiceDomains } from '../services/domains';
import type { PreviewEntry } from './capabilities';

const unavailable = async () => ({ ok: false, kind: 'unavailable' } as const);
export const UNCONFIGURED = {
  config: { status: async () => ({ configured: false, policy: 'ok', transport: null } as const) },
  social: { call: unavailable },
  work: { call: unavailable },
};

export function seed(entry: PreviewEntry) {
  return {
    planner: () => entry === 'empty'
      ? createFixturePlanner({ items: [], settings: { ...EXAMPLE_SETTINGS } }).port
      : examplePlanner(),
    social: () => createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX] }).port,
  };
}

export function previewModules(entry: PreviewEntry) {
  const { Social, Work } = createServiceDomains(() => UNCONFIGURED, seed(entry));
  return { ...MODULES, social: Social, work: Work };
}
