import type {} from '@hq/contracts/services';
import type { DesktopPort } from '@hq/contracts';

declare global {
  interface Window { readonly hqDesktop?: DesktopPort }
}
