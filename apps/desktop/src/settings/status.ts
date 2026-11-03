import type { StatusTone } from '@hq/ui';
import type { WikiAdminNamespace, WikiSourceState } from '@hq/contracts/wiki-admin';
import type { SourceStatus as CatalogSourceStatus } from '@hq/contracts/catalog';
import type { JonesStatus } from '@hq/contracts/jones-code';
import type { DataSource, SourceStatus } from '../services/data-source-status';

/** Plain words for a status: a shape comes from the tone, the word is always shown, raw enums never are. */
export interface Chip { readonly tone: StatusTone; readonly label: string; readonly detail?: string; readonly busy?: boolean }

export const WIKI_NAMES: Readonly<Record<WikiAdminNamespace, string>> = { bl: 'BusinessLessons', appdev: 'App Development' };
export const WIKI_NAMESPACES = ['bl', 'appdev'] as const satisfies readonly WikiAdminNamespace[];

/** Maps the observed status text the shell store reports to a chip. Unknown text falls back to its own words. */
export function chipFor(status: SourceStatus): Chip {
  switch (status.text) {
    case 'Checking…': return { tone: 'neutral', label: 'Checking…', busy: true };
    case 'Unavailable': case 'Index unavailable': return { tone: 'unavailable', label: 'Unavailable' };
    case 'Address rejected': return { tone: 'danger', label: 'Address rejected' };
    case 'Sample data · not set up': return { tone: 'neutral', label: 'Sample data', detail: 'not set up' };
    case 'Set up · not checked': return { tone: 'unknown', label: 'Set up · not checked' };
    case 'Reachable': return { tone: 'success', label: 'Reachable' };
    case 'Unreachable': return { tone: 'danger', label: 'Unreachable' };
    case 'Index not checked': return { tone: 'unknown', label: 'Not checked' };
    case 'Not set up': return { tone: 'neutral', label: 'Not set up' };
    case 'Index ready': return { tone: 'success', label: 'Ready' };
    case 'Indexing': return { tone: 'neutral', label: 'Indexing', busy: true };
    case 'Index stale': return { tone: 'warning', label: 'Stale' };
    default: return { tone: status.tone === 'good' ? 'success' : status.tone === 'bad' ? 'warning' : 'neutral', label: status.text };
  }
}

export const SERVICE_BLURB: Record<'social' | 'work', string> = {
  social: 'Content, drafts and calendar planning through the Social service.',
  work: 'Tasks and planning through the Work service.',
};

/** One line for the Overview row: what the status means for this source and what to do about it. */
export function detailFor(source: DataSource, status: SourceStatus): string {
  switch (status.text) {
    case 'Checking…': return 'Checking now.';
    case 'Sample data · not set up': return `Showing sample data kept in this window. Add an address to use the ${source === 'social' ? 'Social' : 'Work'} service.`;
    case 'Set up · not checked': return 'An address is saved. Check the connection to confirm it answers.';
    case 'Reachable': return 'The service answered the last check.';
    case 'Unreachable': return 'The saved address did not answer. It was kept.';
    case 'Address rejected': return 'The address was not allowed. Save an allowed one to connect.';
    case 'Unavailable': return source === 'wiki' ? 'Native Wiki management could not be read.' : 'Service settings could not be read in this window.';
    case 'Index not checked': return 'Recheck to read the state of each repository.';
    case 'Not set up': return 'Import a source profile to search a local repository.';
    case 'Index ready': return 'Search and reading use your local repositories.';
    case 'Indexing': return 'Building the search index. It updates here when finished.';
    case 'Index stale': return 'An index is out of date. Reindex it from Local Wiki.';
    case 'Index unavailable': return 'An index or repository could not be read. This is not a host outage.';
    default: return status.text;
  }
}

