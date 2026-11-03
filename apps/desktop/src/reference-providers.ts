import type { WorkServiceTransport } from '@hq/contracts/services';
import type { ReferenceProvider } from '@hq/contracts/references';
import { createDesignReferenceProvider } from '../../../modules/design/app/index.ts';
import { designReferenceReads } from './modules';
import { createSocialReferenceProvider } from '../../../modules/social/references';
import { createLiveSocialPort } from '../../../modules/social/live';
import { createWorkReferenceProvider } from '@hq/work';
import { createWikiReferenceProvider } from '@hq/wiki';
import { bridgeTransport, createPlannerLive } from '../../../modules/work/live';

// Social and Work retain their service workspace binding; Design reads use the selected composition.
// Failed bridges stay unavailable, never an example-store fallback.
const projectId = 'hq-local';
const now = () => new Date();
const social = createLiveSocialPort({
  call: (route, params) => globalThis.window?.hqServices?.social.call(route, params)
    ?? Promise.resolve({ ok: false, kind: 'unavailable' }),
});
const workTransport: WorkServiceTransport = {
  call: (route, params) => globalThis.window?.hqServices?.work.call(route, params)
    ?? Promise.resolve({ ok: false, kind: 'unavailable' }),
};
const planner = createPlannerLive(bridgeTransport(workTransport));

type Assert<T extends true> = T;
/** The Wiki provider is structural (its module imports no contracts); this proves it is a `ReferenceProvider`. */
export type WikiReferenceCompatibility = Assert<ReturnType<typeof createWikiReferenceProvider> extends ReferenceProvider ? true : false>;

/** Unregistered kinds stay unknown. Design projects remain unknown; its destinations are section-only. */
export const REFERENCE_PROVIDERS: readonly ReferenceProvider[] = Object.freeze([
  createDesignReferenceProvider(designReferenceReads, () => now().toISOString()),
  createSocialReferenceProvider({ snapshot: () => social.snapshot(), run: (id) => social.run(id) }, projectId, now),
  createWorkReferenceProvider(projectId, { snapshot: () => planner.port.snapshot() }, now),
  createWikiReferenceProvider(() => globalThis.window?.hqServices?.wiki ?? null, () => now().toISOString()),
]);
