import type {
  AppFlowCandidate, AppScreenCandidate, AppTreeCandidate, GraphAnchorCandidate, GraphTreeCandidate,
  WebsitePageCandidate, WebsiteTreeCandidate,
} from '../../src/graph-contract.ts';
import type { CaptureContext } from './capture.ts';
import { dedupeFacts, parseCapture, parseFacts } from './capture.ts';
import type { StudySource } from './config.ts';
import { fail } from './errors.ts';
import type { SourceRead } from './gallery.ts';
import { CaptureBucket } from './gallery.ts';
import { isSafeRelative, ReadSession, sha256Digest } from './safe-fs.ts';
import { account, arr, digest, obj, optionalStr, parseDocument, str } from './source-json.ts';
import { Tally } from './tally.ts';

export const STUDY_SCHEMA = 'hq.producer.study/v1';
export const STUDY_RECEIPT_SCHEMA = 'hq.producer.study-receipt/v1';
export const STUDY_RUN_SCHEMA = 'hq.producer.study-run/v1';
export const STUDY_ANNOTATIONS_SCHEMA = 'hq.producer.study-annotations/v1';

/**
 * Reads one study: `study.json`, its `receipt.json`, and the run and annotation files the receipt
 * lists. Every file must match its receipt digest, the receipt must match `study.json`, and a
 * partial receipt only lets through the runs it marks complete.
 */
