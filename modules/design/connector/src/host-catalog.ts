/**
 * `hq.design.host-catalog/v1`: observed execution destinations.
 *
 * A catalog entry records what was observed about a destination (endpoint,
 * mode, identity, freshness, reachability). It never grants execution
 * eligibility; see eligibility.ts. Entries are keyed by opaque DestinationId and
 * never merged by label.
 */

import type { DestinationId, HostId, ReceiverId, ThreadRef } from './ids.ts';
import { isIdText } from './ids.ts';
import { hasExactKeys, isCount, isRecord, isText, isTimestamp, oneOf, schemaVariance } from './validate.ts';

export const HOST_CATALOG_SCHEMA = 'hq.design.host-catalog/v1';

export const TRANSPORT_KINDS = ['fake-receiver', 'jones-code'] as const;
export type TransportKind = (typeof TRANSPORT_KINDS)[number];

export const DESTINATION_MODES = ['existing-thread', 'new-thread'] as const;
export type DestinationMode = (typeof DESTINATION_MODES)[number];

export const FRESHNESS_STATUSES = ['fresh', 'stale', 'offline', 'timeout', 'error', 'missing-at-host'] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

/** Reported reachability. Reachable is an observation, not permission to send. */
export const OBSERVED_STATUSES = ['reachable', 'unreachable', 'unknown'] as const;
export type ObservedStatus = (typeof OBSERVED_STATUSES)[number];

export interface DestinationEndpoint {
  readonly transport: TransportKind;
  /** Opaque, public-safe locator resolved by the transport adapter. Never carries credentials. */
  readonly locator: string;
}

export interface DestinationIdentity {
  readonly hostId: HostId;
  readonly receiverId: ReceiverId;
  readonly fingerprint: string;
}

export interface ModelPin {
  readonly provider: string;
  readonly model: string;
}

export interface Freshness {
  readonly status: FreshnessStatus;
  readonly lastSuccessAt: string | null;
  readonly generation: number;
}

/** Observed identity that differs from the accepted one; held until explicitly acknowledged. */
export interface IdentityConflict {
  readonly observed: DestinationIdentity;
  readonly observedEndpoint: DestinationEndpoint;
  readonly observedAt: string;
}

export interface Destination {
  readonly destinationId: DestinationId;
  readonly label: string;
  readonly endpoint: DestinationEndpoint;
  readonly mode: DestinationMode;
  readonly identity: DestinationIdentity;
  /** Required for existing-thread destinations. */
  readonly threadRef?: ThreadRef;
  /** A pinned model is sent as-is; the receiver must not substitute another. */
  readonly model?: ModelPin;
  readonly freshness: Freshness;
  readonly status: ObservedStatus;
  readonly identityConflict?: IdentityConflict;
}

export interface HostCatalog {
  readonly schema: typeof HOST_CATALOG_SCHEMA;
  readonly generation: number;
  /** A complete snapshot may mark omitted entries missing-at-host; a partial one never removes entries. */
  readonly complete: boolean;
  readonly observedAt: string;
  readonly destinations: readonly Destination[];
}

export type CatalogParseError =
  | { readonly code: 'unsupported-schema'; readonly detail: string }
  | { readonly code: 'malformed'; readonly detail: string }
  | { readonly code: 'duplicate-destination'; readonly detail: string };

export type CatalogParseResult =
  | { readonly ok: true; readonly catalog: HostCatalog }
  | { readonly ok: false; readonly error: CatalogParseError };

/** Locators must be opaque handles, not credential- or query-bearing URLs. */
export function isSafeLocator(value: unknown): value is string {
  return isText(value, 300) && !/[\s@?#]/u.test(value);
}

function parseIdentity(value: unknown): DestinationIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, ['hostId', 'receiverId', 'fingerprint'])) return null;
  if (!isIdText(value.hostId) || !isIdText(value.receiverId) || !isText(value.fingerprint, 200)) return null;
  return { hostId: value.hostId as HostId, receiverId: value.receiverId as ReceiverId, fingerprint: value.fingerprint };
}

