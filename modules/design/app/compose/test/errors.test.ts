import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBridgeWorkspaceDocuments, DesignBridgeConflictError, DesignBridgeError, bridgeResultValue } from '../bridge-documents.ts';
import {
  attemptDesign, classifyDesignError, DESIGN_FAILURE_KINDS, designFailure, designFeedback, DesignOperationError, isDesignFailure,
  toDesignOperationError, type DesignFailureContext,
} from '../errors.ts';
import { StorageConflictError } from '../../../projects/src/contract.ts';
import { ReadOnlyContentError } from '../../../projects/src/repository.ts';
import { ContentError } from '../../../projects/src/content.ts';
import { IntegrityError } from '../../../components/src/workspace/library.ts';
import { TasteProjectBindingError, TasteUnavailableError } from '../../../taste/src/project-service.ts';
import { SourceUnavailableError } from '../../../discovery/src/contract.ts';
import { PreviewError } from '../../../discovery/src/previews.ts';
import { OutcomeUnknownError, StaleDraftError, FreezeConflictError } from '../../../requests/src/store.ts';
import { StoredSchemaError } from '../../../imports/src/importer.ts';
import { InvalidIdError as ImportsInvalidIdError, StorageConflictError as ImportsConflictError } from '../../../imports/src/contract.ts';
import { CanonicalizationError as TasteCanonicalizationError } from '../../../taste/src/jcs.ts';
import { CanvasWriteConflictError } from '../../storage/index.ts';
import { createTransportDouble } from './bridge-double.ts';

const write: DesignFailureContext = { section: 'projects', operation: 'projects.save', action: 'save the project', write: true };
const read: DesignFailureContext = { section: 'projects', operation: 'projects.load', action: 'load the project' };

describe('classifyDesignError', () => {
  it('maps every known section error to its kind without importing sections into the contract', () => {
    const cases: readonly [unknown, string][] = [
      [new DesignBridgeConflictError(), 'conflict'],
      [new StorageConflictError('design/projects/x'), 'conflict'],
      [new ImportsConflictError('stale plan'), 'conflict'],
      [new CanvasWriteConflictError('revision-changed', 'changed'), 'conflict'],
      [new FreezeConflictError(), 'conflict'],
      [new IntegrityError('Revision 3 already exists.', 'exists'), 'conflict'],
      [new IntegrityError('Stored revision number does not match its key.'), 'corrupt'],
      [new ReadOnlyContentError('p' as never, 'future-schema'), 'read-only'],
      [new StoredSchemaError('unsupported-stored-schema', 'newer'), 'read-only'],
      [new StoredSchemaError('corrupt-stored-record', 'damaged'), 'corrupt'],
      [new OutcomeUnknownError('Freeze', new Error('lost')), 'unknown'],
      [new StaleDraftError('stale'), 'stale'],
      [new TasteProjectBindingError(), 'stale'],
      [new TasteUnavailableError(), 'unavailable'],
      [new SourceUnavailableError(), 'unavailable'],
      [new PreviewError('too-large', 'big'), 'too-large'],
      [new PreviewError('aborted', 'stop'), 'cancelled'],
      [new DOMException('stopped', 'AbortError'), 'cancelled'],
      [new ContentError('bad title'), 'invalid'],
      [new ImportsInvalidIdError('ProjectId', ' x'), 'invalid'],
      [new TasteCanonicalizationError('Non-finite number'), 'invalid'],
      [{ name: 'StoreError', code: 'conflict' }, 'conflict'],
    ];
    for (const [error, kind] of cases) assert.equal(classifyDesignError(error, write).kind, kind, String((error as Error).name));
  });

  it('keeps the bridge reason and treats a disabled refusal as a definite no-effect', () => {
    const disabled = classifyDesignError(new DesignBridgeError('unavailable', 'disabled'), write);
    assert.deepEqual([disabled.kind, disabled.outcome, disabled.recovery, disabled.reason], ['disabled', 'no-effect', 'none', 'disabled']);
    for (const kind of ['read-only', 'invalid', 'unavailable', 'unknown'] as const) assert.equal(classifyDesignError(new DesignBridgeError(kind), write).kind, kind);
  });

  it('treats unrecognised write failures as unknown effects and read failures as unavailable', () => {
    const lost = classifyDesignError(new Error('socket hang up'), write);
    assert.deepEqual([lost.kind, lost.outcome, lost.recovery], ['unknown', 'unknown-effect', 'check']);
    const unread = classifyDesignError(new Error('socket hang up'), read);
    assert.deepEqual([unread.kind, unread.outcome, unread.recovery], ['unavailable', 'no-effect', 'retry']);
    assert.equal(classifyDesignError('not an error', read).kind, 'unavailable');
  });

  it('never offers a blind retry for an unknown effect, and only unknown failures carry one', () => {
    for (const kind of DESIGN_FAILURE_KINDS) {
      const failure = designFailure(kind, write);
      assert.equal(failure.outcome === 'unknown-effect', kind === 'unknown', kind);
      if (kind === 'unknown') assert.equal(failure.recovery, 'check');
      assert.ok(failure.message.length > 0 && !failure.message.endsWith('.'), `${kind} title is one short sentence without a full stop`);
    }
  });

  it('passes an existing failure through unchanged and round trips DesignOperationError as JSON', () => {
    const failure = designFailure('conflict', write, { reason: 'revision-changed' });
    const error = new DesignOperationError(failure, new Error('cause'));
    assert.ok(error instanceof Error);
    assert.equal(error.message, failure.message);
    assert.deepEqual(classifyDesignError(error, read), failure);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), failure);
    assert.ok(isDesignFailure(failure));
    assert.equal(isDesignFailure({ ...failure, kind: 'nope' }), false);
    assert.equal(toDesignOperationError(error, read), error);
    const wrapped = toDesignOperationError(new StorageConflictError('k'), write);
    assert.equal(wrapped.kind, 'conflict');
    assert.ok(wrapped.cause instanceof StorageConflictError);
  });
});