const SOURCE_KIND: Record<CatalogSourceStatus['kind'], string> = { local: 'local folder', gallery: 'gallery', jones: 'Jones' };
/** Ready, stale, partial, unavailable or not set up for one project source, in words. */
export function projectSourceChip(state: CatalogSourceStatus['state']): Chip {
  switch (state) {
    case 'ready': return { tone: 'success', label: 'Ready' };
    case 'partial': return { tone: 'warning', label: 'Partly read' };
    case 'stale': return { tone: 'warning', label: 'Stale' };
    case 'unavailable': return { tone: 'unavailable', label: 'Unavailable' };
    case 'not-configured': return { tone: 'neutral', label: 'Not set up' };
  }
}
export const projectSourceKind = (kind: CatalogSourceStatus['kind']) => SOURCE_KIND[kind];

/** Overview chip and line for the enrolled project sources, computed from the catalog status alone. */
export function projectsSummary(rows: readonly CatalogSourceStatus[] | undefined): { chip: Chip; detail: string } {
  if (!rows) return { chip: { tone: 'unavailable', label: 'Unavailable' }, detail: 'Native source enrollment is not available in this window.' };
  if (rows.length === 0) return { chip: { tone: 'neutral', label: 'Not set up' }, detail: 'Enroll a local projects folder, a gallery or Jones projects.' };
  const worst = rows.find(row => row.state === 'unavailable') ?? rows.find(row => row.state === 'stale' || row.state === 'partial');
  const count = `${rows.length} source${rows.length === 1 ? '' : 's'}`;
  if (worst) return { chip: projectSourceChip(worst.state), detail: `${count} enrolled. ${worst.label} needs a refresh.` };
  return { chip: { tone: 'success', label: 'Ready' }, detail: `${count} enrolled and up to date.` };
}

export const JONES_STATE: Record<JonesStatus['state'], Chip> = {
  'not-configured': { tone: 'neutral', label: 'Not set up' },
  'needs-authorization': { tone: 'warning', label: 'Needs authorization' },
  authorizing: { tone: 'neutral', label: 'Authorizing…', busy: true },
  connected: { tone: 'success', label: 'Connected' },
  unavailable: { tone: 'unavailable', label: 'Unavailable' },
};

/** Overview chip and line for Jones change requests. Delivery stays unqualified until native qualification. */
export function jonesSummary(status: JonesStatus | undefined): { chip: Chip; detail: string } {
  if (!status) return { chip: { tone: 'unavailable', label: 'Unavailable' }, detail: 'Native Jones connection is not available in this window.' };
  const chip = JONES_STATE[status.state];
  const qualified = status.descriptor.qualification.level === 'qualified';
  const detail = status.state === 'not-configured' ? 'Save a Jones connection to prepare change requests.'
    : status.state === 'needs-authorization' ? 'Authorize in your browser to finish connecting.'
    : status.state === 'connected' ? (qualified ? 'Connected and qualified for delivery.' : 'Connected. Delivery stays off until it is qualified.')
    : status.state === 'authorizing' ? 'Waiting for the browser authorization.' : 'The connection could not be read.';
  return { chip, detail };
}

export function wikiRowChip(state: WikiSourceState): Chip {
  switch (state) {
    case 'ready': return { tone: 'success', label: 'Ready' };
    case 'stale': return { tone: 'warning', label: 'Stale' };
    case 'indexing': return { tone: 'neutral', label: 'Indexing', busy: true };
    case 'index-unavailable': case 'source-unavailable': return { tone: 'unavailable', label: 'Unavailable' };
    case 'not-configured': return { tone: 'neutral', label: 'Not set up' };
  }
}

/** The sentence under a repository name: what the state means, without raw enums. */
export function wikiRowDetail(state: WikiSourceState): string {
  switch (state) {
    case 'ready': return 'Indexed and ready to search.';
    case 'stale': return 'The index is behind the repository. Reindex to catch up.';
    case 'indexing': return 'Building the search index.';
    case 'index-unavailable': return 'The index could not be read. Reindex to rebuild it.';
    case 'source-unavailable': return 'The repository could not be read. Check that it is the one in the profile.';
    case 'not-configured': return 'No repository yet. Import its source profile to set it up.';
  }
}