function parseEndpoint(value: unknown): DestinationEndpoint | null {
  if (!isRecord(value) || !hasExactKeys(value, ['transport', 'locator'])) return null;
  if (!oneOf(TRANSPORT_KINDS, value.transport) || !isSafeLocator(value.locator)) return null;
  return { transport: value.transport, locator: value.locator };
}

function parseModel(value: unknown): ModelPin | null {
  if (!isRecord(value) || !hasExactKeys(value, ['provider', 'model'])) return null;
  if (!isText(value.provider, 120) || !isText(value.model, 120)) return null;
  return { provider: value.provider, model: value.model };
}

function parseFreshness(value: unknown): Freshness | null {
  if (!isRecord(value) || !hasExactKeys(value, ['status', 'lastSuccessAt', 'generation'])) return null;
  if (!oneOf(FRESHNESS_STATUSES, value.status) || !isCount(value.generation)) return null;
  if (value.lastSuccessAt !== null && !isTimestamp(value.lastSuccessAt)) return null;
  return { status: value.status, lastSuccessAt: value.lastSuccessAt, generation: value.generation };
}

function parseDestination(value: unknown, index: number): Destination | string {
  const where = `destinations[${index}]`;
  if (!isRecord(value) || !hasExactKeys(value,
    ['destinationId', 'label', 'endpoint', 'mode', 'identity', 'freshness', 'status'],
    ['threadRef', 'model'])) return `${where}: unexpected or missing fields`;
  if (!isIdText(value.destinationId)) return `${where}.destinationId`;
  if (!isText(value.label, 160)) return `${where}.label`;
  const endpoint = parseEndpoint(value.endpoint);
  if (!endpoint) return `${where}.endpoint`;
  if (!oneOf(DESTINATION_MODES, value.mode)) return `${where}.mode`;
  const identity = parseIdentity(value.identity);
  if (!identity) return `${where}.identity`;
  const freshness = parseFreshness(value.freshness);
  if (!freshness) return `${where}.freshness`;
  if (!oneOf(OBSERVED_STATUSES, value.status)) return `${where}.status`;
  if ('threadRef' in value && !isIdText(value.threadRef)) return `${where}.threadRef`;
  if (value.mode === 'existing-thread' && !('threadRef' in value)) return `${where}.threadRef required for existing-thread`;
  if (value.mode === 'new-thread' && 'threadRef' in value) return `${where}.threadRef not allowed for new-thread`;
  const model = 'model' in value ? parseModel(value.model) : undefined;
  if (model === null) return `${where}.model`;
  return {
    destinationId: value.destinationId as DestinationId,
    label: value.label,
    endpoint,
    mode: value.mode,
    identity,
    ...(typeof value.threadRef === 'string' ? { threadRef: value.threadRef as ThreadRef } : {}),
    ...(model ? { model } : {}),
    freshness,
    status: value.status,
  };
}

/** Strictly parse an untrusted catalog document. Other schema versions are rejected, never down-converted. */
export function parseHostCatalog(value: unknown): CatalogParseResult {
  if (!isRecord(value)) return { ok: false, error: { code: 'malformed', detail: 'not an object' } };
  const variance = schemaVariance(value.schema, HOST_CATALOG_SCHEMA);
  if (variance === 'other-version') return { ok: false, error: { code: 'unsupported-schema', detail: String(value.schema) } };
  if (variance === 'invalid') return { ok: false, error: { code: 'malformed', detail: 'schema' } };
  if (!hasExactKeys(value, ['schema', 'generation', 'complete', 'observedAt', 'destinations'])) {
    return { ok: false, error: { code: 'malformed', detail: 'unexpected or missing fields' } };
  }
  if (!isCount(value.generation) || typeof value.complete !== 'boolean' || !isTimestamp(value.observedAt)
    || !Array.isArray(value.destinations)) {
    return { ok: false, error: { code: 'malformed', detail: 'header' } };
  }
  const destinations: Destination[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.destinations.entries()) {
    const parsed = parseDestination(item, index);
    if (typeof parsed === 'string') return { ok: false, error: { code: 'malformed', detail: parsed } };
    if (seen.has(parsed.destinationId)) {
      return { ok: false, error: { code: 'duplicate-destination', detail: parsed.destinationId } };
    }
    seen.add(parsed.destinationId);
    destinations.push(parsed);
  }
  return {
    ok: true,
    catalog: {
      schema: HOST_CATALOG_SCHEMA, generation: value.generation, complete: value.complete,
      observedAt: value.observedAt, destinations,
    },
  };
}

