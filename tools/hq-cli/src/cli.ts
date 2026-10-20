import { executeWrite } from './writes.ts';
import { commands, schemas, summaries, filters } from './commands.ts';
import type { Command } from './commands.ts';
import { conforms, historyResponse, item, object, state, version, array, STATUSES } from './schema.ts';
import { calendar, checkDates, periodBounds, requireDay, todayInZone } from './dates.ts';
import { CliError, PlannerClient, plannerURL, usage } from './transport.ts';
import type { Fetch } from './transport.ts';
export type Dependencies = { fetch?: Fetch; clock?: () => Date; env?: Record<string, string | undefined> };
export type Invocation = { command: Command; input: Record<string, any> };
export function parse(args: string[]): Invocation {
  const words: string[] = [];
  const flags: Record<string, any> = {};
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token.startsWith('--')) {
      const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(token);
      if (!match) throw usage('Malformed option.');
      const key = match[1].replaceAll('-', '_');
      if (Object.hasOwn(flags, key) && key !== 'date') throw usage(`Duplicate --${match[1]}.`, key);
      if (['dry_run', 'check'].includes(key) && match[2] === undefined) { flags[key] = true; continue; }
      const value = match[2] ?? args[++i];
      if (value === undefined || value.startsWith('--') || value === '') throw usage(`Missing value for --${match[1]}.`, key);
      if (key === 'date') flags[key] = [...(flags[key] ?? []), value]; else flags[key] = value;
    } else if (token.startsWith('-')) throw usage('Unknown option.');
    else words.push(token);
  }
  const command = commands.find(c => c.words.every((word, index) => words[index] === word));
  if (!command && !(help && words.length === 0)) throw usage('Choose an implemented command with hq commands.');
  const selected = command ?? commands.find(c => c.id === 'hq.commands')!;
  const rest = words.slice(selected.words.length);
  if (rest.length > (selected.positional ? 1 : 0)) throw usage('Unexpected positional argument.');
  const input: Record<string, any> = {};
  for (const [key, raw] of Object.entries(flags)) {
    if (key === selected.positional || !Object.hasOwn(selected.input.properties!, key)) throw usage(`Unknown option --${key.replaceAll('_', '-')}.`, key);
    if (selected.input.properties![key].type === 'boolean') {
      if (raw !== true && raw !== 'true' && raw !== 'false') throw usage('Boolean flags accept only true or false.', key);
      input[key] = raw === true || raw === 'true';
    } else if (selected.input.properties![key].type === 'integer') {
      if (!/^\d+$/.test(raw)) throw usage(`--${key.replaceAll('_', '-')} requires an integer.`, key);
      input[key] = Number(raw);
    } else input[key] = raw;
  }
  if (rest[0] && selected.positional) input[selected.positional] = rest[0];
  if (!help && !conforms(selected.input, input)) throw usage('Arguments do not match the command schema. Use hq schema <command-id>.');
  if (input.planner_url !== undefined) plannerURL(input.planner_url);
  if (input.from) requireDay(input.from, 'from');
  if (input.to) requireDay(input.to, 'to');
  if (input.from && input.to && input.from > input.to) throw usage('--from must be on or before --to.');
  return help ? { command: commands.find(c => c.id === 'hq.commands')!, input: {} } : { command: selected, input };
}
const count = (items: any[]) => ({ total: items.length, active: items.filter(i => i.archived_at === null).length, archived: items.filter(i => i.archived_at !== null).length });
const unavailable = [
  { id: 'design', availability: 'not_exposed', reason: 'Design has no exposed CLI adapter; its single-writer store is not accessed.', features: [] },
  { id: 'social', availability: 'unavailable', reason: 'No Social service adapter is implemented.', features: [] },
  { id: 'work', availability: 'not_exposed', reason: 'HQ Work fixtures are not a live service; use the separately configured Planner adapter.', features: [] },
  { id: 'wiki', availability: 'unavailable', reason: 'No Wiki service adapter is implemented.', features: [] },
  { id: 'inspiration', availability: 'unavailable', reason: 'No inspiration service adapter is implemented.', features: [] },
];
export async function execute({ command, input }: Invocation, deps: Dependencies): Promise<any> {
  if (command.id === 'hq.commands') return { commands: summaries() };
  if (command.id === 'hq.schema') {
    const selected = input.command_id ? commands.filter(c => c.id === input.command_id) : commands;
    if (!selected.length) throw usage('Unknown command ID.', 'command_id');
    return { commands: schemas(selected) };
  }
  const env = deps.env ?? process.env;
  const url = input.planner_url ?? env.HQ_PLANNER_URL;
  const fetch = deps.fetch ?? globalThis.fetch;
  if (command.id === 'hq.capabilities') {
    if (url !== undefined && url !== '') plannerURL(url);
    let planner;
    try {
      const client = new PlannerClient(url, fetch, input.timeout_ms);
      const info = await client.read({ kind: 'version' }, version);
      planner = { id: 'planner', availability: 'live', reason: 'Configured Planner responded to a version read.', features: info.features ?? [] };
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      planner = { id: 'planner', availability: error.code === 'unconfigured' ? 'unconfigured' : 'unreachable', reason: `${error.code}: ${error.message}`, features: [] };
    }
    return { domains: [planner, ...unavailable], multiple_boards: false };
  }
  const client = new PlannerClient(url, fetch, input.timeout_ms);
  if (command.id === 'planner.status') {
    const info = await client.read({ kind: 'version' }, version);
    return { availability: 'live', api: info.api ?? 1, features: info.features ?? [], state_version: info.state_version };
  }
  if (command.id === 'planner.items.get') {
    const body = await client.read({ kind: 'item', id: input.item_id }, object({ item }));
    if (body.item.id !== input.item_id) throw new CliError('bad_response', 'Planner returned a different item ID.', 6);
    checkDates([body.item]);
    return body;
  }
  if (command.id === 'planner.items.history') return { item_id: input.item_id, ...await client.read({ kind: 'history', id: input.item_id }, historyResponse) };
  const snapshot = await client.read({ kind: 'state' }, state);
  checkDates(snapshot.items);
  todayInZone(new Date(snapshot.server_time), snapshot.settings.default_tz);
  if (command.id === 'planner.now') return calendar((deps.clock ?? (() => new Date()))(), snapshot.settings.default_tz, input.days ?? 14);
  if (command.id === 'planner.settings.get') return { settings: snapshot.settings, state_version: snapshot.state_version };
  if (command.id === 'planner.boards') {
    const names = ['Inbox', 'Considering', 'Next', 'Active', 'On hold', 'Done', 'Dropped'];
    return { multiple_boards: false, state_version: snapshot.state_version, boards: [{ id: 'planner:main', name: 'Planner', counts: count(snapshot.items), columns: STATUSES.map((id, i) => ({ id, name: names[i], counts: count(snapshot.items.filter((item: any) => item.status === id)) })), areas: [...new Set<string>(snapshot.items.map((item: any) => item.area).filter((area: unknown) => typeof area === 'string' && area !== ''))].sort().map(name => ({ name, counts: count(snapshot.items.filter((item: any) => item.area === name)) })) }] };
  }
  if (command.id === 'planner.items.list') {
    const activeFilters = Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(filters, key)));
    activeFilters.archive ??= 'active';
    const selected = snapshot.items.filter((item: any) => {
      if (activeFilters.archive === 'active' && item.archived_at !== null || activeFilters.archive === 'archived' && item.archived_at === null) return false;
      if (['status', 'kind', 'horizon', 'area'].some(key => activeFilters[key] !== undefined && item[key] !== activeFilters[key])) return false;
      if (input.date_kind || input.from || input.to) return item.dates.some((date: any) => {
        if (input.date_kind && date.kind !== input.date_kind) return false;
        const [start, end] = periodBounds(date.precision, date.value);
        return (!input.from || end >= input.from) && (!input.to || start <= input.to);
      });
      return true;
    });
    return { board: 'planner:main', state_version: snapshot.state_version, filters: activeFilters, date_match: 'any qualifying date; inclusive calendar-period overlap; original precision retained', items: selected };
  }
  throw new CliError('internal_error', 'Command has no implementation.', 1);
}
export async function run(args: string[], deps: Dependencies = {}): Promise<{ exitCode: number; result: any }> {
  let id = 'hq.usage';
  try {
    const parsed = parse(args);
    id = parsed.command.id;
    if (parsed.command.write) return await executeWrite(parsed, deps);
    const data = await execute(parsed, deps);
    return { exitCode: 0, result: { schema: 'hq.cli.result/v1', ok: true, command: id, effect: 'none', data } };
  } catch (error) {
    const e = error instanceof CliError ? error : new CliError('internal_error', 'HQ CLI encountered an internal error.', 1);
    return { exitCode: e.exitCode, result: { schema: 'hq.cli.result/v1', ok: false, command: id, effect: 'none', error: { code: e.code, message: e.message, details: e.details } } };
  }
}
