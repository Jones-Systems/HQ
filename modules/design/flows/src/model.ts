import {
  ANIMATIONS, FLOW_PLATFORMS, FLOW_SCHEMA, isBoundedText,
  type FlowDocument, type Hotspot, type Rect, type RouteDeclaration, type Screen, type ScreenId,
  type Transition, type TransitionTarget, type Viewport,
} from './contract.ts';
import { deriveEdges, indexFlow, routeStateKey, screenDepths } from './edges.ts';

export type ParseResult =
  | { readonly ok: true; readonly flow: FlowDocument }
  | { readonly ok: false; readonly unsupportedSchema: boolean; readonly errors: readonly string[] };

type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * Strict structural parse. Identity corruption (duplicate IDs, malformed values, unknown keys,
 * future schema) rejects the document; referential problems such as broken targets do not,
 * because they must stay visible in `validateFlow` rather than being dropped at load.
 */
export function parseFlow(value: unknown): ParseResult {
  const errors: string[] = [];
  const fail = (path: string, message: string): undefined => { errors.push(`${path}: ${message}`); return undefined; };
  const exact = (input: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Json | undefined => {
    if (!record(input)) return fail(path, 'expected object');
    const unknown = Object.keys(input).filter((key) => !required.includes(key) && !optional.includes(key));
    if (unknown.length > 0) return fail(path, `unknown keys ${unknown.join(', ')}`);
    const missing = required.filter((key) => !(key in input));
    if (missing.length > 0) return fail(path, `missing keys ${missing.join(', ')}`);
    return input;
  };
  const id = (input: unknown, path: string): string | undefined => isBoundedText(input) ? input : fail(path, 'expected bounded identifier');
  const text = (input: unknown, path: string, max: number): string | undefined => isBoundedText(input, max) ? input : fail(path, 'expected bounded text');
  const list = (input: unknown, path: string): readonly unknown[] => Array.isArray(input) ? input : (fail(path, 'expected array'), []);

  if (record(value) && typeof value.schema === 'string' && value.schema !== FLOW_SCHEMA
    && /^hq\.design\.flow\/v\d+$/u.test(value.schema)) {
    return { ok: false, unsupportedSchema: true, errors: [`schema: unsupported ${value.schema}`] };
  }
  const root = exact(value, 'flow', ['schema', 'id', 'projectId', 'title', 'platform', 'start', 'routes', 'screens', 'hotspots']);
  if (!root) return { ok: false, unsupportedSchema: false, errors };
  if (root.schema !== FLOW_SCHEMA) fail('schema', `expected ${FLOW_SCHEMA}`);
  const platform = FLOW_PLATFORMS.find((item) => item === root.platform) ?? fail('platform', 'unknown platform');

  const routes: RouteDeclaration[] = [];
  const routeNames = new Set<string>();
  list(root.routes, 'routes').forEach((input, index) => {
    const path = `routes[${index}]`;
    const item = exact(input, path, ['route', 'states']);
    if (!item) return;
    const route = text(item.route, `${path}.route`, 512);
    const states = list(item.states, `${path}.states`).map((state, n) => text(state, `${path}.states[${n}]`, 160));
    if (states.length === 0) fail(`${path}.states`, 'declare at least one state');
    if (new Set(states).size !== states.length) fail(`${path}.states`, 'duplicate state');
    if (route !== undefined && routeNames.has(route)) fail(path, `duplicate route ${route}`);
    if (route !== undefined) routeNames.add(route);
    if (route !== undefined && states.every((state) => state !== undefined)) routes.push({ route, states: states as string[] });
  });

  const rect = (input: unknown, path: string): Rect | undefined => {
    const item = exact(input, path, ['x', 'y', 'width', 'height']);
    if (!item) return undefined;
    if (!finite(item.x, -1e5, 1e5) || !finite(item.y, -1e5, 1e5)) return fail(path, 'origin must be finite CSS pixels');
    if (!finite(item.width, 1e-6, 1e5) || !finite(item.height, 1e-6, 1e5)) return fail(path, 'size must be positive CSS pixels');
    return { x: item.x, y: item.y, width: item.width, height: item.height };
  };
  const viewport = (input: unknown, path: string): Viewport | undefined => {
    const item = exact(input, path, ['w', 'h', 'dpr']);
    if (!item) return undefined;
    if (!finite(item.w, 1, 1e5) || !finite(item.h, 1, 1e5) || !finite(item.dpr, 0.25, 8)) return fail(path, 'invalid viewport');
    return { w: item.w, h: item.h, dpr: item.dpr };
  };

  const screens: Screen[] = [];
  const screenIds = new Set<string>();
  list(root.screens, 'screens').forEach((input, index) => {
    const path = `screens[${index}]`;
    const item = exact(input, path, ['id', 'title', 'versionId', 'route', 'state', 'viewport'], ['captureDigest']);
    if (!item) return;
    const parsed = {
      id: id(item.id, `${path}.id`), title: text(item.title, `${path}.title`, 300),
      versionId: id(item.versionId, `${path}.versionId`), route: text(item.route, `${path}.route`, 512),
      state: text(item.state, `${path}.state`, 160), viewport: viewport(item.viewport, `${path}.viewport`),
      captureDigest: 'captureDigest' in item ? text(item.captureDigest, `${path}.captureDigest`, 200) : null,
    };
    if (parsed.id !== undefined && screenIds.has(parsed.id)) fail(`${path}.id`, `duplicate screen ${parsed.id}`);
    if (parsed.id !== undefined) screenIds.add(parsed.id);
    if (Object.values(parsed).some((field) => field === undefined)) return;
    const { captureDigest, ...rest } = parsed;
    screens.push({ ...rest, ...(captureDigest === null ? {} : { captureDigest }) } as Screen);
  });

  const target = (input: unknown, path: string): TransitionTarget | undefined => {
    if (!record(input)) return fail(path, 'expected object');
    switch (input.kind) {
      case 'screen': {
        const item = exact(input, path, ['kind', 'screenId']);
        const screen = item && id(item.screenId, `${path}.screenId`);
        return screen === undefined ? undefined : { kind: 'screen', screenId: screen as ScreenId };
      }
      case 'route': {
        const item = exact(input, path, ['kind', 'route'], ['state']);
        if (!item) return undefined;
        const route = text(item.route, `${path}.route`, 512);
        const state = 'state' in item ? text(item.state, `${path}.state`, 160) : null;
        if (route === undefined || state === undefined) return undefined;
        return state === null ? { kind: 'route', route } : { kind: 'route', route, state };
      }
      case 'back': return exact(input, path, ['kind']) && { kind: 'back' };
      case 'external': {
        const item = exact(input, path, ['kind', 'url']);
        const url = item && text(item.url, `${path}.url`, 2048);
        if (url === undefined) return undefined;
        let protocol = '';
        try { protocol = new URL(url).protocol; } catch { /* reported below */ }
        return protocol === 'https:' || protocol === 'http:' ? { kind: 'external', url } : fail(`${path}.url`, 'expected http(s) URL');
      }
      default: return fail(`${path}.kind`, 'unknown target kind');
    }
  };
  const transition = (input: unknown, path: string): Transition | undefined => {
    const item = exact(input, path, ['target', 'animation', 'durationMs']);
    if (!item) return undefined;
    const parsedTarget = target(item.target, `${path}.target`);
    const animation = ANIMATIONS.find((name) => name === item.animation) ?? fail(`${path}.animation`, 'unknown animation');
    const duration = finite(item.durationMs, 0, 10_000) ? item.durationMs : fail(`${path}.durationMs`, 'expected 0..10000');
    return parsedTarget && animation && duration !== undefined ? { target: parsedTarget, animation, durationMs: duration } : undefined;
  };

  const hotspots: Hotspot[] = [];
  const hotspotIds = new Set<string>();
  list(root.hotspots, 'hotspots').forEach((input, index) => {
    const path = `hotspots[${index}]`;
    const item = exact(input, path, ['id', 'screenId', 'label', 'rect', 'transition']);
    if (!item) return;
    const parsed = {
      id: id(item.id, `${path}.id`), screenId: id(item.screenId, `${path}.screenId`),
      label: text(item.label, `${path}.label`, 300), rect: rect(item.rect, `${path}.rect`),
      transition: transition(item.transition, `${path}.transition`),
    };
    if (parsed.id !== undefined && hotspotIds.has(parsed.id)) fail(`${path}.id`, `duplicate hotspot ${parsed.id}`);
    if (parsed.id !== undefined) hotspotIds.add(parsed.id);
    if (Object.values(parsed).every((field) => field !== undefined)) hotspots.push(parsed as Hotspot);
  });

  const flow = {
    schema: FLOW_SCHEMA, id: id(root.id, 'id'), projectId: id(root.projectId, 'projectId'),
    title: text(root.title, 'title', 300), platform, start: id(root.start, 'start'), routes, screens, hotspots,
  };
  if (errors.length > 0) return { ok: false, unsupportedSchema: false, errors };
  // With no errors every field above was validated and defined; branding happens here.
  return { ok: true, flow: deepFreeze(flow as unknown as FlowDocument) };
}

export type IssueCode =
  | 'missing-start' | 'undeclared-route' | 'undeclared-state' | 'duplicate-screen-state'
  | 'orphan-hotspot' | 'broken-target' | 'hotspot-outside-screen' | 'overlapping-hotspots'
  | 'unreachable-screen' | 'state-without-screen';

export interface FlowIssue {
  readonly code: IssueCode;
  readonly severity: 'error' | 'warning';
  readonly subject: { readonly kind: 'flow' | 'screen' | 'hotspot' | 'route'; readonly id: string };
  readonly message: string;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Referential report. Every broken edge from `deriveEdges` appears here; nothing is dropped. */
export function validateFlow(flow: FlowDocument): readonly FlowIssue[] {
  const index = indexFlow(flow);
  const edges = deriveEdges(flow, index);
  const issues: FlowIssue[] = [];
  const { screensById, states: declared } = index;
  if (!screensById.has(flow.start)) {
    issues.push({ code: 'missing-start', severity: 'error', subject: { kind: 'flow', id: flow.id }, message: `Start screen ${flow.start} does not exist.` });
  }
  for (const screen of flow.screens) {
    const states = declared.get(screen.route);
    if (!states) {
      issues.push({ code: 'undeclared-route', severity: 'error', subject: { kind: 'screen', id: screen.id }, message: `Screen route ${screen.route} is not declared.` });
    } else if (!states.includes(screen.state)) {
      issues.push({ code: 'undeclared-state', severity: 'error', subject: { kind: 'screen', id: screen.id }, message: `State ${screen.state} is not declared for ${screen.route}.` });
    }
  }
  for (const screens of index.screensByRouteState.values()) {
    if (screens.length > 1) {
      const { route, state } = screens[0]!;
      issues.push({ code: 'duplicate-screen-state', severity: 'error', subject: { kind: 'route', id: route }, message: `Screens ${screens.map((screen) => screen.id).join(', ')} all render ${route} (${state}).` });
    }
  }
  for (const declaration of flow.routes) {
    for (const state of declaration.states) {
      if (!index.screensByRouteState.has(routeStateKey(declaration.route, state))) {
        issues.push({ code: 'state-without-screen', severity: 'warning', subject: { kind: 'route', id: declaration.route }, message: `No screen renders ${declaration.route} (${state}).` });
      }
    }
  }
  for (const edge of edges) {
    const subject = { kind: 'hotspot', id: edge.hotspotId } as const;
    if (!edge.fromExists) issues.push({ code: 'orphan-hotspot', severity: 'error', subject, message: `Hotspot "${edge.label}" is on missing screen ${edge.from}.` });
    if (edge.resolution.status === 'broken') issues.push({ code: 'broken-target', severity: 'error', subject, message: `Hotspot "${edge.label}" has a broken target: ${edge.resolution.detail}` });
  }
  for (const hotspot of flow.hotspots) {
    const screen = screensById.get(hotspot.screenId);
    const { x, y, width, height } = hotspot.rect;
    if (screen && (x < 0 || y < 0 || x + width > screen.viewport.w || y + height > screen.viewport.h)) {
      issues.push({ code: 'hotspot-outside-screen', severity: 'warning', subject: { kind: 'hotspot', id: hotspot.id }, message: `Hotspot "${hotspot.label}" extends outside its ${screen.viewport.w}×${screen.viewport.h} screen.` });
    }
  }
  flow.hotspots.forEach((a, index) => {
    for (const b of flow.hotspots.slice(index + 1)) {
      if (a.screenId === b.screenId && overlaps(a.rect, b.rect)) {
        issues.push({ code: 'overlapping-hotspots', severity: 'warning', subject: { kind: 'hotspot', id: a.id }, message: `Hotspots "${a.label}" and "${b.label}" overlap; the later one (${b.id}) receives clicks.` });
      }
    }
  });
  const reachable = screenDepths(flow, index, edges);
  if (screensById.has(flow.start)) {
    for (const screen of flow.screens) {
      if (!reachable.has(screen.id)) issues.push({ code: 'unreachable-screen', severity: 'warning', subject: { kind: 'screen', id: screen.id }, message: `Screen ${screen.title} cannot be reached from the start.` });
    }
  }
  return issues;
}
