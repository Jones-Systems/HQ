import { isJsonObject, type RunRecord, type ToolId } from '../core';

/**
 * Tool-specific result summaries (RR-4). A finished run's `output` is the worker's envelope:
 * `{ ok: true, result }` or `{ ok: false, error }`. Only the result fields the delivered recipes read are
 * interpreted here; everything else stays in the raw JSON disclosure and the receipt download.
 */

export interface SummaryFact {
  readonly label: string;
  readonly value: string;
}

export interface SummaryEntry {
  readonly title: string;
  readonly detail?: string;
  readonly meta?: string;
  /** A short status word for the entry, always shown as text. */
  readonly status?: { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' | 'neutral' };
}

export interface ResultSummary {
  readonly kind: 'result' | 'failed' | 'unrecognized';
  readonly heading: string;
  readonly facts: readonly SummaryFact[];
  readonly entries: readonly SummaryEntry[];
  /** How many entries exist beyond those listed. */
  readonly more: number;
  readonly notices: readonly string[];
  readonly error?: string;
  /** Text a draft can start from; the full draft is always reviewed and saved explicitly. */
  readonly draftText?: string;
}

const ENTRY_LIMIT = 20;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function words(key: string): string {
  return key.replaceAll('_', ' ');
}

function capped(entries: SummaryEntry[]): { entries: SummaryEntry[]; more: number } {
  return { entries: entries.slice(0, ENTRY_LIMIT), more: Math.max(0, entries.length - ENTRY_LIMIT) };
}

/** Facts for a result whose fields HQ does not interpret: one line per top-level field. */
function fieldFacts(result: Record<string, unknown>): SummaryFact[] {
  return Object.entries(result).map(([key, value]) => ({
    label: words(key),
    value: Array.isArray(value) ? plural(value.length, 'record')
      : isJsonObject(value) ? plural(Object.keys(value).length, 'field')
        : value === null ? 'Not supplied' : String(value),
  }));
}

/** Delivered wording for Channel preview's failed rule IDs. */
export function channelFindingText(ruleId: string): string {
  if (ruleId.endsWith('.format')) return 'This native adapter needs video; text-only content is not supported.';
  if (ruleId.endsWith('.owner_scope')) return 'Account ownership and access have not been supplied.';
  if (ruleId.endsWith('.caption')) return 'Caption exceeds the local length profile.';
  return `${words(ruleId.split('.').pop() ?? ruleId)}: not supplied or not qualified`;
}

type Summarizer = (result: Record<string, unknown>) => Omit<ResultSummary, 'kind'>;

const SUMMARIZERS: { readonly [T in ToolId]: Summarizer } = {
  'x-studio'(result) {
    const blocks = list(isJsonObject(result.content) ? result.content.blocks : undefined).map((block) => (isJsonObject(block) ? text(block.text) : undefined)).filter((block): block is string => Boolean(block));
    const body = blocks.join('\n\n');
    return {
      heading: blocks.length ? 'Your first draft' : 'No draft text returned',
      facts: [{ label: 'Blocks', value: String(blocks.length) }],
      entries: [], more: 0,
      notices: ['Unreviewed local draft. Claims and first-person statements need your review.'],
      ...(body ? { draftText: body } : {}),
    };
  },
  'social-publisher'(result) {
    const channels = list(result.channels).filter(isJsonObject);
    const entries = channels.map((channel): SummaryEntry => {
      const failures = list(channel.findings).filter((finding) => isJsonObject(finding) && finding.status === 'fail') as Record<string, unknown>[];
      return {
        title: (text(channel.platform) ?? 'Channel').toUpperCase(),
        status: failures.length ? { label: plural(failures.length, 'preparation gap'), tone: 'warning' } : { label: 'Text checks passed', tone: 'success' },
        detail: failures.length ? failures.map((finding) => channelFindingText(text(finding.rule_id) ?? 'rule')).join(' ') : 'Local text checks passed · native acceptance unverified',
      };
    });
    const gaps = entries.filter((entry) => entry.status?.tone === 'warning').length;
    return {
      heading: `${plural(channels.length, 'channel profile')} checked`,
      facts: [{ label: 'Channels with gaps', value: String(gaps) }],
      ...capped(entries),
      notices: [text(result.qualification) ?? 'Offline text preparation only. No posting occurs.'],
      draftText: entries.map((entry) => `${entry.title}: ${entry.status?.label}. ${entry.detail}`).join('\n'),
    };
  },
  'x-intelligence'(result) {
    const evidence = list(result.evidence).filter(isJsonObject);
    const entries = evidence.map((record): SummaryEntry => ({ title: text(record.title) ?? 'Supplied observation', detail: text(record.text) ?? 'Open the native findings for this record.' }));
    const counts = isJsonObject(result.counts) ? Object.entries(result.counts).map(([key, value]) => ({ label: words(key), value: String(value) })) : [];
    return {
      heading: plural(evidence.length, 'evidence record'), facts: counts, ...capped(entries), notices: [],
      draftText: entries.map((entry) => `- ${entry.title}: ${entry.detail}`).join('\n'),
    };
  },
  'creator-relationships'(result) {
    const creators = list(result.creators).filter(isJsonObject);
    const entries = creators.map((creator, index): SummaryEntry => {
      const matches = list(creator.niche_matches).filter((topic): topic is string => typeof topic === 'string');
      const missing = isJsonObject(creator.missing_evidence) ? Object.keys(creator.missing_evidence) : [];
      const age = typeof creator.age_days === 'number' ? `Evidence age ${creator.age_days.toFixed(1)} days` : 'Evidence age unknown';
      return {
        title: text(creator.name) ?? text(creator.handle) ?? text(creator.identity_id) ?? `Creator ${index + 1}`,
        status: { label: words(text(creator.status) ?? 'unrated'), tone: missing.length ? 'warning' : 'neutral' },
        detail: `Topics: ${matches.join(', ') || 'no matched topics'}`,
        meta: `${age} · Missing: ${missing.map(words).join(', ') || 'none required by this policy'}`,
      };
    });
    return {
      heading: plural(creators.length, 'creator assessment'), facts: [], ...capped(entries),
      notices: ['Rankings explain fit from supplied evidence only. No messages, outreach or account actions.'],
      draftText: entries.map((entry) => `- ${entry.title} (${entry.status?.label}): ${entry.detail}. ${entry.meta}`).join('\n'),
    };
  },
  'seo-studio'(result) {
    const passed = result.ok === true;
    return {
      heading: passed ? 'Article packets passed validation' : 'Some article packets need attention',
      facts: fieldFacts(result).filter((fact) => fact.label !== 'ok'), entries: [], more: 0,
      notices: [passed ? 'Article packet validation passed. Publication and editorial approval remain separate.' : 'Expand the native findings to see which packets need attention.'],
    };
  },
  'reddit-opportunities'(result) {
    return {
      heading: 'Corpus analysis saved', facts: fieldFacts(result).filter((fact) => fact.label !== 'profile'), entries: [], more: 0,
      notices: [text(result.profile) ?? 'Rankings apply to the built-in example product profile.'],
    };
  },
  'tiktok-intelligence'(result) {
    return { heading: 'Snapshot analysis saved', facts: fieldFacts(result), entries: [], more: 0, notices: ['Analysis of the supplied snapshots only, as of the date you supplied. No TikTok access.'] };
  },
  'search-visibility'(result) {
    return { heading: 'Visibility analysis saved', facts: fieldFacts(result), entries: [], more: 0, notices: ['Analysis of the supplied answer observations only. No search-engine queries.'] };
  },
};

/** A finished run's summary; `undefined` while the run has no output to show. */
export function summarizeRun(run: Pick<RunRecord, 'tool' | 'status' | 'error' | 'output'>): ResultSummary | undefined {
  const output = run.output;
  if (output === undefined) {
    if (run.status === 'failed' || run.status === 'interrupted') {
      return { kind: 'failed', heading: run.status === 'interrupted' ? 'Run interrupted' : 'Run failed', facts: [], entries: [], more: 0, notices: [], error: run.error ?? 'No error was recorded.' };
    }
    return undefined;
  }
  if (isJsonObject(output) && output.ok === false) {
    return { kind: 'failed', heading: 'The tool reported an error', facts: [], entries: [], more: 0, notices: [], error: text(output.error) ?? run.error ?? 'No error was recorded.' };
  }
  if (!isJsonObject(output) || output.ok !== true || !isJsonObject(output.result)) {
    return { kind: 'unrecognized', heading: 'Result shape not recognized', facts: [], entries: [], more: 0, notices: ['HQ could not read this result. The raw JSON and the receipt download keep it unchanged.'] };
  }
  return { kind: 'result', ...SUMMARIZERS[run.tool](output.result) };
}
