import type { AnchorRect, DeclaredRightsInput, GraphAnchorCandidate, GraphCaptureCandidate } from '../../src/graph-contract.ts';
import type { RightsMapping } from '../../src/rights.ts';
import { mapDeclaredRights } from '../../src/rights.ts';
import type { DeclaredRightsConfig, ProducerRef } from './config.ts';
import { fail, ProducerError } from './errors.ts';
import { mediaTypeForPath, sniffMatches } from './media.ts';
import type { ReadSession } from './safe-fs.ts';
import { isSafeRelative, sha256Digest } from './safe-fs.ts';

import { account, arr, digest, obj, optionalStr, posInt, str } from './source-json.ts';
import type { Tally } from './tally.ts';

export interface CaptureContext {
  readonly session: ReadSession;
  /** Prefix (release directory) that image paths are relative to, or empty. */
  readonly prefix: string;
  readonly tally: Tally;
  readonly sourceRights: DeclaredRightsConfig | null;
  readonly sourceProducer: ProducerRef | null;
}

const RANK = { permitted: 0, unknown: 1, restricted: 2, private: 3 } as const;
const rankOf = (mapping: RightsMapping): number => (mapping.private ? RANK.private : RANK[mapping.effective]);

/**
 * Combines the source default and a capture's own statement by taking the more restrictive of the
 * two. Rights can only tighten here: nothing a source file says can make a capture more permitted
 * than the owner's configured default. A grant with no basis is treated as unknown.
 */
export function combineRights(
  fromSource: DeclaredRightsConfig | null, fromCapture: DeclaredRightsConfig | null, tally: Tally,
): DeclaredRightsInput | undefined {
  const usable = [fromSource, fromCapture].filter((item): item is DeclaredRightsConfig => item !== null).map((item) => {
    const mapping = mapDeclaredRights(item.vocabulary, item.value);
    if (mapping.effective === 'permitted' && item.basis === undefined) {
      tally.add('rights-grant-without-basis');
      return { item: { vocabulary: 'hq.design.references/v1', value: 'unknown' }, mapping: { effective: 'unknown', private: false } as RightsMapping };
    }
    return { item, mapping };
  });
  if (usable.length === 0) return undefined;
  let chosen = usable[0]!;
  for (const candidate of usable.slice(1)) if (rankOf(candidate.mapping) > rankOf(chosen.mapping)) chosen = candidate;
  if (fromSource !== null && fromCapture !== null) {
    const source = usable[0]!;
    if (rankOf(chosen.mapping) > rankOf(source.mapping)) tally.add('rights-tightened-by-capture');
  }
  const { vocabulary, value } = chosen.item;
  const basis = 'basis' in chosen.item ? chosen.item.basis : undefined;
  const attribution = 'attribution' in chosen.item ? chosen.item.attribution : undefined;
  return { vocabulary, value, ...(basis === undefined ? {} : { basis }), ...(attribution === undefined ? {} : { attribution }) };
}

function rightsOf(raw: unknown, where: string): DeclaredRightsConfig | null {
  if (raw === undefined) return null;
  const value = obj(raw, where);
  return {
    vocabulary: str(value.vocabulary, `${where}.vocabulary`, 64), value: str(value.value, `${where}.value`, 64),
    ...(value.basis === undefined ? {} : { basis: str(value.basis, `${where}.basis`, 500) }),
    ...(value.attribution === undefined ? {} : { attribution: str(value.attribution, `${where}.attribution`, 500) }),
  };
}

const FACT_FIELDS = ['key', 'kind', 'label', 'parentKey', 'rect'];

