import type {} from '@hq/contracts/services';
import type { DesktopPort } from '@hq/contracts';
import type { UpdatesPort } from '@hq/contracts/updates';

declare global {
  interface Window { readonly hqDesktop?: DesktopPort; readonly hqUpdates?: UpdatesPort }
}
