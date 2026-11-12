import { isDomainId, type DomainId } from '@hq/contracts';
import { serviceStatus, wikiStatus, CHECKING, type DataSource, type SourceStatus } from '../services/data-source-status';
import { describeObservation } from '../services/observed-status';
import { persist, type StoragePort } from '../state';

/** Versioned so a later redesign can ignore, or migrate, what this version wrote. */
export const ONBOARDING_KEY = 'hq.onboarding.v1';
/** Below this workspace width the panel rests as its pill; the card is opened on request. */
export const ONBOARDING_NARROW_PX = 900;

export type PanelState = 'open' | 'collapsed' | 'hidden';
const PANEL_STATES: readonly PanelState[] = ['open', 'collapsed', 'hidden'];
export type UsedFeature = 'palette';
const USED_FEATURES: readonly UsedFeature[] = ['palette'];

export interface OnboardingState {
  readonly state: PanelState;
  /** Domains the user has opened on this profile. */
  readonly visited: Readonly<Partial<Record<DomainId, true>>>;
  /** Features the user has tried on this profile. */
  readonly used: Readonly<Partial<Record<UsedFeature, true>>>;
  /** "You're all set" has already been shown, so it never plays twice. */
  readonly celebrated: boolean;
}

/** A new profile (no stored value) opens the panel. */
export const DEFAULT_ONBOARDING: OnboardingState = { state: 'open', visited: {}, used: {}, celebrated: false };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Defensive like `readNavigation`: anything unreadable falls back field by field, and malformed JSON to the defaults. */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (raw === null) return DEFAULT_ONBOARDING;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return DEFAULT_ONBOARDING; }
  const value = record(parsed);
  if (!value) return DEFAULT_ONBOARDING;
  const state = PANEL_STATES.find(candidate => candidate === value.state) ?? DEFAULT_ONBOARDING.state;
  const visited: Partial<Record<DomainId, true>> = {};
  for (const [key, flag] of Object.entries(record(value.visited) ?? {})) if (isDomainId(key) && flag === true) visited[key] = true;
  const used: Partial<Record<UsedFeature, true>> = {};
  for (const feature of USED_FEATURES) if (record(value.used)?.[feature] === true) used[feature] = true;
  return { state, visited, used, celebrated: value.celebrated === true };
}

export function serializeOnboarding(value: OnboardingState): string {
  return JSON.stringify({ state: value.state, visited: value.visited, used: value.used, celebrated: value.celebrated });
}

/** True when this profile has never stored a panel state, which is what makes a launch the first one. */
export function isFirstRun(storage: StoragePort): boolean {
  try { return storage.getItem(ONBOARDING_KEY) === null; } catch { return true; }
}

export function readOnboarding(storage: StoragePort): OnboardingState {
  try { return parseOnboarding(storage.getItem(ONBOARDING_KEY)); } catch { return DEFAULT_ONBOARDING; }
}

/** False when storage refused the write; the panel keeps working for the session either way. */
export function writeOnboarding(storage: StoragePort, value: OnboardingState): boolean {
  return persist(storage, ONBOARDING_KEY, serializeOnboarding(value));
}

export function setPanelState(value: OnboardingState, state: PanelState): OnboardingState {
  return value.state === state ? value : { ...value, state };
}
/** Returns the same object when nothing changes, so effects that mark flags settle. */
export function markVisited(value: OnboardingState, domain: DomainId): OnboardingState {
  return value.visited[domain] ? value : { ...value, visited: { ...value.visited, [domain]: true } };
}
export function markUsed(value: OnboardingState, feature: UsedFeature): OnboardingState {
  return value.used[feature] ? value : { ...value, used: { ...value.used, [feature]: true } };
}
export function markCelebrated(value: OnboardingState): OnboardingState {
  return value.celebrated ? value : { ...value, celebrated: true };
}

// ---------------------------------------------------------------------------------------------------------------
// What the shell currently knows about each source, in the panel's words. The comparison texts are produced by the
// status module's own constructors, so this follows any rewording there.

export type SourceKind = 'sample' | 'unset' | 'checking' | 'configured' | 'connected' | 'unreachable' | 'ready' | 'indexing' | 'stale' | 'problem';
export interface SourceSummary {
  readonly kind: SourceKind;
  /** The words the panel shows. */
  readonly text: string;
  readonly tone: 'neutral' | 'good' | 'warning';
  /** Whether the user has set this source up. `undefined` while the shell is still checking. */
  readonly configured: boolean | undefined;
}

const SAMPLE_TEXT = serviceStatus({ configured: false, policy: 'ok', transport: null }).text;
const SET_UP_TEXT = serviceStatus({ configured: true, policy: 'ok', transport: 'https' }).text;
const REACHABLE_TEXT = describeObservation({ state: 'reachable', at: 0 }).label;
const UNREACHABLE_TEXT = describeObservation({ state: 'unreachable', at: 0 }).label;
const WIKI_UNSET_TEXT = wikiStatus([]).text;
const WIKI_READY_TEXT = wikiStatus(['ready']).text;
const WIKI_INDEXING_TEXT = wikiStatus(['indexing']).text;
const WIKI_STALE_TEXT = wikiStatus(['stale']).text;

const CHECKING_SUMMARY: SourceSummary = { kind: 'checking', text: CHECKING.text, tone: 'neutral', configured: undefined };

