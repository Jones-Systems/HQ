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
 */
import '../../ui/src/wiki-view.css';
import './wiki-domain.css';

export { createWikiDomain } from './domain.ts';
export type { WikiDomain, WikiDomainOptions } from './domain.ts';
export { createWikiClient } from './client.ts';
export type { WikiHostPort, WikiModulePort } from './port.ts';
