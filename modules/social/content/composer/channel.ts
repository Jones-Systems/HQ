import type { ReferenceEnvelope } from '@hq/contracts';
import { LIMITS, codePoints, type Channel, type DraftFields } from '../../core';
import { dateLabel } from '../model';

/**
 * Illustrative per-channel length guides for the composer. They help a person judge how a post may read; they are
 * not platform rules and nothing here is read from a platform. Authoritative limits belong to the Channel preview
 * profiles (docs/design/social/hq-social-design.md). `null` means no guide is shown for that channel.
 */
export const ILLUSTRATIVE_LIMITS: { readonly [C in Channel]: number | null } = {
  General: null, X: 280, LinkedIn: 3000, TikTok: 2200, Instagram: 2200, Facebook: 2200, Reddit: null, Article: null,
};

/** Channels whose post reads with the draft title as its headline; the others show the body alone. */
const HEADLINE_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(['General', 'Reddit', 'Article']);
export function showsHeadline(channel: Channel): boolean {
  return HEADLINE_CHANNELS.has(channel);
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Splits text at `limit` code points, so the part beyond an illustrative limit can be marked. */
export function splitAtLimit(text: string, limit: number | null): { readonly within: string; readonly over: string } {
  if (limit === null || codePoints(text) <= limit) return { within: text, over: '' };
  const characters = Array.from(text);
  return { within: characters.slice(0, limit).join(''), over: characters.slice(limit).join('') };
}

export type CheckState = 'pass' | 'warn' | 'fail' | 'info';
export interface DraftCheck {
  readonly id: string;
  readonly state: CheckState;
  readonly label: string;
}

/**
 * The composer's checks. Only the service's own size rules can fail a save; the illustrative guide is advice and
 * never blocks anything.
 */
export function draftChecks(fields: Pick<DraftFields, 'title' | 'body' | 'channel'>): DraftCheck[] {
  const bodyLength = codePoints(fields.body);
  const titleLength = codePoints(fields.title);
  const limit = ILLUSTRATIVE_LIMITS[fields.channel];
  const checks: DraftCheck[] = [
    fields.title.trim() === ''
      ? { id: 'title', state: 'fail', label: 'Needs a title before it can be saved' }
      : { id: 'title', state: 'pass', label: 'Has a title' },
    fields.body.trim() === ''
      ? { id: 'text', state: 'warn', label: 'No text yet' }
      : { id: 'text', state: 'pass', label: 'Has text' },
  ];
  if (limit === null) {
    checks.push({ id: 'limit', state: 'info', label: `No length guide for ${fields.channel}` });
  } else if (bodyLength <= limit) {
    checks.push({ id: 'limit', state: 'pass', label: `Within ${formatCount(limit)} characters (illustrative limit)` });
  } else {
    checks.push({ id: 'limit', state: 'warn', label: `${formatCount(bodyLength - limit)} over the illustrative ${formatCount(limit)}-character limit` });
  }
  if (bodyLength > LIMITS.body) {
    checks.push({ id: 'size', state: 'fail', label: `Body is over the Social service limit of ${formatCount(LIMITS.body)} characters` });
  } else if (titleLength > LIMITS.title) {
    checks.push({ id: 'size', state: 'fail', label: `Title is over the Social service limit of ${formatCount(LIMITS.title)} characters` });
  } else {
    checks.push({ id: 'size', state: 'pass', label: 'Within the Social service size limits' });
  }
  return checks;
}

/** "Signal inbox run · 2026-10-18 · example" is how a run citation titles itself; the tool name is the lead. */
const RUN_TITLE = /^(.*?)\s+run\s+·\s+(\d{4}-\d{2}-\d{2})(\s+·\s+example)?$/u;
const AS_OF = /^\d{4}-\d{2}-\d{2}$/u;

export interface RunOrigin {
  readonly tool: string;
  /** "18 Oct 2026" when the citation carries a date. */
  readonly asOf?: string;
  readonly example: boolean;
  readonly envelope: ReferenceEnvelope;
}

/** The run a draft was started from, read from its citation, or undefined when it has none. */
export function runOrigin(links: readonly ReferenceEnvelope[] | undefined): RunOrigin | undefined {
  const envelope = links?.find((link) => link.kind === 'run');
  if (!envelope) return undefined;
  const parsed = RUN_TITLE.exec(envelope.title);
  const date = parsed?.[2] ?? (envelope.sourceRevision && AS_OF.test(envelope.sourceRevision) ? envelope.sourceRevision : undefined);
  return {
    envelope,
    tool: parsed?.[1] ?? envelope.title,
    ...(date ? { asOf: dateLabel(date) } : {}),
    example: Boolean(parsed?.[3]),
  };
}