export function sameIdentity(a: DestinationIdentity, b: DestinationIdentity): boolean {
  return a.hostId === b.hostId && a.receiverId === b.receiverId && a.fingerprint === b.fingerprint;
}

function sameEndpoint(a: DestinationEndpoint, b: DestinationEndpoint): boolean {
  return a.transport === b.transport && a.locator === b.locator;
}

export interface CatalogMerge {
  readonly catalog: HostCatalog;
  readonly applied: boolean;
  /** Destination IDs whose observed identity or endpoint changed and is now held. */
  readonly conflicts: readonly DestinationId[];
}

/**
 * Fold a refreshed snapshot into the accepted catalog.
 *
 * - An older or equal generation is a late response and is ignored.
 * - A changed identity or endpoint keeps the accepted values and records an identityConflict.
 * - Omitted entries are kept: marked missing-at-host by a complete snapshot, stale otherwise.
 */
export function mergeHostCatalog(previous: HostCatalog | null, incoming: HostCatalog): CatalogMerge {
  if (previous === null) return { catalog: incoming, applied: true, conflicts: [] };
  if (incoming.generation <= previous.generation) return { catalog: previous, applied: false, conflicts: [] };
  const conflicts: DestinationId[] = [];
  const prior = new Map(previous.destinations.map((entry) => [entry.destinationId, entry] as const));
  const merged: Destination[] = incoming.destinations.map((entry) => {
    const accepted = prior.get(entry.destinationId);
    if (!accepted) return entry;
    if (sameIdentity(accepted.identity, entry.identity) && sameEndpoint(accepted.endpoint, entry.endpoint)) {
      // A matching observation does not clear a held conflict; only acknowledgement does.
      return accepted.identityConflict ? { ...entry, identityConflict: accepted.identityConflict } : entry;
    }
    conflicts.push(entry.destinationId);
    return {
      ...entry,
      identity: accepted.identity,
      endpoint: accepted.endpoint,
      identityConflict: { observed: entry.identity, observedEndpoint: entry.endpoint, observedAt: incoming.observedAt },
    };
  });
  const present = new Set(incoming.destinations.map((entry) => entry.destinationId));
  for (const entry of previous.destinations) {
    if (present.has(entry.destinationId)) continue;
    merged.push({
      ...entry,
      freshness: { ...entry.freshness, status: incoming.complete ? 'missing-at-host' : 'stale' },
    });
  }
  return {
    catalog: { ...incoming, destinations: merged },
    applied: true,
    conflicts,
  };
}

/** Explicit owner action adopting the held observed identity for one destination. */
export function acknowledgeIdentity(catalog: HostCatalog, destinationId: DestinationId): HostCatalog {
  return {
    ...catalog,
    destinations: catalog.destinations.map((entry) => {
      if (entry.destinationId !== destinationId || !entry.identityConflict) return entry;
      const { identityConflict, ...rest } = entry;
      return { ...rest, identity: identityConflict.observed, endpoint: identityConflict.observedEndpoint };
    }),
  };
}

export function findDestination(catalog: HostCatalog, destinationId: DestinationId): Destination | null {
  return catalog.destinations.find((entry) => entry.destinationId === destinationId) ?? null;
}
