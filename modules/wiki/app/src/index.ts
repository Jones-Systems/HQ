/**
 * Production entry for the Wiki module (task.wiki-assembly.001). The HQ shell mounts exactly this:
 *
 *   import { createWikiDomain } from '../../../modules/wiki/app/src/index.ts';   // or '@hq/wiki' once registered
 *   // slot:         wiki: createWikiDomain({ getPort }).Component
 *   // presentation: 'fill'
 *
 * `getPort` returns the preload bridge of iface.wiki-host-ipc.001 (exactly the seven `WikiService` methods) or null.
 * Renderer/Vite only: the two stylesheets are imported as files, so the build emits them as external CSS that works
 * under `style-src 'self'`. Tests import `./domain.ts` instead, which has no stylesheet import.
 *
 * Registered capabilities: none. No transport, filesystem, shell, refresh or home migration is reachable from here.
 *
 * `createWikiReferenceProvider(service, now)` makes Wiki pages a read-only cross-module reference target: the shell
 * registers it next to the other reference providers. It only calls `search` and `getPage` on the service it is given.
 */
import '../../ui/src/wiki-view.css';
import './wiki-domain.css';

export { createWikiDomain } from './domain.ts';
export type { WikiDomain, WikiDomainOptions } from './domain.ts';
export { createWikiClient } from './client.ts';
export { createWikiReferenceProvider, WIKI_REVISION_PREFIX } from './references.ts';
export type {
  WikiReferenceEnvelope,
  WikiReferenceInput,
  WikiReferenceProvider,
  WikiReferenceResolution,
  WikiReferenceStatus,
} from './references.ts';
export type { WikiHostPort, WikiModulePort } from './port.ts';
