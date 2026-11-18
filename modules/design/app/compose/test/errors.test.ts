import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBridgeWorkspaceDocuments, DesignBridgeConflictError, DesignBridgeError, bridgeResultValue } from '../bridge-documents.ts';
import {
  attemptDesign, classifyDesignError, DESIGN_FAILURE_KINDS, designFailure, designFeedback, designOperation, DesignOperationError, isDesignFailure,
  toDesignOperationError, type DesignFailure, type DesignFailureContext,
} from '../errors.ts';
import { StorageConflictError } from '../../../projects/src/contract.ts';
import { ReadOnlyContentError } from '../../../projects/src/repository.ts';
import { ContentError, VersionMutationError } from '../../../projects/src/content.ts';
import { IntegrityError } from '../../../components/src/workspace/library.ts';
import { TasteProjectBindingError, TasteUnavailableError } from '../../../taste/src/project-service.ts';
import { SourceUnavailableError } from '../../../discovery/src/contract.ts';
import { PreviewError } from '../../../discovery/src/previews.ts';
import {
  FreezeBlockedError, FreezeConflictError, OutcomeUnknownError, ReadOnlyRequestError, SendBlockedError, StaleDraftError,
} from '../../../requests/src/store.ts';
import { UnsupportedSchemaError, ValidationError } from '../../../requests/src/validate.ts';
import { StoredSchemaError } from '../../../imports/src/importer.ts';
import { InvalidIdError as ImportsInvalidIdError, StorageConflictError as ImportsConflictError } from '../../../imports/src/contract.ts';
import { CanonicalizationError as TasteCanonicalizationError } from '../../../taste/src/jcs.ts';
import { DispatchTransitionError } from '../../../connector/src/dispatch.ts';
import { CanvasWriteConflictError } from '../../storage/index.ts';
import { SectionStorageScopeError } from '../../storage/section-documents.ts';
import { ExportDisabledError, ExportProjectionError } from '../../storage/export.ts';
import { NamespaceClassError } from '../../storage/backing.ts';
import { OutboxRecordError } from '../../storage/outbox.ts';
import { createTransportDouble } from './bridge-double.ts';

const write: DesignFailureContext = { section: 'projects', operation: 'projects.save', action: 'save the project', write: true };
const read: DesignFailureContext = { section: 'projects', operation: 'projects.load', action: 'load the project', write: false };