export async function readStudy(source: StudySource): Promise<SourceRead> {
  const session = await ReadSession.open(source.root, source.limits);
  const tally = new Tally();
  const studyBytes = await session.read('study.json', 'json');
  const study = parseDocument(studyBytes, STUDY_SCHEMA, 'study');
  account(study, ['schema', 'title', 'subject', 'runs'], tally);
  const receiptBytes = await session.read('receipt.json', 'json');
  const receipt = parseDocument(receiptBytes, STUDY_RECEIPT_SCHEMA, 'receipt');
  account(receipt, ['schema', 'studyDigest', 'status', 'files', 'completeRuns'], tally);
  if (digest(receipt.studyDigest, 'receipt.studyDigest') !== sha256Digest(studyBytes)) return fail('study-digest-mismatch', 'receipt.studyDigest');
  if (receipt.status !== 'complete' && receipt.status !== 'partial') return fail('invalid-field', 'receipt.status');

  const digests = new Map<string, string>();
  for (const [index, fileValue] of arr(receipt.files, 'receipt.files', 20_000).entries()) {
    const file = obj(fileValue, `receipt.files[${index}]`);
    account(file, ['path', 'digest'], tally);
    const rel = file.path;
    if (!isSafeRelative(rel)) return fail('unsafe-path', `receipt.files[${index}].path`);
    if (digests.has(rel)) return fail('invalid-field', `receipt.files[${index}].path`);
    digests.set(rel, digest(file.digest, `receipt.files[${index}].digest`));
  }
  const completeRuns = new Set(arr(receipt.completeRuns, 'receipt.completeRuns', 5000).map((id, index) => str(id, `receipt.completeRuns[${index}]`, 200)));

  const title = str(study.title, 'study.title');
  const subject = obj(study.subject, 'study.subject');
  const website = subject.kind === 'website';
  if (!website && subject.kind !== 'app') return fail('unsupported-subject-kind', 'study.subject.kind');
  account(subject, ['kind', 'origin', 'platform', 'appId', 'name'], tally);

  const context: CaptureContext = { session, prefix: '', tally, sourceRights: source.rights, sourceProducer: source.producer };
  const steps = new Map<string, { readonly title: string }>();
  const stepOrder: string[] = [];
  const flows: AppFlowCandidate[] = [];
  const buckets = new Map<string, CaptureBucket>();

  for (const [index, runValue] of arr(study.runs, 'study.runs', 5000).entries()) {
    const where = `study.runs[${index}]`;
    const ref = obj(runValue, where);
    account(ref, ['id', 'path'], tally);
    const runId = str(ref.id, `${where}.id`, 200);
    const runPath = ref.path;
    if (!isSafeRelative(runPath)) return fail('unsafe-path', `${where}.path`);
    tally.add('runs-declared');
    if (receipt.status === 'partial' && !completeRuns.has(runId)) { tally.add('runs-skipped-partial'); continue; }
    const runBytes = await session.read(runPath, 'json');
    if (digests.get(runPath) !== sha256Digest(runBytes)) return fail(digests.has(runPath) ? 'receipt-digest-mismatch' : 'receipt-missing-file', where);
    const run = parseDocument(runBytes, STUDY_RUN_SCHEMA, `run[${index}]`);
    account(run, ['schema', 'runId', 'title', 'steps', 'annotations'], tally);
    if (run.runId !== runId) return fail('run-id-mismatch', `${where}.id`);

    // Annotation facts, keyed by step and frame index.
    const annotated = new Map<string, GraphAnchorCandidate[]>();
    const annotationPath = optionalStr(run.annotations, `run[${index}].annotations`, 512);
    if (annotationPath !== undefined) {
      if (!isSafeRelative(annotationPath)) return fail('unsafe-path', `run[${index}].annotations`);
      const annotationBytes = await session.read(annotationPath, 'json');
      if (digests.get(annotationPath) !== sha256Digest(annotationBytes)) return fail(digests.has(annotationPath) ? 'receipt-digest-mismatch' : 'receipt-missing-file', `run[${index}].annotations`);
      const annotations = parseDocument(annotationBytes, STUDY_ANNOTATIONS_SCHEMA, `annotations[${index}]`);
      account(annotations, ['schema', 'runId', 'frames'], tally);
      if (annotations.runId !== runId) return fail('run-id-mismatch', `annotations[${index}].runId`);
      for (const [at, frameValue] of arr(annotations.frames, `annotations[${index}].frames`, 20_000).entries()) {
        const frame = obj(frameValue, `annotations[${index}].frames[${at}]`);
        account(frame, ['step', 'index', 'facts'], tally);
        const position = frame.index;
        if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) return fail('invalid-field', `annotations[${index}].frames[${at}].index`);
        const key = `${str(frame.step, `annotations[${index}].frames[${at}].step`)}\u0000${position}`;
        annotated.set(key, [...(annotated.get(key) ?? []), ...parseFacts(frame.facts, `annotations[${index}].frames[${at}].facts`, tally)]);
      }
    }

    const runSteps: string[] = [];
    for (const [at, stepValue] of arr(run.steps, `run[${index}].steps`, 5000).entries()) {
      const stepWhere = `run[${index}].steps[${at}]`;
      const step = obj(stepValue, stepWhere);
      account(step, ['key', 'title', 'url', 'frames'], tally);
      const key = website ? str(step.url, `${stepWhere}.url`, 2048) : str(step.key, `${stepWhere}.key`);
      if (!runSteps.includes(key)) runSteps.push(key);
      let known = steps.get(key);
      if (known === undefined) {
        known = { title: str(step.title, `${stepWhere}.title`) };
        steps.set(key, known);
        stepOrder.push(key);
        buckets.set(key, new CaptureBucket(tally));
      }
      const bucket = buckets.get(key)!;
      for (const [position, frame] of (step.frames === undefined ? [] : arr(step.frames, `${stepWhere}.frames`, 2000)).entries()) {
        const parsed = await parseCapture(frame, `${stepWhere}.frames[${position}]`, context, annotated.get(`${key}\u0000${position}`) ?? []);
        if (parsed !== null) bucket.add(parsed.merge, { ...parsed.candidate, ...(parsed.candidate.anchors === undefined ? {} : { anchors: dedupeFacts(parsed.candidate.anchors, tally) }) });
      }
    }
    if (!website) flows.push({ key: runId, title: optionalStr(run.title, `run[${index}].title`) ?? runId, steps: runSteps });
    tally.add('runs-read');
  }

  const trees: GraphTreeCandidate[] = [];
  if (website) {
    const pages: WebsitePageCandidate[] = stepOrder.map((key): WebsitePageCandidate => ({ url: key, title: steps.get(key)!.title, captures: buckets.get(key)!.list() }));
    const tree: WebsiteTreeCandidate = { kind: 'website', origin: str(subject.origin, 'study.subject.origin', 2048), title, pages };
    trees.push(tree);
  } else {
    const screens: AppScreenCandidate[] = stepOrder.map((key): AppScreenCandidate => ({ key, title: steps.get(key)!.title, captures: buckets.get(key)!.list() }));
    const tree: AppTreeCandidate = {
      kind: 'app', platform: str(subject.platform, 'study.subject.platform', 20), appId: str(subject.appId, 'study.subject.appId', 200),
      title: str(subject.name, 'study.subject.name'), screens, flows,
    };
    trees.push(tree);
  }

  const recheck = async (): Promise<void> => { await session.assertUnchanged(); };
  await recheck();
  return { trees: stepOrder.length === 0 ? [] : trees, tally, recheck, filesRead: session.filesRead, bytesRead: session.bytesRead };
}
