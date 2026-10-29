import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import { MODULES, MODULE_PRESENTATION } from './modules';
import { REFERENCE_PROVIDERS } from './reference-providers';
import { PresentationShell } from './PresentationShell';

export function App({ modules = MODULES }: { modules?: Readonly<Record<DomainId, ComponentType<ModulePort>>> } = {}) {
  return <PresentationShell modules={modules} presentation={MODULE_PRESENTATION} referenceProviders={REFERENCE_PROVIDERS} />;
}