/** Every section error the views can receive, with the kind it must classify as during a write. */
const CASES: readonly (readonly [string, unknown, string])[] = [
  ['bridge conflict', new DesignBridgeConflictError(), 'conflict'],
  ['projects storage conflict', new StorageConflictError('design/projects/x'), 'conflict'],
  ['imports storage conflict', new ImportsConflictError('stale plan'), 'conflict'],
  ['canvas conflict (name wins over its reason)', new CanvasWriteConflictError('revision-changed', 'changed'), 'conflict'],
  ['freeze conflict', new FreezeConflictError(), 'conflict'],
  ['component revision exists', new IntegrityError('Revision 3 already exists.', 'exists'), 'conflict'],
  ['store error code', { name: 'StoreError', code: 'conflict' }, 'conflict'],
  ['component integrity mismatch', new IntegrityError('Stored revision number does not match its key.'), 'corrupt'],
  ['read-only project content', new ReadOnlyContentError('p' as never, 'invalid'), 'read-only'],
  ['read-only request', new ReadOnlyRequestError('future schema'), 'read-only'],
  ['newer imports record', new StoredSchemaError('unsupported-stored-schema', 'newer'), 'read-only'],
  ['newer request schema', new UnsupportedSchemaError('hq.design.request/v9'), 'read-only'],
  ['damaged imports record', new StoredSchemaError('corrupt-stored-record', 'damaged'), 'corrupt'],
  ['request outcome unknown', new OutcomeUnknownError('Freeze', new Error('lost')), 'unknown'],
  ['stale draft', new StaleDraftError('stale'), 'stale'],
  ['taste project binding', new TasteProjectBindingError(), 'stale'],
  ['taste storage', new TasteUnavailableError(), 'unavailable'],
  ['discovery source offline', new SourceUnavailableError(), 'unavailable'],
  ['preview too large', new PreviewError('too-large', 'big'), 'too-large'],
  ['preview aborted', new PreviewError('aborted', 'stop'), 'cancelled'],
  ['content', new ContentError('bad title'), 'invalid'],
  ['version mutation (subclass name wins)', new VersionMutationError('v1', 'frozen'), 'invalid'],
  ['request validation', new ValidationError('title', 'required'), 'invalid'],
  ['imports id', new ImportsInvalidIdError('ProjectId', ' x'), 'invalid'],
  ['taste canonicalization', new TasteCanonicalizationError('Non-finite number'), 'invalid'],
  ['section scope', new SectionStorageScopeError('outside the root'), 'invalid'],
  ['dispatch transition', new DispatchTransitionError('Illegal attempt transition'), 'invalid'],
  ['namespace class', new NamespaceClassError('A workspace view is required'), 'invalid'],
  ['outbox record', new OutboxRecordError('dispatchId must be a non-empty string'), 'invalid'],
  ['send blocked', new SendBlockedError(['Only the current packet can be sent.']), 'invalid'],
  ['freeze blocked', new FreezeBlockedError(['Choose a destination before sending.']), 'invalid'],
  ['export projection refused', new ExportProjectionError('unknown record'), 'invalid'],
  ['export disabled', new ExportDisabledError(), 'disabled'],
  ['bridge disabled', new DesignBridgeError('unavailable', 'disabled'), 'disabled'],
  ['bridge unknown', new DesignBridgeError('unknown'), 'unknown'],
  ['bridge copy from another chunk', { name: 'DesignBridgeError', kind: 'read-only' }, 'read-only'],
  ['abort during a write', new DOMException('stopped', 'AbortError'), 'unknown'],
  ['unrecognised', new Error('socket hang up'), 'unknown'],
  ['not an error', 'nope', 'unknown'],
];

