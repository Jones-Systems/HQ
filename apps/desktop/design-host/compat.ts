import type { DesignStorage } from '../../../modules/design/app/storage/node.ts';
import type { DesignStore } from '../electron/design-host.js';
type Assert<T extends true> = T;
export type DesignStorageCompatibility = Assert<DesignStorage extends DesignStore ? true : false>;

import type { BuiltLocalCatalog } from '../../../modules/design/discovery/node/local-directory.ts';
import type { BuiltCatalog } from '../electron/catalog-host.js';
import type { WriteOp } from '../../../modules/design/imports/src/contract.ts';
import type { ImportWriteOp } from '@hq/contracts/design-records';
export type CatalogCompatibility = Assert<BuiltLocalCatalog extends BuiltCatalog ? true : false>;
export type ImportCompatibility = [Assert<WriteOp extends ImportWriteOp ? true : false>, Assert<ImportWriteOp extends WriteOp ? true : false>];
