import type { ComponentType } from 'react';
import type { DomainId, ModulePort } from '@hq/contracts';
import { SERVICE_DOMAINS } from './services/domains';
import { createWikiDomain, type WikiHostPort, type WikiModulePort } from '@hq/wiki';
import type { WikiServiceTransport } from '@hq/contracts/wiki';
import type { WikiService } from '../../../modules/wiki/contract/src/index.ts';

type Assert<T extends true> = T;
export type WikiCompatibility = [Assert<WikiServiceTransport extends WikiHostPort ? true : false>, Assert<WikiService extends WikiServiceTransport ? true : false>, Assert<ModulePort extends WikiModulePort ? true : false>];
const wiki = createWikiDomain({ getPort: () => window.hqServices?.wiki ?? null });

import { createDesignComposition } from '../../../modules/design/app/index.ts';
import { desktopPreview, createJonesConnection, selectDesktopProject } from './interactive-runtime';
const jonesConnection = createJonesConnection(window.hqServices?.jonesCode);
void jonesConnection.refresh();
window.addEventListener('hq-sources-changed', () => { void jonesConnection.refresh(); });
export const { designDomain, designReferenceReads } = createDesignComposition({
  preview: desktopPreview, runsConnection: jonesConnection.connection, onSelectProject: selectDesktopProject,
  sources: { async list() { const result = await window.hqServices?.sources?.call('list', {}); if (!result?.ok) throw Error('Project sources unavailable'); return result.value; } },
});

export const DOMAIN_LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' };

/** Each domain's independently owned module entry. Design's is built once at module scope (keep-alive chrome state). */
export const MODULES: Readonly<Record<DomainId, ComponentType<ModulePort>>> = {
  design: designDomain.Component,
  social: SERVICE_DOMAINS.Social,
  work: SERVICE_DOMAINS.Work,
  wiki: wiki.Component,
};

/** Module-area presentation per domain. 'fill' modules own their internal scrolling; all module mounts are unpadded. */
export const MODULE_PRESENTATION: Readonly<Partial<Record<DomainId, 'fill'>>> = { design: designDomain.presentation, wiki: wiki.presentation };
