import type { DomainId } from '@hq/contracts';

export const DOMAIN_LABELS: Readonly<Record<DomainId, string>> = { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' };
export type ModulePresentation = Readonly<Partial<Record<DomainId, 'fill'>>>;
