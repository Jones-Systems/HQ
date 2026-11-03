// Command-line parsing for serve.mjs, capture.mjs and ctl.mjs. Pure: callers pass argv and the
// default repo, and get back validated values or a UsageError.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DEFAULT_MODE, THEMES, UsageError, parseMediaFeatures, parseMode, parseSize, parseSizes, parseThemes, resolveSize } from './config.mjs';
import { validateSessionName } from './files.mjs';
import { normalizeRequest } from './steps.mjs';

function parse(argv, options, { positionals = true } = {}) {
  let result;
  try { result = parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true }); }
  catch (error) { throw new UsageError(String(error.message).split('\n')[0]); }
  if (!positionals && result.positionals.length) throw new UsageError(`Unexpected argument "${result.positionals[0]}"`);
  return result;
}

function whole(value, name) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} must be a non-negative whole number`);
  return Number(value);
}

const COMMON = {
  repo: { type: 'string' },
  mode: { type: 'string' },
  size: { type: 'string' },
  wiki: { type: 'boolean' },
  'install-electron': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const commonValues = (values, defaultRepo) => ({
  help: values.help === true,
  repo: resolve(values.repo ?? defaultRepo),
  mode: parseMode(values.mode ?? DEFAULT_MODE),
  size: resolveSize(values.size),
  wiki: values.wiki !== false,
  installElectron: values['install-electron'] === true,
});

export function parseServeArgs(argv, { repo: defaultRepo }) {
  const { values } = parse(argv, { ...COMMON, name: { type: 'string' }, out: { type: 'string' }, 'idle-timeout': { type: 'string' } }, { positionals: false });
  const idle = whole(values['idle-timeout'], 'idle-timeout');
  return {
    ...commonValues(values, defaultRepo),
    name: validateSessionName(values.name ?? 'default'),
    out: values.out ? resolve(values.out) : null,
    idleMinutes: idle ?? 90,
  };
}

export function parseCaptureArgs(argv, { repo: defaultRepo }) {
  const { values } = parse(argv, {
    ...COMMON, sizes: { type: 'string' }, themes: { type: 'string' }, out: { type: 'string' },
    'reduced-motion': { type: 'boolean' }, settings: { type: 'boolean' }, steps: { type: 'string' },
  }, { positionals: false });
  const common = commonValues(values, defaultRepo);
  return {
    ...common,
    sizes: values.sizes ? parseSizes(values.sizes) : [common.size],
    themes: values.themes ? parseThemes(values.themes) : [...THEMES],
    out: values.out ? resolve(values.out) : null,
    reducedMotion: values['reduced-motion'] === true,
    settings: values.settings !== false,
    stepsFile: values.steps ? resolve(values.steps) : null,
  };
}

const CTL_OPTIONS = {
  repo: { type: 'string' }, session: { type: 'string' }, 'max-time': { type: 'string' }, raw: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  text: { type: 'string' }, selector: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' },
  nth: { type: 'string' }, contains: { type: 'boolean' }, force: { type: 'boolean' },
  mods: { type: 'string' }, repeat: { type: 'string' }, settle: { type: 'boolean' },
  since: { type: 'string' }, clear: { type: 'boolean' }, timeout: { type: 'string' },
};

export const CTL_COMMANDS = Object.freeze([
  'status', 'shot', 'click', 'key', 'type', 'eval', 'window', 'media', 'errors', 'restart', 'svc',
  'ledger', 'log', 'quit', 'domain', 'settings', 'wait', 'settle',
]);

/** Maps `<command> [args]` to a control route and body, validated before anything is sent. */
export function ctlRequest(command, positionals, values) {
  const join = () => positionals.join(' ');
  const none = () => { if (positionals.length) throw new UsageError(`${command} takes no arguments`); return {}; };
  switch (command) {
    case 'status': case 'ledger': case 'log': case 'quit': case 'restart': case 'settings':
      return { route: command, body: normalizeRequest(command, none()) };
    case 'shot':
      return { route: 'shot', body: normalizeRequest('shot', { name: positionals[0], settle: values.settle }) };
    case 'click': {
      if (positionals.length) throw new UsageError('click takes --text, --selector or --x/--y, not positional arguments');
      return { route: 'click', body: normalizeRequest('click', {
        text: values.text, selector: values.selector, nth: whole(values.nth, 'nth'), contains: values.contains, force: values.force,
        x: whole(values.x, 'x'), y: whole(values.y, 'y'),
      }) };
    }
    case 'key': {
      if (positionals.length !== 1) throw new UsageError('key needs exactly one key, e.g. key Escape or key k --mods ctrl');
      return { route: 'key', body: normalizeRequest('key', { key: positionals[0], mods: values.mods ?? [], repeat: whole(values.repeat, 'repeat') }) };
    }
    case 'type': return { route: 'type', body: normalizeRequest('type', { text: join() }) };
    case 'eval': return { route: 'eval', body: normalizeRequest('eval', { expr: join() }) };
    case 'domain': return { route: 'domain', body: normalizeRequest('domain', { name: join() }) };
    case 'window': {
      const body = positionals[0] === 'reset' && positionals.length === 1 ? { reset: true }
        : positionals.length === 1 ? parseSize(positionals[0])
          : positionals.length === 2 ? parseSize(`${positionals[0]}x${positionals[1]}`)
            : (() => { throw new UsageError('window needs <width> <height>, <WxH> or reset'); })();
      return { route: 'window', body: normalizeRequest('window', body) };
    }
    case 'media': {
      if (positionals[0] === 'reset' && positionals.length === 1) return { route: 'media', body: { reset: true } };
      return { route: 'media', body: normalizeRequest('media', { features: parseMediaFeatures(positionals) }) };
    }
    case 'errors': return { route: 'errors', body: normalizeRequest('errors', { since: whole(values.since, 'since'), clear: values.clear }) };
    case 'settle': return { route: 'settle', body: normalizeRequest('settle', { timeout: whole(values.timeout, 'timeout') }) };
    case 'svc': {
      const [state, target] = positionals;
      if (!['down', 'up'].includes(state) || positionals.length > 2) throw new UsageError('svc needs down or up, optionally followed by work or social');
      return { route: 'svc', body: normalizeRequest('svc', { down: state === 'down', target }) };
    }
    case 'wait': {
      if (positionals.length === 1 && /^\d+$/.test(positionals[0])) return { route: 'wait', body: normalizeRequest('wait', { ms: Number(positionals[0]) }) };
      if (positionals.length) throw new UsageError('wait takes a number of milliseconds, or --text / --selector');
      return { route: 'wait', body: normalizeRequest('wait', { text: values.text, selector: values.selector, contains: values.contains, timeout: whole(values.timeout, 'timeout') }) };
    }
    default:
      throw new UsageError(`Unknown command "${command}": use ${CTL_COMMANDS.join(', ')}`);
  }
}

export function parseCtlArgs(argv, { repo: defaultRepo }) {
  const { values, positionals } = parse(argv, CTL_OPTIONS);
  const base = {
    help: values.help === true,
    repo: resolve(values.repo ?? defaultRepo),
    session: validateSessionName(values.session ?? 'default'),
    raw: values.raw === true,
    maxTimeMs: (whole(values['max-time'], 'max-time') ?? 120) * 1000,
  };
  if (base.help || positionals.length === 0) return { ...base, help: true };
  const [command, ...rest] = positionals;
  return { ...base, command, ...ctlRequest(command, rest, values) };
}

// ---- help text

const SHARED_HELP = `  --repo <dir>          repository whose build to run (default: the repo holding this tool)
  --mode <mode>         example | live | offline (default example)
  --size <WxH>          window size, default 1440x900
  --no-wiki             skip the synthetic Wiki corpus
  --install-electron    download the Electron binary if it is missing (node_modules/electron/install.js)`;

export const SERVE_HELP = `Start a long-running headless HQ session and its control API.

