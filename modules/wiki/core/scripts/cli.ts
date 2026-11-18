// Command line of the owner-run validation tool. Every message this module can print is a fixed string
// (plus, at worst, a position number and a contract reason code), and the report goes through the closed
// schema in report.ts, so no value read from a configuration, query file or repository can be echoed.

import { parseArgs } from 'node:util';
import { NAMESPACES, type WikiNamespace } from '../../contract/src/index.ts';
import type { SourceProfile } from '../src/index.ts';
import { collectNamespace } from './collect.ts';
import { InputFailure, parseConfig, parseQueries, readBoundedJson, selectProfiles } from './config-file.ts';
import { buildReport, renderJson, renderTable, type NamespaceReport } from './report.ts';

export const EXIT_OK = 0;
/** An unexpected failure inside the tool itself. */
export const EXIT_INTERNAL = 1;
export const EXIT_INVALID = 2;
export const EXIT_UNAVAILABLE = 3;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = [
  'usage: node validate-sources.ts --config <file> [--namespace bl|appdev] [--queries <file>] [--json]',
  '  --config      JSON file outside the repository: { "version": 1, "sources": [<SourceProfile>, ...] }',
  '  --namespace   validate only this namespace',
  '  --queries     JSON file: { "version": 1, "queries": ["...", ...] } (omit to skip search timing)',
  '  --json        print the aggregate report as JSON instead of a table',
  'exit codes: 0 ok, 1 internal error, 2 invalid arguments or input file, 3 a source is unavailable',
  '',
].join('\n');

const OPTIONS = {
  config: { type: 'string', multiple: true },
  namespace: { type: 'string', multiple: true },
  queries: { type: 'string', multiple: true },
  json: { type: 'boolean', multiple: true },
  help: { type: 'boolean', multiple: true },
} as const;

interface Parsed {
  readonly help: boolean;
  readonly config: string;
  readonly queries: string | null;
  readonly namespace: WikiNamespace | null;
  readonly json: boolean;
}

function parseValues(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false, strict: true }).values;
  } catch {
    return null;
  }
}

/** Parse the arguments; null for anything unexpected, repeated, missing or unknown. */
function parseArguments(argv: readonly string[]): Parsed | null {
  const values = parseValues(argv);
  if (values === null) return null;
  const once = <T>(list: T[] | undefined): T | null | undefined => (list === undefined ? null : list.length === 1 ? (list[0] as T) : undefined);
  const config = once(values.config);
  const queries = once(values.queries);
  const namespace = once(values.namespace);
  const json = once(values.json);
  const help = once(values.help);
  if (config === undefined || queries === undefined || namespace === undefined || json === undefined || help === undefined) return null;
  if (namespace !== null && !(NAMESPACES as readonly string[]).includes(namespace)) return null;
  if (help === null && config === null) return null;
  return { help: help !== null, config: config ?? '', queries, namespace: namespace as WikiNamespace | null, json: json !== null };
}

function inputMessage(which: 'config' | 'queries', failure: InputFailure): string {
  const where = failure.position === null ? '' : ` at position ${failure.position}`;
  const why = failure.reason === null ? '' : ` (${failure.reason})`;
  return `wiki-validate: invalid ${which} file: ${failure.code}${where}${why}\n`;
}

/** Run the tool. Resolves to the process exit code; never rejects and never throws. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArguments(argv);
  if (args === null) {
    io.stderr(`wiki-validate: invalid arguments\n${USAGE}`);
    return EXIT_INVALID;
  }
  if (args.help) {
    io.stdout(USAGE);
    return EXIT_OK;
  }

  let which: 'config' | 'queries' = 'config';
  let profiles: SourceProfile[];
  let queries: string[] = [];
  try {
    profiles = selectProfiles(parseConfig(await readBoundedJson(args.config)), args.namespace);
    which = 'queries';
    if (args.queries !== null) queries = parseQueries(await readBoundedJson(args.queries));
  } catch (error) {
    if (error instanceof InputFailure) {
      io.stderr(inputMessage(which, error));
      return EXIT_INVALID;
    }
    io.stderr('wiki-validate: internal error\n');
    return EXIT_INTERNAL;
  }

  try {
    const namespaces: NamespaceReport[] = [];
    for (const profile of profiles) namespaces.push(await collectNamespace(profile, queries));
    const unavailable = namespaces.filter((report) => report.state === 'unavailable').length;
    const report = buildReport(namespaces, unavailable, process.resourceUsage().maxRSS * 1024);
    io.stdout(args.json ? renderJson(report) : renderTable(report));
    if (unavailable > 0) {
      io.stderr('wiki-validate: one or more sources are unavailable\n');
      return EXIT_UNAVAILABLE;
    }
    return EXIT_OK;
  } catch {
    io.stderr('wiki-validate: internal error\n');
    return EXIT_INTERNAL;
  }
}
