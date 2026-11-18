import { examplePlanner, createWorkReferenceProvider } from '@hq/work';
import { createFixturePlanner } from '../../../../modules/work/core/fixtures/adapter';
import { EXAMPLE_SETTINGS } from '../../../../modules/work/core/fixtures/examples';
import { createSocialReferenceProvider } from '../../../../modules/social/references';
import { createLiveSocialPort } from '../../../../modules/social/live';
import { bridgeTransport, createPlannerLive } from '../../../../modules/work/live';
import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES } from '../../../../modules/social/core';
import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import type { ReferenceProvider } from '@hq/contracts/references';
import { DOMAIN_LABELS, type ModulePresentation } from '../domain-metadata';
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

function NativeOnly({ domain }: { domain: 'design' | 'wiki' }) {
  return <section className="service-domain" aria-label={`${DOMAIN_LABELS[domain]} unavailable`}>
    <h1>{DOMAIN_LABELS[domain]}</h1>
    <p role="status">{DOMAIN_LABELS[domain]} is unavailable in this browser preview. Open the desktop app to use this domain.</p>
  </section>;
}
const Design = () => <NativeOnly domain="design" />;
const Wiki = () => <NativeOnly domain="wiki" />;
export const PREVIEW_PRESENTATION: ModulePresentation = {};

// Fixture content does not grant live reference reads. Unregistered kinds remain unknown.
const referenceSocial = createLiveSocialPort(UNCONFIGURED.social);
const referencePlanner = createPlannerLive(bridgeTransport(UNCONFIGURED.work));
export const PREVIEW_REFERENCE_PROVIDERS: readonly ReferenceProvider[] = [
  {
    domain: 'design', kinds: ['project', 'version', 'request', 'reference'],
    find: async () => [],
    resolve: async envelope => ({
      status: envelope.kind === 'project' ? 'unknown' : 'unavailable',
      observedAt: new Date().toISOString(),
    }),
  },
  createSocialReferenceProvider(referenceSocial, 'hq-local'),
  createWorkReferenceProvider('hq-local', { snapshot: () => referencePlanner.port.snapshot() }),
];

export function previewModules(entry: PreviewEntry): Readonly<Record<DomainId, ComponentType<ModulePort>>> {
  const { Social, Work } = createServiceDomains(() => UNCONFIGURED, seed(entry));
  return { design: Design, wiki: Wiki, social: Social, work: Work };
}
