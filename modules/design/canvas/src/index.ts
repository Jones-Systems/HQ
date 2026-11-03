/**
 * Framework-free public entry for the Design canvas section. React views live
 * in `./view/index.ts`; labelled fakes live in `./fakes.ts` and are not
 * re-exported here so products never depend on them.
 */
export * from './contract.ts';
export * from './geometry.ts';
export * from './arrangement.ts';
export * from './snap.ts';
export * from './history.ts';
export * from './input.ts';
export * from './codec.ts';
export * from './providers.ts';
export * from './inspector.ts';
export * from './controller.ts';
