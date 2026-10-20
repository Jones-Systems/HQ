import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import { SocialModule } from '@hq/social';
import { WorkModule } from '@hq/work';

export const DOMAIN_LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work' };

function ModuleSlot({ domain, destination }: ModulePort & { domain: DomainId }) {
  return <section className="module-slot" aria-labelledby="module-title">
    <span className="eyebrow">{DOMAIN_LABELS[domain]} module</span>
    <h1 id="module-title">{domain === 'design' ? 'A place for Design.' : `${DOMAIN_LABELS[domain]} is not available yet.`}</h1>
    <p>{domain === 'design' ? 'The shared workspace is ready. Design will appear here when its module is integrated.' : 'This module has its own home in HQ. Its features will arrive independently.'}</p>
    <dl><dt>Destination</dt><dd>{destination}</dd><dt>Status</dt><dd>Awaiting module integration</dd></dl>
  </section>;
}

/** Integration owner replaces a slot with the independently owned module entry. */
export const MODULES: Readonly<Record<DomainId, ComponentType<ModulePort>>> = {
  design: (props) => <ModuleSlot {...props} domain="design" />,
  social: SocialModule,
  work: WorkModule,
};
