import { DOMAIN_IDS, type Appearance, type DomainId, type ReferenceEnvelope } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import { SOURCE_NAMES, type DataSource } from '../services/data-source-status';
import { backChord, domainChord, SETTINGS_CHORD, type Chord } from './platform';
import { sectionDestinations } from './destinations';

/** `window` events other lanes use to talk to the palette and the welcome screen. */
export const OPEN_PALETTE_EVENT = 'hq-open-command-palette';
export const SHOW_WELCOME_EVENT = 'hq-show-welcome';

export type SettingsTarget = DataSource | 'appearance' | null;

export type CommandAction =
  | { readonly type: 'navigate'; readonly domain: DomainId; readonly destination?: string }
  | { readonly type: 'settings'; readonly target: SettingsTarget }
  | { readonly type: 'appearance'; readonly value: Appearance }
  | { readonly type: 'welcome' }
  | { readonly type: 'back' }
  | { readonly type: 'open-reference'; readonly envelope: ReferenceEnvelope };

/** What running a command may do. The shell supplies these; the palette never touches shell state directly. */
export interface PaletteEffects {
  navigate(domain: DomainId, destination?: string): void;
  openSettings(target: SettingsTarget): void;
  setAppearance(value: Appearance): void;
  showWelcome(): void;
  back(): void;
  openReference(envelope: ReferenceEnvelope): void;
}

export function runAction(action: CommandAction, effects: PaletteEffects): void {
  switch (action.type) {
    case 'navigate': effects.navigate(action.domain, action.destination); break;
    case 'settings': effects.openSettings(action.target); break;
    case 'appearance': effects.setAppearance(action.value); break;
    case 'welcome': effects.showWelcome(); break;
    case 'back': effects.back(); break;
    case 'open-reference': effects.openReference(action.envelope); break;
  }
}

export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  /** Stable group id; the label is `groupLabel`. */
  readonly group: string;
  readonly groupLabel: string;
  /** Muted text after the title, for example `Current`. */
  readonly detail?: string;
  readonly keywords: readonly string[];
  readonly shortcut?: Chord;
  /** False hides the command until the user types, so the empty palette stays short. */
  readonly browse: boolean;
  readonly action: CommandAction;
}

export interface CommandContext {
  readonly domain: DomainId;
  readonly settingsOpen: boolean;
  readonly appearance: Appearance;
  readonly back: { readonly label: string } | null;
  readonly mac: boolean;
}

const APPEARANCE_CHOICES: readonly { value: Appearance; title: string; keywords: readonly string[] }[] = [
  { value: 'light', title: 'Light', keywords: ['theme', 'bright', 'day'] },
  { value: 'dark', title: 'Dark', keywords: ['theme', 'night'] },
  { value: 'system', title: 'Follow system', keywords: ['theme', 'auto', 'automatic', 'device', 'os'] },
];

const SETTINGS_COMMANDS: readonly { id: string; title: string; target: SettingsTarget; keywords: readonly string[]; shortcut?: Chord }[] = [
  { id: 'settings:open', title: 'Open Settings', target: null, keywords: ['preferences', 'options', 'configure'], shortcut: SETTINGS_CHORD },
  { id: 'settings:sources', title: 'Data sources', target: null, keywords: ['services', 'connections', 'addresses', 'setup', 'set up'] },
  { id: 'settings:social', title: `${SOURCE_NAMES.social} data source`, target: 'social', keywords: ['service', 'connection', 'address'] },
  { id: 'settings:work', title: `${SOURCE_NAMES.work} data source`, target: 'work', keywords: ['service', 'connection', 'address', 'planner'] },
  { id: 'settings:wiki', title: `${SOURCE_NAMES.wiki} source`, target: 'wiki', keywords: ['repository', 'connection', 'knowledge', 'wiki'] },
  { id: 'settings:appearance', title: 'Appearance settings', target: 'appearance', keywords: ['theme', 'colors', 'colours', 'palette'] },
];

/**
 * Every command the palette can run. The shell supplies where the user is and what is available; this stays pure so
 * the set can be tested without a DOM. Destinations come from `destinations.ts`, which reuses each module's route code.
 */
export function buildCommands(context: CommandContext): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  if (context.back) {
    commands.push({
      id: 'go:back', title: `Back to ${context.back.label}`, group: 'go', groupLabel: 'Go to', keywords: ['return', 'previous', 'back'],
      shortcut: backChord(context.mac), browse: true, action: { type: 'back' },
    });
  }
  DOMAIN_IDS.forEach((domain, index) => {
    const here = !context.settingsOpen && domain === context.domain;
    commands.push({
      id: `go:${domain}`, title: DOMAIN_LABELS[domain], group: 'go', groupLabel: 'Go to', keywords: ['go to', 'open', 'switch', 'domain'],
      shortcut: domainChord(index), browse: true, action: { type: 'navigate', domain },
      ...(here ? { detail: 'Current' } : {}),
    });
  });
  // The current domain's sections come first, so an ambiguous name ("Calendar", "Review") means the one the user is in.
  for (const domain of [context.domain, ...DOMAIN_IDS.filter(other => other !== context.domain)]) {
    for (const section of sectionDestinations(domain)) {
      commands.push({
        id: `section:${domain}:${section.destination}`, title: section.label, group: `section:${domain}`, groupLabel: DOMAIN_LABELS[domain],
        keywords: [DOMAIN_LABELS[domain], 'go to', 'open', ...section.keywords], browse: domain === context.domain,
        action: { type: 'navigate', domain, destination: section.destination },
      });
    }
  }
  for (const item of SETTINGS_COMMANDS) {
    commands.push({
      id: item.id, title: item.title, group: 'settings', groupLabel: 'Settings', keywords: ['settings', ...item.keywords],
      browse: item.id === 'settings:open' || item.id === 'settings:sources' || item.id === 'settings:appearance',
      action: { type: 'settings', target: item.target }, ...(item.shortcut ? { shortcut: item.shortcut } : {}),
    });
  }
  for (const choice of APPEARANCE_CHOICES) {
    commands.push({
      id: `appearance:${choice.value}`, title: choice.title, group: 'appearance', groupLabel: 'Appearance', keywords: ['appearance', 'color', 'mode', ...choice.keywords],
      browse: true, action: { type: 'appearance', value: choice.value }, ...(choice.value === context.appearance ? { detail: 'Current' } : {}),
    });
  }
  commands.push({
    id: 'help:welcome', title: 'Show getting started', group: 'help', groupLabel: 'Help',
    keywords: ['welcome', 'tour', 'onboarding', 'first run', 'setup', 'set up', 'guide', 'help'], browse: true, action: { type: 'welcome' },
  });
  return commands;
}
