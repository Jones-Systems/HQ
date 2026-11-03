import { DESIGN_NAV_IDS, type DesignNavId, type DesignSectionDescriptor, type SectionCommand } from '../contract.ts';
import { hasOnlyKeys, isPlainRecord, isSectionId } from './json.ts';
import { isNavId } from './navigation.ts';

export const SECTION_SCHEMA = 'hq.design.section/v1';
/** File every section exposes; see contract.ts. */
export const SECTION_ENTRY_FILE = 'design-module.ts';
/** Directories under modules/design/ that are never sections. */
const HOST_DIRECTORIES: readonly string[] = ['ui'];
const DEFAULT_ORDER = 100;
const MAX_COMMANDS = 32;

export interface RegisteredSection<View = unknown> extends DesignSectionDescriptor<View> {
  readonly order: number;
  readonly commands: readonly SectionCommand[];
  readonly path: string;
}

export interface RegistryRejection {
  readonly path: string;
  readonly reason: string;
}

export interface DesignRegistry<View = unknown> {
  readonly sections: readonly RegisteredSection<View>[];
  readonly byNav: Readonly<Record<DesignNavId, readonly RegisteredSection<View>[]>>;
  readonly rejected: readonly RegistryRejection[];
  readonly get: (id: string) => RegisteredSection<View> | undefined;
}

function label(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** `../../canvas/design-module.ts` → `canvas`. */
export function sectionDirectory(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2 || parts[parts.length - 1] !== SECTION_ENTRY_FILE) return null;
  return parts[parts.length - 2] ?? null;
}

function parseCommands(value: unknown): readonly SectionCommand[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMMANDS) return 'commands must be an array of at most 32 entries';
  const seen = new Set<string>();
  const commands: SectionCommand[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isPlainRecord(item) || !hasOnlyKeys(item, ['id', 'title', 'keywords'])) return 'command has unexpected shape';
    if (!isSectionId(item.id) || seen.has(item.id)) return 'command id must be unique and lowercase';
    if (!label(item.title, 80)) return 'command title must be 1–80 printable characters';
    const keywords = item.keywords;
    if (keywords !== undefined && (!Array.isArray(keywords) || keywords.length > 16
      || !keywords.every((keyword) => label(keyword, 40)))) return 'command keywords must be short labels';
    seen.add(item.id);
    commands.push({ id: item.id, title: item.title, ...(keywords === undefined ? {} : { keywords: [...keywords] as string[] }) });
  }
  return commands;
}

function parseDescriptor<View>(path: string, exported: unknown): RegisteredSection<View> | string {
  const directory = sectionDirectory(path);
  if (directory === null) return `entry must be named ${SECTION_ENTRY_FILE}`;
  // `exported` is the module namespace from an eager glob.
  if (typeof exported !== 'object' || exported === null || !('designModule' in exported)) return 'designModule export is missing';
  const value = (exported as { readonly designModule: unknown }).designModule;
  if (!isPlainRecord(value)) return 'designModule export is not a plain object';
  if (!hasOnlyKeys(value, ['schema', 'id', 'title', 'nav', 'order', 'commands', 'view'])) return 'descriptor has unexpected fields';
  if (value.schema !== SECTION_SCHEMA) return `schema must be ${SECTION_SCHEMA}`;
  if (!isSectionId(value.id)) return 'id must be a lowercase identifier';
  if (value.id !== directory) return `id "${value.id}" must equal its directory "${directory}"`;
  if (!label(value.title, 80)) return 'title must be 1–80 printable characters';
  if (!isNavId(value.nav)) return `nav must be one of ${DESIGN_NAV_IDS.join(', ')}`;
  const order = value.order ?? DEFAULT_ORDER;
  if (typeof order !== 'number' || !Number.isInteger(order) || Math.abs(order) > 1000) return 'order must be an integer within ±1000';
  if (typeof value.view !== 'function') return 'view must be a lazy loader function';
  const commands = parseCommands(value.commands);
  if (typeof commands === 'string') return commands;
  return {
    schema: SECTION_SCHEMA, id: value.id, title: value.title, nav: value.nav, order, commands,
    view: value.view as () => Promise<View>, path,
  };
}

function compareSections(a: RegisteredSection, b: RegisteredSection): number {
  return DESIGN_NAV_IDS.indexOf(a.nav) - DESIGN_NAV_IDS.indexOf(b.nav)
    || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Build the Design section registry from a glob result. Adding a directory
 * with a valid entry file is the only registration step. Invalid entries are
 * reported, never silently dropped; ambiguous duplicate ids are all rejected.
 */
export function buildRegistry<View = unknown>(entries: Readonly<Record<string, unknown>>): DesignRegistry<View> {
  const rejected: RegistryRejection[] = [];
  const parsed: RegisteredSection<View>[] = [];
  for (const path of Object.keys(entries).sort()) {
    const directory = sectionDirectory(path);
    if (directory !== null && HOST_DIRECTORIES.includes(directory)) continue;
    const result = parseDescriptor<View>(path, entries[path]);
    if (typeof result === 'string') rejected.push({ path, reason: result });
    else parsed.push(result);
  }
  const counts = new Map<string, number>();
  for (const section of parsed) counts.set(section.id, (counts.get(section.id) ?? 0) + 1);
  const sections = parsed.filter((section) => {
    if (counts.get(section.id) === 1) return true;
    rejected.push({ path: section.path, reason: `duplicate section id "${section.id}"` });
    return false;
  }).sort(compareSections);
  const inNav = (nav: DesignNavId) => sections.filter((section) => section.nav === nav);
  const byNav = { projects: inNav('projects'), resources: inNav('resources'), review: inNav('review'), requests: inNav('requests'), runs: inNav('runs') };
  const index = new Map(sections.map((section) => [section.id, section]));
  return { sections, byNav, rejected, get: (id) => index.get(id) };
}
