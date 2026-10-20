import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import { SERVICE_DOMAINS } from './services/domains';
import { designDomain } from '../../../modules/design/app/index.ts';

export const DOMAIN_LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work' };

/** Each domain's independently owned module entry. Design's is built once at module scope (keep-alive chrome state). */
export const MODULES: Readonly<Record<DomainId, ComponentType<ModulePort>>> = {
  design: designDomain.Component,
  social: SERVICE_DOMAINS.Social,
  work: SERVICE_DOMAINS.Work,
};

/** Module-area presentation per domain. 'fill' modules get the whole workspace below the context bar, unpadded. */
export const MODULE_PRESENTATION: Readonly<Partial<Record<DomainId, 'fill'>>> = { design: designDomain.presentation };