Usage: node tools/dev-preview/serve.mjs [options]

Options:
${SHARED_HELP}
  --name <name>         session name (default "default")
  --out <dir>           where ctl shot writes PNGs (default .t3/dev-preview/shots/<UTC time>-<name>)
  --idle-timeout <min>  quit after this many idle minutes, 0 to disable (default 90)

Prints one READY line, then runs until SIGINT/SIGTERM or \`ctl quit\`.
`;

export const CAPTURE_HELP = `Start a session, visit every domain in light and dark, save PNGs and a manifest, clean up.

Usage: node tools/dev-preview/capture.mjs [options]

Options:
${SHARED_HELP}
  --sizes <list>        sizes to capture, e.g. 1440x900,760x560 (default: --size only)
  --themes <list>       light,dark (default both)
  --out <dir>           output directory (default .t3/dev-preview/shots/<UTC time>/)
  --reduced-motion      emulate prefers-reduced-motion: reduce for the whole run
  --no-settings         do not visit Settings
  --steps <file.json>   run a custom list of {"do": ...} steps instead of the domain tour

Prints the output directory on stdout. Exits 1 when any step failed (the manifest says which).
`;

export const CTL_HELP = `Control a running dev-preview session.

Usage: node tools/dev-preview/ctl.mjs [--session <name>] [--repo <dir>] <command> [args]

Commands:
  status                              session mode, size, services, build freshness
  shot [name] [--no-settle]           save a PNG into the session's evidence directory
  domain <name>                       open Design, Social, Work or Wiki
  settings                            open Settings
  click --text <label> [--contains] [--nth N] | --selector <css> | --x N --y N [--force]
  key <key> [--mods ctrl,shift] [--repeat N]
  type <text>
  eval <expression>                   run JavaScript in the renderer
  window <w> <h> | <WxH> | reset      resize the viewport (reset = the session size)
  media <feature>=<value> ...         e.g. prefers-color-scheme=dark prefers-reduced-motion=reduce; media reset
  wait <ms> | --text <label> | --selector <css> [--timeout ms]
  settle [--timeout ms]               wait for fonts and animations
  errors [--since N] [--clear]        console errors, warnings and exceptions seen so far
  svc down|up [work|social]           make the fixture services refuse connections (live mode)
  ledger                              requests the fixture services have seen
  log                                 tail of the Electron stderr
  restart                             restart the app (same profile, size and media)
  quit                                close the session and clean up

Options: --raw prints string results as text; --max-time <seconds> bounds the call (default 120).
Use -- before a value that starts with a dash.
`;
