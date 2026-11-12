import type { ReferenceProvider } from '@hq/contracts/references';
import { createDesignReferenceProvider } from '../../../modules/design/app/index.ts';
import { designReferenceReads } from './modules';
import { createSocialReferenceProvider } from '../../../modules/social/references';
import { createWorkReferenceProvider } from '@hq/work';
import { createWikiClient, createWikiReferenceProvider } from '@hq/wiki';
import { WORKSPACE_SCOPE } from './references';
import { SERVICE_DOMAINS } from './services/domains';

const projectId = WORKSPACE_SCOPE;
const now = () => new Date();
// The Wiki is read-only and workspace-wide: a reference target only. Like the mounted module, its client reads the
// bridge on every call, so a missing bridge finds nothing and resolves unavailable.
const wiki = createWikiClient(() => globalThis.window?.hqServices?.wiki ?? null);

/** Unregistered kinds stay unknown. Design projects remain unknown; its destinations are section-only. Wiki pages are targets only. */
export function createReferenceProviders(reads = SERVICE_DOMAINS.referenceReads): readonly ReferenceProvider[] {
  return Object.freeze([
    createDesignReferenceProvider(designReferenceReads, () => now().toISOString()),
    createSocialReferenceProvider(reads.social, projectId, now),
    createWorkReferenceProvider(projectId, reads.work, now),
    createWikiReferenceProvider(wiki, now),
  ]);
}

export const REFERENCE_PROVIDERS = createReferenceProviders();