describe('designFeedback', () => {
  it('maps failures to the shared toast tones with safe actions only', () => {
    const feedback = (kind: (typeof DESIGN_FAILURE_KINDS)[number]) => designFeedback(designFailure(kind, write));
    assert.deepEqual(feedback('unknown'), {
      tone: 'unknown', title: 'Save the project: result not confirmed', description: 'HQ could not confirm whether this finished. Check before trying again.',
      meta: 'projects.save', inline: 'unknown', action: { kind: 'check', label: 'Check' }, persistent: true,
    });
    assert.deepEqual([feedback('conflict').tone, feedback('conflict').action?.label, feedback('conflict').inline], ['danger', 'Reload', 'failed']);
    assert.deepEqual([feedback('unavailable').tone, feedback('unavailable').action?.label], ['danger', 'Retry']);
    assert.deepEqual([feedback('disabled').tone, feedback('disabled').action, feedback('disabled').persistent], ['info', undefined, false]);
    assert.deepEqual([feedback('read-only').tone, feedback('stale').action?.label], ['warning', 'Choose again']);
    assert.equal(designFeedback(designFailure('disabled', write, { reason: 'disabled' })).meta, 'projects.save · disabled');
  });
});

describe('attemptDesign', () => {
  it('returns typed results instead of throwing', async () => {
    assert.deepEqual(await attemptDesign(async () => 7, read), { ok: true, value: 7 });
    const failed = await attemptDesign(async () => { throw new DesignBridgeConflictError(); }, write);
    assert.equal(failed.ok, false);
    assert.equal(!failed.ok && failed.failure.kind, 'conflict');
  });
});

describe('bridge refusal envelopes', () => {
  it('keeps a closed disabled reason on writes instead of reporting an unknown effect', async () => {
    const double = createTransportDouble();
    const docs = createBridgeWorkspaceDocuments(double.transport);
    double.failWith(() => ({ ok: false, kind: 'unavailable', reason: 'disabled' }));
    await assert.rejects(docs.putDocument('a', { n: 1 }), (error: unknown) => error instanceof DesignBridgeError && error.kind === 'unavailable' && error.reason === 'disabled');
    await assert.rejects(docs.getDocument('a'), (error: unknown) => error instanceof DesignBridgeError && error.reason === 'disabled');
  });

  it('rejects unknown reasons and extra fields as uncertain', () => {
    assert.throws(() => bridgeResultValue({ ok: false, kind: 'unavailable', reason: 'surprise' }, 'unknown'),
      (error: unknown) => error instanceof DesignBridgeError && error.kind === 'unknown' && error.reason === undefined);
    assert.throws(() => bridgeResultValue({ ok: false, kind: 'conflict', extra: 1 }, 'unavailable'),
      (error: unknown) => error instanceof DesignBridgeError && error.kind === 'unavailable');
    assert.throws(() => bridgeResultValue({ ok: false, kind: 'conflict' }, 'unknown'), DesignBridgeConflictError);
    assert.equal(bridgeResultValue({ ok: true, value: 3 }, 'unknown'), 3);
  });
});
