import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import { SocialModule } from '@hq/social';
import { WorkModule } from '@hq/work';
import { designDomain } from '../../../modules/design/app/index.ts';

export const DOMAIN_LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work' };

/** Each domain's independently owned module entry. Design's is built once at module scope (keep-alive chrome state). */
export const MODULES: Readonly<Record<DomainId, ComponentType<ModulePort>>> = {
  design: designDomain.Component,
  social: SocialModule,
  work: WorkModule,
};
