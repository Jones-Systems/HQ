import type { ReferenceEnvelope } from '@hq/contracts';

// The Planner item model (RW-1), mirrored field for field from the Planner
// service. Status, horizon and dates are separate axes; nothing here maps one
// onto another.

export const STATUS_IDS = ['inbox', 'considering', 'next', 'active', 'on_hold', 'done', 'dropped'] as const;
export type Status = (typeof STATUS_IDS)[number];
export const KIND_IDS = ['project', 'idea', 'goal', 'chore'] as const;
export type ItemKind = (typeof KIND_IDS)[number];
export const MOTIVATION_IDS = ['need', 'want', 'exploring'] as const;
export type Motivation = (typeof MOTIVATION_IDS)[number];
export const HORIZON_IDS = ['now', 'soon', 'later', 'someday'] as const;
export type Horizon = (typeof HORIZON_IDS)[number];
export const PRIORITY_IDS = ['high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITY_IDS)[number];
/** `hq` is the proposed D-4 entry; it is writable only behind `HQ_REFERENCES_FEATURE`. */
export const REF_KIND_IDS = ['url', 'doc', 'repo', 'pr', 'project', 'workstream', 'other', 'hq'] as const;
export type RefKind = (typeof REF_KIND_IDS)[number];
export const DATE_KIND_IDS = ['target', 'deadline', 'start', 'event'] as const;
export type DateKind = (typeof DATE_KIND_IDS)[number];
export const PRECISION_IDS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Precision = (typeof PRECISION_IDS)[number];
export type WeekStart = 'sun' | 'mon';

/** Advertised by a Planner that persists `{kind: 'hq'}` references losslessly. */
export const HQ_REFERENCES_FEATURE = 'hq-references-v1';

export const LIMITS = {
  title: 200, notes: 20_000, area: 40, steps: 100, stepText: 300,
  references: 30, referenceLabel: 200, referenceUrl: 2_000, dates: 20, dateNote: 120,
  minYear: 1900, maxYear: 2200,
} as const;

export interface NextStep { id: string; text: string; done: boolean }

export interface UrlReference { id: string; kind: Exclude<RefKind, 'hq'>; label: string; url: string }
export interface HqReference { id: string; kind: 'hq'; label: string; target: ReferenceEnvelope }
export type ItemReference = UrlReference | HqReference;

export interface PlanningDate {
  id: string;
  kind: DateKind;
  precision: Precision;
  value: string;
  time: string | null;
  end_time: string | null;
  tz: string | null;
  note: string;
  /** Derived by the service for timed entries; accepted on read, stripped before write. */
  instant?: string;
  end_instant?: string;
  tz_abbr?: string;
}

export interface Item {
  id: string;
  revision: number;
  title: string;
  kind: ItemKind;
  status: Status;
  motivation: Motivation | null;
  horizon: Horizon | null;
  priority: Priority | null;
  area: string | null;
  notes: string;
  next_steps: NextStep[];
  references: ItemReference[];
  dates: PlanningDate[];
  position: number;
  is_example: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  reviewed_at: string | null;
}

export interface Settings { default_tz: string; week_start: WeekStart; stale_days: number }

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 });

// Write inputs. Entry ids are optional: the service assigns one when absent.
export interface StepInput { id?: string; text: string; done?: boolean }
export type ReferenceInput =
  | { id?: string; kind?: Exclude<RefKind, 'hq'>; label?: string; url?: string }
  | { id?: string; kind: 'hq'; label?: string; target: ReferenceEnvelope };
export interface DateInput {
  id?: string;
  kind: DateKind;
  precision: Precision;
  value: string;
  time?: string | null;
  end_time?: string | null;
  tz?: string | null;
  note?: string;
  instant?: string;
  end_instant?: string;
  tz_abbr?: string;
}

export interface NewItemFields {
  title: string;
  kind?: ItemKind;
  status?: Status;
  motivation?: Motivation | null;
  horizon?: Horizon | null;
  priority?: Priority | null;
  area?: string | null;
  notes?: string;
  next_steps?: StepInput[];
  references?: ReferenceInput[];
  dates?: DateInput[];
}

/** RW-7: every status change is a `move`, so a patch cannot name `status`. */
export type ItemPatch = Partial<Omit<NewItemFields, 'status'>> & { status?: never };

export const EDITABLE_FIELDS = ['title', 'kind', 'status', 'motivation', 'horizon', 'priority', 'area', 'notes', 'next_steps', 'references', 'dates'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type PatchField = Exclude<EditableField, 'status'>;

export interface FieldError { field: string; message: string }
