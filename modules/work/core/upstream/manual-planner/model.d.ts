// Hand-written declarations for the verbatim upstream model.js (see PROVENANCE.md).

import type { Item, Settings } from '../../types';
import type { DateState, Period } from './dates.js';

type Option<Id extends string, Extra = {}> = { id: Id; label: string } & Extra;

export const STATUSES: Option<Item['status'], { hint: string }>[];
export const STATUS_LABEL: Record<Item['status'], string>;
export const CLOSED: Set<string>;
export const KINDS: Option<Item['kind'], { icon: string }>[];
export const KIND_META: Record<Item['kind'], Option<Item['kind'], { icon: string }>>;
export const MOTIVATIONS: Option<NonNullable<Item['motivation']>, { hint: string }>[];
export const MOTIVATION_LABEL: Record<NonNullable<Item['motivation']>, string>;
export const HORIZONS: Option<NonNullable<Item['horizon']>, { hint: string }>[];
export const HORIZON_LABEL: Record<NonNullable<Item['horizon']>, string>;
export const PRIORITIES: Option<NonNullable<Item['priority']>>[];
export const PRIORITY_LABEL: Record<NonNullable<Item['priority']>, string>;
/** Upstream link kinds only; the proposed `hq` kind is labeled by HQ code. */
export const REFERENCE_KINDS: Option<'url' | 'doc' | 'repo' | 'pr' | 'project' | 'workstream' | 'other'>[];
export const REFERENCE_LABEL: Record<'url' | 'doc' | 'repo' | 'pr' | 'project' | 'workstream' | 'other', string>;

/** `''` means any; `'__none'` means unset. */
export interface Filters { q: string; area: string; motivation: string; horizon: string; kind: string; priority: string }
export const EMPTY_FILTERS: Readonly<Filters>;

export function isOpen(item: Pick<Item, 'status'>): boolean;
export function isLive(item: Pick<Item, 'archived_at'>): boolean;
export function stepProgress(item: Pick<Item, 'next_steps'>): { total: number; done: number };
export function nextStep(item: Pick<Item, 'next_steps'>): Item['next_steps'][number] | null;
export function areaHue(area: string): number;
export function activeFilterCount(filters: Filters): number;
export function matchesFilters(item: Item, filters: Filters): boolean;
export function areasOf(items: readonly Item[]): string[];
export function columnItems(items: readonly Item[], status: string): Item[];
export function datedEntries(items: readonly Item[]): { item: Item; entry: Item['dates'][number]; bounds: Period }[];
export function cardDate(item: Item, today: string): { entry: Item['dates'][number]; state: DateState } | null;
export function untouchedDays(item: Item, today: string, zone: string): number;

export interface ReviewBuckets {
  inbox: Item[];
  overdue: { item: Item; entry: Item['dates'][number] }[];
  passedTargets: { item: Item; entry: Item['dates'][number] }[];
  stale: Item[];
  mismatched: { item: Item; reason: string }[];
  unsorted: Item[];
}
export function reviewBuckets(items: readonly Item[], today: string, settings: Pick<Settings, 'stale_days' | 'default_tz'>): ReviewBuckets;
