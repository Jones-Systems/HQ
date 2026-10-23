import type { ReferenceEnvelope } from '@hq/contracts';
import { DEFAULT_BRAND_ID, FEATURE_HQ_REFERENCES, type Channel, type DraftFields, type RunRecord } from '../core';
import { shortId } from './format';
import type { ResultSummary } from './results';

/**
 * Start draft from a result (RR-6). The draft starts unsaved and carries a run citation. The citation is
 * persisted only when the service advertises `hq-references-v1`; otherwise it stays visible as not saved.
 */

/** The run's as-of date: the day it finished, else the day it was created (service timestamps are UTC). */
export function runAsOf(run: Pick<RunRecord, 'created_at' | 'finished_at'>): string {
  return (run.finished_at ?? run.created_at).slice(0, 10);
}

/**
 * A `run` reference to the result. `returnDestination` is the Social library: the draft that will carry the
 * citation has no ID until its first save.
 */
export function runCitation(run: Pick<RunRecord, 'id' | 'is_example' | 'created_at' | 'finished_at'>, toolName: string, projectId: string): ReferenceEnvelope {
  const asOf = runAsOf(run);
  return {
    version: 1, domain: 'social', projectId, kind: 'run', entityId: run.id,
    title: `${toolName} run · ${asOf}${run.is_example ? ' · example' : ''}`,
    returnDestination: { domain: 'social', destination: 'library' },
    sourceRevision: asOf,
  };
}

export function canSaveCitation(features: readonly string[]): boolean {
  return features.includes(FEATURE_HQ_REFERENCES);
}

const TITLE_LIMIT = 200;
const BODY_LIMIT = 50_000;

/** Unsaved draft fields from a result. `links` is included only when the service can store it. */
export function draftFromResult(
  run: Pick<RunRecord, 'id' | 'tool' | 'is_example' | 'created_at' | 'finished_at'>, toolName: string, summary: ResultSummary,
  citation: ReferenceEnvelope, features: readonly string[],
): DraftFields {
  const prefix = run.is_example ? 'EXAMPLE — ' : '';
  const body = summary.draftText ?? summary.heading;
  const lead = run.tool === 'x-studio' ? body.split('\n')[0]!.trim() : `${toolName} findings · ${runAsOf(run)}`;
  const title = `${prefix}${lead || toolName}`.slice(0, TITLE_LIMIT).trim();
  const basis = `Source: ${toolName} run ${shortId(run.id)}, ${run.is_example ? 'example data' : 'supplied data'} as of ${runAsOf(run)}.`;
  const channel: Channel = run.tool === 'x-studio' ? 'X' : 'General';
  return {
    title, body: (run.tool === 'x-studio' ? body : `${summary.heading}\n\n${body}\n\n${basis}`).slice(0, BODY_LIMIT),
    brand_id: DEFAULT_BRAND_ID, channel, planned_date: '', archived: 0,
    ...(canSaveCitation(features) ? { links: [citation] } : {}),
  };
}
