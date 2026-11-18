import { expect, it } from 'vitest';
import { REFERENCE_STATUSES, type ReferencePort, type ReferenceResolution, type ReturnContext } from './references';
import type * as Ui from '../../hq-ui/src/references/types';
import type { ModulePort } from './index';
type Assert<T extends true> = T;
export type ReferenceCompatibility = [Assert<ReferencePort extends Ui.ReferencePort ? true : false>, Assert<Ui.ReferencePort extends ReferencePort ? true : false>, Assert<ReferenceResolution extends Ui.ReferenceResolution ? true : false>, Assert<Ui.ReferenceResolution extends ReferenceResolution ? true : false>, Assert<ReturnContext extends Ui.ReturnContext ? true : false>, Assert<Ui.ReturnContext extends ReturnContext ? true : false>];
export type OptionalCompatibility = Assert<Omit<ModulePort, 'references' | 'returnContext'> extends ModulePort ? true : false>;
export type NoExecution = Assert<keyof ReferencePort extends 'find' | 'resolve' | 'open' ? true : false>;
it('keeps the eight frozen reference statuses and UI structural contract', () => {
  expect(REFERENCE_STATUSES).toEqual(['available', 'changed', 'archived', 'missing', 'moved', 'forbidden', 'unavailable', 'unknown']);
});