export function parseFacts(raw: unknown, where: string, tally: Tally): GraphAnchorCandidate[] {
  if (raw === undefined) return [];
  const out: GraphAnchorCandidate[] = [];
  for (const [index, item] of arr(raw, where, 500).entries()) {
    const fact = obj(item, `${where}[${index}]`);
    account(fact, FACT_FIELDS, tally);
    let rect: AnchorRect | undefined;
    if (fact.rect !== undefined) {
      const r = obj(fact.rect, `${where}[${index}].rect`);
      const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : fail('invalid-field', `${where}[${index}].rect`));
      rect = { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) };
    }
    const parentKey = optionalStr(fact.parentKey, `${where}[${index}].parentKey`, 200);
    out.push({
      key: str(fact.key, `${where}[${index}].key`, 200), kind: str(fact.kind, `${where}[${index}].kind`, 20),
      label: str(fact.label, `${where}[${index}].label`, 200), ...(parentKey === undefined ? {} : { parentKey }), ...(rect === undefined ? {} : { rect }),
    });
  }
  return out;
}

const CAPTURE_FIELDS = ['kind', 'capturedAt', 'capturedBy', 'captureKey', 'image', 'sourceStatus', 'rights', 'producer', 'nativeEvidence', 'anchors', 'facts'];
const IMAGE_FIELDS = ['path', 'sha256', 'bytes', 'mediaType', 'w', 'h', 'durationMs'];
const CLAIMS = ['agent-reported', 'observed', 'owner-judged'];

/**
 * Reads one capture (gallery capture or study frame). Returns null when the capture is excluded
 * (counted, never described). Declared digests and sizes are checked against the bytes; a missing,
 * oversized or hash-invalid blob keeps the capture with its declared digest but no bytes, so the
 * graph records it as `blob-missing` instead of losing it.
 */
