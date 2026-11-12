// Validation for control requests and capture steps. One vocabulary serves the HTTP control API,
// the ctl CLI and `capture --steps file.json`, so a mistake is rejected before anything runs.
import { UsageError, normalizeKey, normalizeModifiers, parseMediaFeatures, parseSize } from './config.mjs';
import { safeFileName } from './files.mjs';

export const ROUTES = Object.freeze([
  'status', 'eval', 'shot', 'key', 'type', 'click', 'window', 'media', 'errors', 'restart',
  'svc', 'ledger', 'log', 'quit', 'domain', 'settings', 'wait', 'settle',
]);
/** Routes a capture step may use. Lifecycle and read-only routes belong to the tool, not to a script. */
export const STEP_ACTIONS = Object.freeze([
  'domain', 'settings', 'click', 'key', 'type', 'eval', 'window', 'media', 'wait', 'settle', 'shot', 'restart', 'svc',
]);

const MAX_EXPRESSION = 100_000;
const MAX_TEXT = 10_000;
const MAX_SELECTOR = 1_000;
const MAX_WAIT_MS = 30_000;

function plain(value, what) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${what} must be a JSON object`);
  return value;
}
function reject(body, allowed, what) {
  const extra = Object.keys(body).filter(key => !allowed.includes(key));
  if (extra.length) throw new UsageError(`${what}: unknown field${extra.length > 1 ? 's' : ''} ${extra.join(', ')}`);
}
function text(value, what, max, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw new UsageError(`${what} must be a non-empty string`);
  if (value.length > max) throw new UsageError(`${what} is longer than ${max} characters`);
  return value;
}
function integer(value, what, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === null) { if (fallback !== undefined) return fallback; throw new UsageError(`${what} is required`); }
  if (!Number.isInteger(value) || value < min || value > max) throw new UsageError(`${what} must be an integer from ${min} to ${max}`);
  return value;
}
function flag(value, what, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new UsageError(`${what} must be true or false`);
  return value;
}

const NORMALIZERS = {
  status: (b) => { reject(b, [], 'status'); return {}; },
  ledger: (b) => { reject(b, [], 'ledger'); return {}; },
  log: (b) => { reject(b, [], 'log'); return {}; },
  quit: (b) => { reject(b, [], 'quit'); return {}; },
  restart: (b) => { reject(b, [], 'restart'); return {}; },
  settings: (b) => { reject(b, [], 'settings'); return {}; },
  eval: (b) => { reject(b, ['expr'], 'eval'); return { expr: text(b.expr, 'expr', MAX_EXPRESSION) }; },
  type: (b) => { reject(b, ['text'], 'type'); return { text: text(b.text, 'text', MAX_TEXT, { empty: true }) }; },
  domain: (b) => { reject(b, ['name'], 'domain'); return { name: text(b.name, 'name', 100) }; },
  settle: (b) => { reject(b, ['timeout'], 'settle'); return { timeout: integer(b.timeout, 'timeout', { min: 0, max: 8000, fallback: 4000 }) }; },
  shot(b) {
    reject(b, ['name', 'settle'], 'shot');
    return { name: b.name === undefined ? 'shot' : safeFileName(b.name), settle: flag(b.settle, 'settle', true) };
  },
  key(b) {
    reject(b, ['key', 'mods', 'repeat'], 'key');
    return { key: normalizeKey(b.key), mods: normalizeModifiers(b.mods ?? []), repeat: integer(b.repeat, 'repeat', { min: 1, max: 50, fallback: 1 }) };
  },
  click(b) {
    reject(b, ['text', 'selector', 'x', 'y', 'nth', 'contains', 'force', 'scope'], 'click');
    const hasPoint = b.x !== undefined || b.y !== undefined;
    const hasTarget = b.text !== undefined || b.selector !== undefined;
    if (hasPoint && hasTarget) throw new UsageError('click: use either text/selector or x/y, not both');
    if (!hasPoint && !hasTarget) throw new UsageError('click: needs text, selector or x and y');
    if (hasPoint) {
      return { x: integer(b.x, 'x', { min: 0, max: 20000 }), y: integer(b.y, 'y', { min: 0, max: 20000 }), force: true };
    }
    if (b.scope !== undefined && !Array.isArray(b.scope)) throw new UsageError('scope must be an array of selectors');
    const scope = b.scope?.map(entry => text(entry, 'scope entry', MAX_SELECTOR));
    return {
      ...(b.text !== undefined ? { text: text(b.text, 'text', 500) } : {}),
      ...(b.selector !== undefined ? { selector: text(b.selector, 'selector', MAX_SELECTOR) } : {}),
      ...(scope ? { scope } : {}),
      nth: integer(b.nth, 'nth', { min: 0, max: 1000, fallback: 0 }),
      contains: flag(b.contains, 'contains', false),
      force: flag(b.force, 'force', false),
    };
  },
  window(b) {
    reject(b, ['width', 'height', 'size', 'reset'], 'window');
    if (b.reset === true) return { reset: true };
    if (b.size !== undefined) return parseSize(b.size);
    return parseSize(`${b.width}x${b.height}`);
  },
  media(b) {
    reject(b, ['features', 'reset'], 'media');
    if (b.reset === true) return { reset: true };
    return { features: parseMediaFeatures(b.features) };
  },
  errors(b) {
    reject(b, ['since', 'clear'], 'errors');
    return { since: integer(b.since, 'since', { min: 0, fallback: 0 }), clear: flag(b.clear, 'clear', false) };
  },
  svc(b) {
    reject(b, ['down', 'target'], 'svc');
    const target = b.target ?? 'all';
    if (!['all', 'work', 'social'].includes(target)) throw new UsageError('svc target must be all, work or social');
    if (typeof b.down !== 'boolean') throw new UsageError('svc needs down: true or false');
    return { down: b.down, target };
  },
  wait(b) {
    reject(b, ['ms', 'text', 'selector', 'timeout'], 'wait');
    if (b.ms !== undefined) {
      if (b.text !== undefined || b.selector !== undefined) throw new UsageError('wait: use ms or text/selector, not both');
      return { ms: integer(b.ms, 'ms', { min: 0, max: MAX_WAIT_MS }) };
    }
    if (b.text === undefined && b.selector === undefined) throw new UsageError('wait: needs ms, text or selector');
    return {
      ...(b.text !== undefined ? { text: text(b.text, 'text', 500) } : {}),
      ...(b.selector !== undefined ? { selector: text(b.selector, 'selector', MAX_SELECTOR) } : {}),
      timeout: integer(b.timeout, 'timeout', { min: 100, max: MAX_WAIT_MS, fallback: 5000 }),
    };
  },
};

export function normalizeRequest(route, body) {
  if (!ROUTES.includes(route)) throw new UsageError(`Unknown route "${route}"`);
  return NORMALIZERS[route](plain(body, `${route} request`));
}

/** One step is `{ "do": "<action>", ...fields }`; fields follow the matching control route. */
export function normalizeStep(step, index = 0) {
  const where = `steps[${index}]`;
  try {
    const { do: action, ...fields } = plain(step, 'step');
    if (typeof action !== 'string') throw new UsageError('missing "do"');
    if (!STEP_ACTIONS.includes(action)) throw new UsageError(`unknown action "${action}": use ${STEP_ACTIONS.join(', ')}`);
    const body = normalizeRequest(action, fields);
    if (action === 'shot' && fields.name === undefined) throw new UsageError('a shot step needs a "name"');
    return { do: action, ...body };
  } catch (error) {
    if (error instanceof UsageError) throw new UsageError(`${where}: ${error.message}`);
    throw error;
  }
}

export function normalizeSteps(steps) {
  if (!Array.isArray(steps)) throw new UsageError('Steps must be a JSON array of {"do": ...} objects');
  if (steps.length === 0) throw new UsageError('Steps is empty');
  if (steps.length > 500) throw new UsageError('Steps has more than 500 entries');
  return steps.map(normalizeStep);
}