describe('classifyDesignError', () => {
  it('maps every known section error to its kind without importing sections into the contract', () => {
    for (const [label, error, kind] of CASES) assert.equal(classifyDesignError(error, write).kind, kind, label);
  });

  it('never offers a blind retry when a write may have happened, for any classified failure', () => {
    for (const context of [write, read]) {
      for (const [label, error] of CASES) {
        const failure = classifyDesignError(error, context);
        const feedback = designFeedback(failure);
        assert.equal(failure.outcome === 'unknown-effect', failure.kind === 'unknown', label);
        if (failure.outcome === 'unknown-effect') {
          assert.deepEqual([failure.recovery, feedback.action?.kind, feedback.inline, feedback.tone], ['check', 'check', 'unknown', 'unknown'], label);
        }
        if (feedback.action?.kind === 'retry') assert.equal(failure.outcome, 'no-effect', label);
        assert.ok(isDesignFailure(failure), label);
      }
    }
  });

  it('keeps the bridge reason and treats a disabled refusal as a definite no-effect on reads and writes', () => {
    for (const context of [write, read]) {
      const disabled = classifyDesignError(new DesignBridgeError('unavailable', 'disabled'), context);
      assert.deepEqual([disabled.kind, disabled.outcome, disabled.recovery, disabled.reason], ['disabled', 'no-effect', 'none', 'disabled']);
    }
    for (const kind of ['read-only', 'invalid', 'unavailable', 'unknown'] as const) assert.equal(classifyDesignError(new DesignBridgeError(kind), write).kind, kind);
    // A disabled reason on any other kind cannot be produced by the bridge and is not trusted.
    assert.equal(classifyDesignError(new DesignBridgeError('unknown', 'disabled'), write).kind, 'unknown');
  });

  it('treats unrecognised write failures as unknown effects and read failures as unavailable', () => {
    const lost = classifyDesignError(new Error('socket hang up'), write);
    assert.deepEqual([lost.kind, lost.outcome, lost.recovery], ['unknown', 'unknown-effect', 'check']);
    const unread = classifyDesignError(new Error('socket hang up'), read);
    assert.deepEqual([unread.kind, unread.outcome, unread.recovery], ['unavailable', 'no-effect', 'retry']);
    assert.equal(classifyDesignError('not an error', read).kind, 'unavailable');
  });

  it('reports a cancelled read as stopped and an aborted write as unconfirmed', () => {
    const abort = new DOMException('stopped', 'AbortError');
    assert.deepEqual([classifyDesignError(abort, read).kind, classifyDesignError(abort, read).outcome], ['cancelled', 'no-effect']);
    assert.equal(classifyDesignError(abort, write).kind, 'unknown');
    assert.equal(classifyDesignError(new PreviewError('aborted', 'stop'), read).kind, 'cancelled');
  });

  it('shows the reasons a blocked send or freeze already gives the owner', () => {
    const send = { section: 'requests', operation: 'requests.send', action: 'send the request', write: true } as const;
    const blocked = classifyDesignError(new SendBlockedError(['Already handed off. A send is single-use; check its status instead.']), send);
    assert.deepEqual([blocked.kind, blocked.outcome, blocked.reason, blocked.description],
      ['invalid', 'no-effect', 'blocked', 'Already handed off. A send is single-use; check its status instead.']);
    assert.equal(classifyDesignError(new FreezeBlockedError([]), send).description, 'HQ refused the request because some details are not valid. Nothing was changed.');
  });

  it('says read-only data was saved by a newer HQ only when that is the reason', () => {
    assert.equal(classifyDesignError(new ReadOnlyContentError('p' as never, 'invalid'), write).description, 'It is open read-only here, so nothing was changed.');
    for (const error of [new StoredSchemaError('unsupported-stored-schema', 'newer'), new UnsupportedSchemaError('hq.design.request/v9')]) {
      assert.equal(classifyDesignError(error, write).description, 'It was saved by a newer version of HQ, so it opens read-only. Nothing was changed.');
    }
  });

  it('gives each kind a short title and the standard outcome', () => {
    for (const kind of DESIGN_FAILURE_KINDS) {
      const failure = designFailure(kind, write);
      assert.equal(failure.outcome === 'unknown-effect', kind === 'unknown', kind);
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

  it('refuses inconsistent hand-built failures and keeps any claimed effect unconfirmed', () => {
    const unknown = designFailure('unknown', write);
    const retrying = { ...unknown, recovery: 'retry' } as const;
    assert.equal(isDesignFailure(retrying), false);
    assert.equal(isDesignFailure({ ...unknown, outcome: 'no-effect' }), false);
    assert.equal(isDesignFailure({ ...designFailure('conflict', write), outcome: 'unknown-effect' }), false);
    assert.equal(isDesignFailure({ ...designFailure('conflict', write), recovery: 'later' }), false);
    // Classified again, even in a read context, a claimed possible effect stays unknown.
    assert.equal(classifyDesignError(retrying, read).kind, 'unknown');
    // Presented directly, a possible effect still only offers Check.
    const feedback = designFeedback(retrying as unknown as DesignFailure);
    assert.deepEqual([feedback.action?.kind, feedback.tone, feedback.inline, feedback.status], ['check', 'unknown', 'unknown', 'Unconfirmed']);
    const mislabelled = designFeedback({ ...designFailure('conflict', write), outcome: 'unknown-effect' } as DesignFailure);
    assert.deepEqual([mislabelled.action?.kind, mislabelled.tone, mislabelled.id], ['check', 'unknown', 'design.projects.save.unknown']);
  });
});

describe('designFeedback', () => {
  it('maps failures to the shared toast tones with safe actions only', () => {
    const feedback = (kind: (typeof DESIGN_FAILURE_KINDS)[number]) => designFeedback(designFailure(kind, write));
    assert.deepEqual(feedback('unknown'), {
      id: 'design.projects.save.unknown', tone: 'unknown', title: 'Save the project: not confirmed yet',
      description: "HQ couldn't confirm whether this finished. Check before trying again.",
      meta: 'projects.save', inline: 'unknown', status: 'Unconfirmed', action: { kind: 'check', label: 'Check' }, persistent: true,
    });
    assert.deepEqual([feedback('conflict').tone, feedback('conflict').action?.label, feedback('conflict').inline], ['danger', 'Reload', 'failed']);
    assert.deepEqual([feedback('unavailable').tone, feedback('unavailable').action?.label], ['danger', 'Retry']);
    assert.deepEqual([feedback('disabled').tone, feedback('disabled').action, feedback('disabled').persistent], ['info', undefined, false]);
    assert.deepEqual([feedback('read-only').tone, feedback('stale').action?.label], ['warning', 'Choose again']);
    assert.equal(designFeedback(designFailure('disabled', write, { reason: 'disabled' })).meta, 'projects.save · disabled');
  });

  it('gives storage outages one shared toast id and every other failure its own', () => {
    const compare: DesignFailureContext = { section: 'compare', operation: 'compare.load', action: 'load the comparison', write: false };
    assert.equal(designFeedback(designFailure('unavailable', read)).id, 'design.storage.unavailable');
    assert.equal(designFeedback(designFailure('unavailable', compare)).id, 'design.storage.unavailable');
    assert.equal(designFeedback(designFailure('conflict', write)).id, 'design.projects.save.conflict');
    assert.equal(designFeedback(designFailure('unknown', compare)).id, 'design.compare.load.unknown');
    assert.deepEqual([designFeedback(designFailure('unavailable', read)).status, designFeedback(designFailure('disabled', write)).status],
      ['Unavailable', 'Off in this build']);
  });

  it('says when a source, not storage, is unreachable', () => {
    const discovery: DesignFailureContext = { section: 'discovery', operation: 'discovery.refresh', action: 'refresh the catalog', write: false };
    const offline = classifyDesignError(new SourceUnavailableError(), discovery);
    assert.deepEqual([offline.kind, offline.reason, offline.description], ['unavailable', 'source-offline', "The source can't be reached right now. Nothing was changed."]);
    assert.equal(designFeedback(offline).id, 'design.discovery.refresh.unavailable');
    // Inherited object keys are not reasons.
    assert.equal(designFailure('unavailable', read, { reason: 'toString' }).description, 'Design storage is unavailable right now. Nothing was changed.');
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

describe('designOperation', () => {
  it('resolves values and rethrows any rejection as a classifiable DesignOperationError with the original as cause', async () => {
    assert.equal(await designOperation(async () => 7, read), 7);
    const original = new StorageConflictError('design/projects/x');
    await assert.rejects(designOperation(async () => { throw original; }, read), (error: unknown) =>
      error instanceof DesignOperationError && error.kind === 'conflict' && error.operation === 'projects.load' && error.cause === original);
    await assert.rejects(designOperation(async () => { throw new Error('lost'); }, write), (error: unknown) =>
      error instanceof DesignOperationError && error.kind === 'unknown' && error.outcome === 'unknown-effect');
    await assert.rejects(designOperation(async () => { throw new Error('lost'); }, read), (error: unknown) =>
      error instanceof DesignOperationError && error.kind === 'unavailable' && error.outcome === 'no-effect');
  });

  it('does not wrap a failure twice', async () => {
    const typed = new DesignOperationError(designFailure('stale', read));
    await assert.rejects(designOperation(async () => { throw typed; }, write), (error: unknown) => error === typed);
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

  it('treats unknown reasons, mismatched pairs and extra fields as uncertain', () => {
    const uncertain = (envelope: unknown, expected: 'unknown' | 'unavailable') => assert.throws(() => bridgeResultValue(envelope, expected),
      (error: unknown) => error instanceof DesignBridgeError && error.kind === expected && error.reason === undefined, JSON.stringify(envelope));
    uncertain({ ok: false, kind: 'unavailable', reason: 'surprise' }, 'unknown');
    uncertain({ ok: false, kind: 'unknown', reason: 'disabled' }, 'unknown');
    uncertain({ ok: false, kind: 'conflict', reason: 'disabled' }, 'unknown');
    uncertain({ ok: false, kind: 'bogus', reason: 'disabled' }, 'unavailable');
    uncertain({ ok: false, kind: 'unavailable', reason: undefined }, 'unknown');
    uncertain({ ok: false, kind: 'conflict', extra: 1 }, 'unavailable');
    assert.throws(() => bridgeResultValue({ ok: false, kind: 'conflict' }, 'unknown'), DesignBridgeConflictError);
    assert.equal(bridgeResultValue({ ok: true, value: 3 }, 'unknown'), 3);
  });
});