export async function parseCapture(
  rawValue: unknown, where: string, context: CaptureContext, extraFacts: readonly GraphAnchorCandidate[],
): Promise<{ readonly candidate: GraphCaptureCandidate; readonly merge: string } | null> {
  const raw = obj(rawValue, where);
  account(raw, CAPTURE_FIELDS, context.tally);
  const kind = str(raw.kind, `${where}.kind`, 20);
  const capturedAt = str(raw.capturedAt, `${where}.capturedAt`, 40);
  // A claim in a source file is only a claim: nothing read here is recorded above agent-reported.
  if (!CLAIMS.includes(str(raw.capturedBy, `${where}.capturedBy`, 20))) return fail('invalid-field', `${where}.capturedBy`);
  const captureKey = optionalStr(raw.captureKey, `${where}.captureKey`, 200);
  const rights = combineRights(context.sourceRights, rightsOf(raw.rights, `${where}.rights`), context.tally);
  const ownProducer = raw.producer === undefined ? null : obj(raw.producer, `${where}.producer`);
  const producer = ownProducer !== null
    ? { id: str(ownProducer.id, `${where}.producer.id`, 100), ...(ownProducer.label === undefined ? {} : { label: str(ownProducer.label, `${where}.producer.label`, 200) }) }
    : context.sourceProducer;
  let nativeEvidence: GraphCaptureCandidate['nativeEvidence'];
  if (raw.nativeEvidence !== undefined) {
    const evidence = obj(raw.nativeEvidence, `${where}.nativeEvidence`);
    nativeEvidence = {
      platform: str(evidence.platform, `${where}.nativeEvidence.platform`, 20), runtime: str(evidence.runtime, `${where}.nativeEvidence.runtime`, 20),
      buildRef: str(evidence.buildRef, `${where}.nativeEvidence.buildRef`, 200), claim: 'agent-reported',
    };
  }
  const sourceStatus = optionalStr(raw.sourceStatus, `${where}.sourceStatus`, 30);
  const facts = [...parseFacts(raw.anchors, `${where}.anchors`, context.tally), ...parseFacts(raw.facts, `${where}.facts`, context.tally), ...extraFacts];

  let asset: GraphCaptureCandidate['asset'];
  let mergeKey: string;
  if (raw.image === undefined) {
    if (captureKey === undefined) return fail('invalid-field', `${where}.captureKey`);
    if (facts.length > 0) context.tally.add('anchors-dropped-no-image', facts.length);
    mergeKey = `${kind}\u0000key:${captureKey}`;
  } else {
    const image = obj(raw.image, `${where}.image`);
    account(image, IMAGE_FIELDS, context.tally);
    const rel = image.path;
    if (!isSafeRelative(rel)) return fail('unsafe-path', `${where}.image.path`);
    const declaredDigest = digest(image.sha256, `${where}.image.sha256`);
    const declaredBytes = posInt(image.bytes, `${where}.image.bytes`);
    const mediaType = str(image.mediaType, `${where}.image.mediaType`, 127);
    let expected: string;
    try { expected = mediaTypeForPath(rel); } catch (error) {
      if (error instanceof ProducerError && error.code === 'excluded-content-type') { context.tally.add('captures-excluded-content-type'); return null; }
      throw error;
    }
    if (expected !== mediaType) { context.tally.add('captures-excluded-media-type-mismatch'); return null; }
    const dims = ['w', 'h', 'durationMs'].flatMap((name) => (image[name] === undefined ? [] : [[name, posInt(image[name], `${where}.image.${name}`)] as const]));
    const extras = Object.fromEntries(dims);
    let bytes: Uint8Array | null = null;
    try {
      bytes = await context.session.read(context.prefix === '' ? rel : `${context.prefix}/${rel}`, 'blob');
    } catch (error) {
      if (!(error instanceof ProducerError) || (error.code !== 'file-missing' && error.code !== 'file-too-large')) throw error;
      context.tally.add(error.code === 'file-missing' ? 'blobs-missing' : 'blobs-too-large');
    }
    if (bytes !== null && (bytes.length !== declaredBytes || sha256Digest(bytes) !== declaredDigest)) {
      context.tally.add('blobs-hash-invalid');
      bytes = null;
    }
    if (bytes !== null && !sniffMatches(mediaType, bytes)) { context.tally.add('captures-excluded-content-mismatch'); return null; }
    asset = bytes === null
      ? { digest: declaredDigest, byteLength: declaredBytes, mediaType, ...extras }
      : { bytes, mediaType, ...extras };
    if (bytes !== null) context.tally.add('blobs-read');
    mergeKey = `${kind}\u0000sha:${declaredDigest}`;
  }
  const candidate: GraphCaptureCandidate = {
    kind, capturedAt, capturedBy: 'agent-reported',
    ...(captureKey === undefined || raw.image !== undefined ? {} : { captureKey }),
    ...(asset === undefined ? {} : { asset }),
    ...(nativeEvidence === undefined ? {} : { nativeEvidence }),
    ...(rights === undefined ? {} : { rights }),
    ...(producer === null ? {} : { producer }),
    ...(sourceStatus === undefined ? {} : { sourceStatus }),
    ...(facts.length === 0 || raw.image === undefined ? {} : { anchors: dedupeFacts(facts, context.tally) }),
  };
  return { candidate, merge: mergeKey };
}

export function dedupeFacts(facts: readonly GraphAnchorCandidate[], tally: Tally): GraphAnchorCandidate[] {
  const seen = new Set<string>();
  const out: GraphAnchorCandidate[] = [];
  for (const fact of facts) {
    if (seen.has(fact.key)) { tally.add('anchors-duplicate-key'); continue; }
    seen.add(fact.key);
    out.push(fact);
  }
  return out;
}

/** Folds a duplicate capture (same subject, kind and content) into the first, keeping the union of anchors. */
export function mergeCaptures(first: GraphCaptureCandidate, later: GraphCaptureCandidate, tally: Tally): GraphCaptureCandidate {
  tally.add('captures-merged-duplicate');
  const anchors = dedupeFacts([...(first.anchors ?? []), ...(later.anchors ?? [])], tally);
  const { anchors: _drop, ...rest } = first;
  return anchors.length === 0 ? rest : { ...rest, anchors };
}

