import type { DesignStorage } from '../../../modules/design/app/storage/node.ts';
import type { DesignStore } from '../electron/design-host.js';
type Assert<T extends true> = T;
export type DesignStorageCompatibility = Assert<DesignStorage extends DesignStore ? true : false>;