export function summarizeSource(source: DataSource, status: SourceStatus): SourceSummary {
  const { text } = status;
  if (source === 'wiki') {
    if (text === WIKI_UNSET_TEXT) return { kind: 'unset', text: 'Not set up', tone: 'neutral', configured: false };
    if (text === WIKI_READY_TEXT) return { kind: 'ready', text: 'Ready', tone: 'good', configured: true };
    if (text === WIKI_INDEXING_TEXT) return { kind: 'indexing', text: 'Indexing…', tone: 'neutral', configured: true };
    if (text === WIKI_STALE_TEXT) return { kind: 'stale', text, tone: 'warning', configured: true };
  } else {
    if (text === SAMPLE_TEXT) return { kind: 'sample', text: 'Sample data · set up to use your own', tone: 'neutral', configured: false };
    if (text === REACHABLE_TEXT || text.startsWith(`${REACHABLE_TEXT} · `)) return { kind: 'connected', text, tone: 'good', configured: true };
    if (text === SET_UP_TEXT) return { kind: 'configured', text, tone: 'neutral', configured: true };
    if (text === UNREACHABLE_TEXT || text.startsWith(`${UNREACHABLE_TEXT} · `)) return { kind: 'unreachable', text, tone: 'warning', configured: true };
  }
  // Anything else that the shell marks as a problem ("Address rejected", "Index unavailable") is shown as it says.
  return status.tone === 'bad' ? { kind: 'problem', text, tone: 'warning', configured: false } : CHECKING_SUMMARY;
}

export type SourceSummaries = Readonly<Record<DataSource, SourceSummary>>;
export function summarizeSources(statuses: Readonly<Record<DataSource, SourceStatus>>): SourceSummaries {
  return { social: summarizeSource('social', statuses.social), work: summarizeSource('work', statuses.work), wiki: summarizeSource('wiki', statuses.wiki) };
}

// ---------------------------------------------------------------------------------------------------------------
// The checklist.

export type ChecklistId = 'look-around' | 'connect-work' | 'connect-social' | 'add-wiki' | 'command-palette';
export const CHECKLIST_IDS: readonly ChecklistId[] = ['look-around', 'connect-work', 'connect-social', 'add-wiki', 'command-palette'];

export interface ChecklistItem {
  readonly id: ChecklistId;
  readonly label: string;
  /** One quiet line under the label. */
  readonly hint: string;
  /** `undefined` while it depends on a source the shell is still checking. */
  readonly done: boolean | undefined;
}

/** What each checklist button does. The component turns it into a navigation or a window event. */
export type ChecklistAction =
  | { readonly type: 'navigate'; readonly domain: DomainId; readonly destination: string }
  | { readonly type: 'open-settings'; readonly source: DataSource }
  | { readonly type: 'open-command-palette' };

export const OPEN_SETTINGS_EVENT = 'hq-open-settings';
export const OPEN_COMMAND_PALETTE_EVENT = 'hq-open-command-palette';
export const SHOW_WELCOME_EVENT = 'hq-show-welcome';

/** The two places the "look around" step visits: Social's overview, then Work's status board. */
const LOOK_AROUND = { social: 'overview', work: 'board' } as const;

export function checklistAction(id: ChecklistId, state: OnboardingState): ChecklistAction {
  switch (id) {
    case 'look-around': { const domain = state.visited.social ? 'work' : 'social'; return { type: 'navigate', domain, destination: LOOK_AROUND[domain] }; }
    case 'connect-work': return { type: 'open-settings', source: 'work' };
    case 'connect-social': return { type: 'open-settings', source: 'social' };
    case 'add-wiki': return { type: 'open-settings', source: 'wiki' };
    case 'command-palette': return { type: 'open-command-palette' };
  }
}

function connectHint(name: string, summary: SourceSummary): string {
  switch (summary.kind) {
    case 'sample': return `${name} shows sample data until you do`;
    case 'configured': return 'Set up · not checked yet';
    case 'connected': return summary.text;
    case 'unreachable': return 'Unreachable · check the address in Data sources';
    case 'problem': return `${summary.text} · check Data sources`;
    default: return 'Checking…';
  }
}

export function platformShortcut(platform: string): string { return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K'; }

export function evaluateChecklist(state: OnboardingState, sources: SourceSummaries, shortcut: string): readonly ChecklistItem[] {
  const sample = sources.social.kind === 'sample' && sources.work.kind === 'sample';
  const wikiHint = sources.wiki.kind === 'unset' ? 'Point HQ at a local repository'
    : sources.wiki.kind === 'problem' ? `${sources.wiki.text} · check Data sources`
    : sources.wiki.kind === 'checking' ? 'Checking…' : sources.wiki.text;
  return [
    { id: 'look-around', label: sample ? 'Take a look around with sample data' : 'Take a look around Social and Work',
      hint: sample ? 'Fictional examples, kept only for this session' : 'Open each to see how it works',
      done: !!state.visited.social && !!state.visited.work },
    { id: 'connect-work', label: 'Connect Work (Planner)', hint: connectHint('Work', sources.work), done: sources.work.configured },
    { id: 'connect-social', label: 'Connect Social', hint: connectHint('Social', sources.social), done: sources.social.configured },
    { id: 'add-wiki', label: 'Add a Wiki repository', hint: wikiHint, done: sources.wiki.configured },
    { id: 'command-palette', label: `Jump anywhere with ${shortcut}`, hint: 'Search and go to anything', done: !!state.used.palette },
  ];
}

export interface Progress { readonly done: number; readonly total: number; readonly complete: boolean }
/** `known` fills in for items that depend on a source the shell is still checking. */
export function checklistProgress(items: readonly ChecklistItem[], known: Readonly<Partial<Record<ChecklistId, boolean>>> = {}): Progress {
  const done = items.filter(item => item.done ?? known[item.id] ?? false).length;
  return { done, total: items.length, complete: done === items.length };
}
