import type { DesignLocation, SectionCommand } from '../contract.ts';
import { DESIGN_NAV_IDS } from '../contract.ts';
import { navTarget, type ChromeView, type SectionSummary } from './focus.ts';
import { NAV_LABELS } from './navigation.ts';
import type { PanelId } from './panels.ts';

export type PaletteAction =
  | { readonly type: 'navigate'; readonly location: DesignLocation }
  | { readonly type: 'toggle-panel'; readonly panel: PanelId }
  | { readonly type: 'section-command'; readonly location: DesignLocation; readonly commandId: string }
  /** Opens the project-switch confirmation; never switches by itself. */
  | { readonly type: 'propose-project'; readonly projectId: string; readonly label: string };

export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly group: 'Go to' | 'Sections' | 'View' | 'Commands' | 'Projects';
  readonly keywords: readonly string[];
  readonly action: PaletteAction;
}

export interface ProjectCandidate { readonly id: string; readonly name: string }

export interface PaletteSource extends ChromeView {
  readonly sections: readonly (SectionSummary & { readonly commands: readonly SectionCommand[] })[];
  readonly currentProjectId: string;
  /** Projects the shell says may be switched to. Optional; matching names are never merged. */
  readonly projects?: readonly ProjectCandidate[];
}

/** Every navigation target, view toggle, section command and project proposal. */
export function buildCommands(source: PaletteSource): readonly PaletteCommand[] {
  const commands: PaletteCommand[] = DESIGN_NAV_IDS.map((nav) => ({
    id: `nav:${nav}`, title: `Go to ${NAV_LABELS[nav]}`, group: 'Go to', keywords: [nav],
    action: { type: 'navigate', location: navTarget(source, nav) },
  }));
  for (const section of source.sections) {
    commands.push({
      id: `section:${section.id}`, title: `Open ${section.title}`, group: 'Sections',
      keywords: [section.id, NAV_LABELS[section.nav]], action: { type: 'navigate', location: { nav: section.nav, section: section.id } },
    });
  }
  for (const panel of ['sidebar', 'inspector'] as const) {
    commands.push({
      id: `toggle:${panel}`, title: `${source.visible[panel] ? 'Hide' : 'Show'} ${panel}`, group: 'View',
      keywords: ['panel', 'toggle'], action: { type: 'toggle-panel', panel },
    });
  }
  for (const section of source.sections) {
    for (const command of section.commands) {
      commands.push({
        id: `command:${section.id}:${command.id}`, title: `${section.title}: ${command.title}`, group: 'Commands',
        keywords: command.keywords ?? [], action: { type: 'section-command', location: { nav: section.nav, section: section.id }, commandId: command.id },
      });
    }
  }
  for (const project of source.projects ?? []) {
    if (project.id === source.currentProjectId) continue;
    // Project ids, not names, identify the target; two projects may share a name.
    commands.push({
      id: `project:${project.id}`, title: `Switch project to ${project.name}…`, group: 'Projects',
      keywords: ['project', 'switch', project.id], action: { type: 'propose-project', projectId: project.id, label: project.name },
    });
  }
  return commands;
}

function scoreText(text: string, query: string): number {
  const haystack = text.toLowerCase();
  if (haystack.startsWith(query)) return 4;
  if (haystack.split(/[\s:/-]+/u).some((word) => word.startsWith(query))) return 3;
  if (haystack.includes(query)) return 2;
  let position = 0;
  for (const character of query) {
    position = haystack.indexOf(character, position);
    if (position < 0) return 0;
    position += 1;
  }
  return 1;
}

/** Rank commands by title, then keywords. Stable for equal scores. Empty query keeps declaration order. */
export function filterCommands(commands: readonly PaletteCommand[], rawQuery: string): readonly PaletteCommand[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return commands;
  return commands
    .map((command, index) => ({
      command, index,
      score: Math.max(scoreText(command.title, query) * 2, ...command.keywords.map((keyword) => scoreText(keyword, query))),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

export interface PaletteState {
  readonly open: boolean;
  readonly query: string;
  readonly active: number;
  /** Stop id that had focus before opening; focus returns there on close. */
  readonly returnFocus: string | null;
}

export const CLOSED_PALETTE: PaletteState = { open: false, query: '', active: 0, returnFocus: null };

export type PaletteEvent =
  | { readonly type: 'open'; readonly returnFocus: string | null }
  | { readonly type: 'close' }
  | { readonly type: 'query'; readonly query: string }
  | { readonly type: 'move'; readonly by: 'next' | 'previous' | 'first' | 'last'; readonly count: number }
  | { readonly type: 'highlight'; readonly index: number; readonly count: number };

/** Highlighting a result never executes it; only Enter/click does, in the view. */
export function paletteReduce(state: PaletteState, event: PaletteEvent): PaletteState {
  switch (event.type) {
    case 'open': return state.open ? state : { open: true, query: '', active: 0, returnFocus: event.returnFocus };
    case 'close': return CLOSED_PALETTE;
    case 'query': return state.open ? { ...state, query: event.query.slice(0, 200), active: 0 } : state;
    case 'move': {
      if (!state.open || event.count <= 0) return state;
      const last = event.count - 1;
      const active = event.by === 'first' ? 0 : event.by === 'last' ? last
        : event.by === 'next' ? (state.active >= last ? 0 : state.active + 1)
          : (state.active <= 0 ? last : state.active - 1);
      return { ...state, active };
    }
    case 'highlight':
      return state.open && Number.isInteger(event.index) && event.index >= 0 && event.index < event.count && event.index !== state.active
        ? { ...state, active: event.index } : state;
  }
}
