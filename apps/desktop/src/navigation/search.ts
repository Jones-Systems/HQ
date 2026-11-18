import { useEffect, useRef, useState } from 'react';
import { DOMAIN_IDS, isDestination, type DomainId, type ReferenceEnvelope, type ReferencePort } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import { matchScore, rank } from './match';
import type { CommandAction, PaletteCommand } from './commands';
import type { Chord } from './platform';
import { wikiSearchDestination } from './destinations';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 150;
export const SEARCH_LIMIT = 20;

const KIND_WORDS: Readonly<Record<string, string>> = {
  item: 'card', draft: 'draft', run: 'run', brand: 'brand', project: 'project', version: 'version', request: 'request', reference: 'reference', page: 'page',
};

/** `Work card`, `Social draft`, `Design project`. Never the entity id. */
export function describeReference(envelope: Pick<ReferenceEnvelope, 'domain' | 'kind'>): string {
  const word = KIND_WORDS[envelope.kind] ?? envelope.kind.replace(/[-_]+/gu, ' ').toLowerCase();
  return `${DOMAIN_LABELS[envelope.domain]} ${word}`;
}

/** One row in the palette, whether it came from a command or a search result. */
export interface PaletteRow {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly shortcut?: Chord;
  readonly action: CommandAction;
}
export interface PaletteGroup {
  readonly id: string;
  readonly label: string;
  readonly rows: readonly PaletteRow[];
}

export const referenceRowId = (envelope: ReferenceEnvelope): string => `result:${envelope.domain}:${envelope.kind}:${envelope.entityId}`;

export interface BuildGroupsInput {
  readonly query: string;
  readonly commands: readonly PaletteCommand[];
  readonly results: readonly ReferenceEnvelope[];
  readonly currentDomain: DomainId;
}

/**
 * Palette content for a query. Matching commands come first, best match leading; then search results grouped by domain
 * (the current domain first); then a Wiki search fallback. An empty query lists the short browse set in a fixed order.
 */
export function buildGroups({ query, commands, results, currentDomain }: BuildGroupsInput): PaletteGroup[] {
  const text = query.trim();
  const groups: { id: string; label: string; rows: PaletteRow[] }[] = [];
  const push = (id: string, label: string, row: PaletteRow) => {
    const group = groups.find(entry => entry.id === id) ?? (groups[groups.push({ id, label, rows: [] }) - 1]!);
    group.rows.push(row);
  };
  for (const command of rank(text ? commands : commands.filter(entry => entry.browse), text)) {
    push(command.group, command.groupLabel, {
      id: command.id, title: command.title, action: command.action,
      ...(command.detail ? { detail: command.detail } : {}), ...(command.shortcut ? { shortcut: command.shortcut } : {}),
    });
  }
  if (text.length >= SEARCH_MIN_LENGTH) {
    const matching = results.filter(envelope => matchScore(text, envelope.title) !== null);
    const order = [currentDomain, ...DOMAIN_IDS.filter(domain => domain !== currentDomain)];
    for (const domain of order) {
      for (const envelope of rank(matching.filter(entry => entry.domain === domain), text)) {
        push(`found:${domain}`, `In ${DOMAIN_LABELS[domain]}`, {
          id: referenceRowId(envelope), title: envelope.title, detail: describeReference(envelope), action: { type: 'open-reference', envelope },
        });
      }
    }
    const destination = wikiSearchDestination(text);
    if (destination !== null && isDestination(destination)) {
      push('search', 'Search', { id: 'search:wiki', title: `Search Wiki for “${text}”`, action: { type: 'navigate', domain: 'wiki', destination } });
    }
  }
  return groups;
}

export const flattenRows = (groups: readonly PaletteGroup[]): PaletteRow[] => groups.flatMap(group => group.rows);

export type SearchStatus = 'idle' | 'pending' | 'done' | 'failed';
export interface SearchState { readonly status: SearchStatus; readonly results: readonly ReferenceEnvelope[] }
const IDLE: SearchState = { status: 'idle', results: [] };

/**
 * Searches every reference provider through the shell's port once the query is long enough. Typing is debounced,
 * a newer query supersedes an older one, and a failing port leaves the palette usable with a `failed` status.
 * Results from the previous query stay until the new ones arrive; `buildGroups` drops the ones that no longer match.
 */
export function useReferenceSearch(references: Pick<ReferencePort, 'find'> | undefined, projectId: string, query: string, enabled: boolean): SearchState {
  const [state, setState] = useState<SearchState>(IDLE);
  const text = query.trim();
  const active = enabled && references !== undefined && text.length >= SEARCH_MIN_LENGTH;
  // The shell may pass a new wrapper each render; only the query and project restart a search.
  const port = useRef(references);
  port.current = references;
  useEffect(() => {
    if (!active || !port.current) { setState(IDLE); return; }
    let cancelled = false;
    setState(previous => ({ status: 'pending', results: previous.results }));
    const timer = setTimeout(() => {
      port.current?.find(text, { projectId, limit: SEARCH_LIMIT }).then(
        results => { if (!cancelled) setState({ status: 'done', results }); },
        () => { if (!cancelled) setState({ status: 'failed', results: [] }); },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, projectId, text]);
  return active ? state : IDLE;
}
