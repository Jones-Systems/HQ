"""Bounded relay storage and data protocol. This module never launches a producer."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid

KIB = 1024
MIB = KIB * KIB
CHUNK = 64 * KIB
DOCUMENT = MIB
NATIVE = 8 * MIB
ORDINARY = 64 * MIB
FILES = 64
RESERVE = 64 * KIB
SAFE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')


def encoded(value):
    data = (json.dumps(value, separators=(',', ':'), sort_keys=True) + '\n').encode()
    if len(data) > DOCUMENT:
        raise ValueError('document limit')
    return data


def private_stat(info, directory=False):
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or
            info.st_uid != os.getuid() or info.st_mode & 0o077 or
            (not directory and info.st_nlink != 1)):
        raise ValueError('private regular evidence required')
    return info.st_dev, info.st_ino


def directory(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('absolute canonical parent required')
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            raise ValueError('unsafe directory chain')
    info = path.lstat()
    if info.st_uid != os.getuid() or info.st_mode & 0o022 or path.resolve() != path:
        raise ValueError('unowned parent')
    return info.st_dev, info.st_ino


def disjoint(*paths):
    values = [Path(p) for p in paths]
    for i, a in enumerate(values):
        for b in values[i + 1:]:
            if a == b or a in b.parents or b in a.parents:
                raise ValueError('evidence, witness and scratch must be disjoint')


def read_file(path, maximum, fact=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        private_stat(before)
        if before.st_size > maximum:
            raise ValueError('file limit')
        digest = hashlib.sha256()
        chunks = []
        count = 0
        while True:
            data = os.read(fd, min(CHUNK, maximum + 1 - count))
            if not data:
                break
            count += len(data)
            if count > maximum:
                raise ValueError('file grew past limit')
            digest.update(data)
            chunks.append(data)
        after, entry = os.fstat(fd), os.lstat(path)
        for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']:
            if getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(entry, key):
                raise ValueError('closed path changed')
        result = {'path': str(path), 'bytes': count, 'sha256': digest.hexdigest()}
        if fact is not None and result != fact:
            raise ValueError('closed hash/path mismatch')
        return b''.join(chunks), result
    finally:
        os.close(fd)


def write_all(fd, data, offset=None):
    view = memoryview(data)
    position = 0
    while position < len(data):
        size = os.write(fd, view[position:]) if offset is None else os.pwrite(fd, view[position:], offset + position)
        if size <= 0:
            raise OSError('write made no progress')
        position += size


def verify_sources(repo, manifest):
    """Verify the pinned complete supplied closure, never stage or repair it."""
    root = Path(repo)
    directory(root)
    files = manifest.get('files')
    if manifest.get('schema') != 'hq-gallery-source/v1' or not isinstance(files, dict) or not 8 <= len(files) <= 512:
        raise ValueError('source manifest')
    required = {'tests/acceptance/runtime.mjs', 'tests/acceptance/evidence.mjs',
                'tests/acceptance/fixtures/host-gallery.mjs', 'tests/acceptance/fixtures/remote-gallery.mjs',
                'tests/acceptance/fixtures/host-gallery-evidence.mjs', 'tests/acceptance/host_gallery_evidence.py',
                'tests/acceptance/qualify-host-gallery.py', 'tools/storage/admission.mjs', 'tools/storage/policy.mjs'}
    if not required <= files.keys():
        raise ValueError('missing source closure')
    # Include every acceptance/storage source, including transitively imported
    # scenario/preview modules, rather than flattening three fixture modules.
    actual = set()
    for base in ['tests/acceptance', 'tools/storage']:
        for entry in (root / base).rglob('*'):
            if entry.suffix in ('.mjs', '.py'):
                actual.add(str(entry.relative_to(root)))
    if set(files) != actual:
        raise ValueError('incomplete or excessive source closure')
    for name, digest in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('source path/hash')
        target = root / relative
        for ancestor in list(target.parents)[:len(relative.parts) - 1]:
            if not stat.S_ISDIR(ancestor.lstat().st_mode):
                raise ValueError('source symlink')
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > DOCUMENT:
            raise ValueError('source file bound')
        with target.open('rb') as stream:
            data = stream.read(DOCUMENT + 1)
        if len(data) > DOCUMENT or target.lstat().st_ino != info.st_ino:
            raise ValueError('source changed during verification')
        value = hashlib.sha256(data).hexdigest()
        if value != digest:
            raise ValueError('source hash mismatch: ' + name)
    return hashlib.sha256(encoded(manifest)).hexdigest()


def validate_admission(plan, facts):
    """Recheck actual receiver custody/capacity; closed Node facts grant no lock."""
    if facts.get('schema') != 'hq-gallery-admission/v1':
        raise ValueError('admission schema')
    snapshot, policy = facts['snapshot'], facts['policy']
    if snapshot['worktree']['path'] != plan['worktree']:
        raise ValueError('admission worktree mismatch')
    directory(plan['worktree'])
    roots = {r['path']: r for r in snapshot['roots']}
    if set(roots) != {plan['parent'], plan['scratchParent']}:
        raise ValueError('admission roots mismatch')
    disjoint(plan['parent'], plan['scratchParent'])
    for root in [snapshot['worktree'], *snapshot['roots']]:
        for anchor in root['anchors']:
            info = os.lstat(anchor['path'])
            if not stat.S_ISDIR(info.st_mode) or f'{info.st_dev}:{info.st_ino}' != anchor['identity']:
                raise ValueError('admission anchor changed')
        directory(root['ancestor'])
        info = os.stat(root['ancestor'])
        measured = os.statvfs(root['ancestor'])
        available = measured.f_bavail * measured.f_frsize
        if (str(info.st_dev) != root['dev'] or measured.f_frsize <= 0 or measured.f_blocks <= 0 or
                available < policy['reserveBytes'] + policy['peakBytes']):
            raise ValueError('unknown/low receiving capacity')
    directory(plan['parent'])
    return policy


class Owner:
    """One process-local relay writer. No reopen, serialization or process control."""
    def __init__(self, plan, run_id, facts, *, validate=validate_admission):
        if not SAFE.fullmatch(run_id):
            raise ValueError('run id')
        self.policy = validate(plan, facts)
        self.parent = Path(plan['parent'])
        self.parent_id = directory(self.parent)
        self.pid = os.getpid()
        self.lock = self.parent / '.hq-storage.lock'
        self.lock_fd = os.open(self.lock, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.lock_id = private_stat(os.fstat(self.lock_fd))
        self.run = self.parent / run_id
        self.closed = False
        self.failure = None
        self.entries = {}
        self.bytes = 0
        self.ceiling = min(ORDINARY - RESERVE, self.policy['evidenceOrdinaryBytes'])
        self.artifact = min(DOCUMENT, self.policy['artifactBytes'])
        self.reserve_fd = None
        try:
            write_all(self.lock_fd, encoded({'pid': self.pid, 'nonce': uuid.uuid4().hex}))
            validate(plan, facts)
            self.run.mkdir(mode=0o700)
            self.run_id = private_stat(self.run.stat(), True)
            self.reserve_fd = os.open(self.run / '.closure.json', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            self.reserve_id = private_stat(os.fstat(self.reserve_fd))
            write_all(self.reserve_fd, encoded({'status': 'incomplete'}).ljust(RESERVE, b' '))
            os.fsync(self.reserve_fd)
        except BaseException:
            if self.reserve_fd is not None:
                os.close(self.reserve_fd)
            self._unlock()
            raise

    def _verify(self):
        if self.pid != os.getpid() or self.closed or directory(self.parent) != self.parent_id:
            raise ValueError('owner lifetime/parent changed')
        if private_stat(self.run.lstat(), True) != self.run_id:
            raise ValueError('run changed')

    def _unlock(self):
        try:
            if directory(self.parent) != self.parent_id or private_stat(self.lock.lstat()) != self.lock_id:
                raise ValueError('lock changed')
            os.unlink(self.lock)
        finally:
            os.close(self.lock_fd)

    def write(self, name, data, *, append=False, stream=False):
        try:
            self._verify()
            if self.failure:
                raise ValueError('writer previously refused')
            if not SAFE.fullmatch(name) or name == '.closure.json' or not isinstance(data, bytes):
                raise ValueError('artifact name/data')
            prior = self.entries.get(name)
            if prior and not append:
                raise ValueError('overwrite refused')
            maximum = min(NATIVE, self.policy['artifactBytes']) if stream else self.artifact
            if (len(data) > CHUNK and stream or (prior['bytes'] if prior else 0) + len(data) > maximum or
                    self.bytes + len(data) > self.ceiling or (prior is None and len(self.entries) >= FILES - 1)):
                raise ValueError('relay byte/file/chunk limit')
            filesystem = os.statvfs(self.run)
            if filesystem.f_bavail * filesystem.f_frsize < self.policy['reserveBytes'] + len(data):
                raise ValueError('live capacity refused')
            self.bytes += len(data)  # No refund after partial writes.
            if prior is None:
                fd = os.open(self.run / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                prior = self.entries[name] = {'fd': fd, 'id': private_stat(os.fstat(fd)), 'bytes': 0}
            if private_stat(os.lstat(self.run / name)) != prior['id'] or private_stat(os.fstat(prior['fd'])) != prior['id']:
                raise ValueError('artifact changed')
            write_all(prior['fd'], data)
            prior['bytes'] += len(data)
            os.fsync(prior['fd'])
        except BaseException as error:
            self.failure = self.failure or str(error)[:160]
            raise

    def document(self, name, value):
        self.write(name, encoded(value))

    def close(self, primary=0):
        if self.closed:
            raise ValueError('owner already closed')
        errors = []
        for entry in self.entries.values():
            try:
                os.close(entry['fd'])
            except OSError as error:
                errors.append(str(error))
        def closure():
            self._verify()
            if private_stat(os.fstat(self.reserve_fd)) != self.reserve_id or os.fstat(self.reserve_fd).st_size != RESERVE:
                raise ValueError('closure reserve changed')
            value = {'schema': 'hq-relay-closure/v1', 'runId': self.run.name,
                     'status': 'incomplete' if self.failure or errors else 'failed' if primary else 'closed',
                     'primary': primary, 'failure': self.failure, 'errors': errors[:8],
                     'ordinaryBytes': self.bytes, 'ordinaryFiles': len(self.entries), 'ownerExit': 'unobserved'}
            data = encoded(value)
            if len(data) > RESERVE:
                raise ValueError('closure diagnostic limit')
            write_all(self.reserve_fd, data.ljust(RESERVE, b' '), 0)
            os.fsync(self.reserve_fd)
        try:
            closure()
        except BaseException as error:
            errors.append(str(error)[:160])
        try:
            self._unlock()
        except BaseException as error:
            errors.append(str(error)[:160])
        try:
            closure()
        except BaseException as error:
            errors.append(str(error)[:160])
        try:
            os.close(self.reserve_fd)
        except OSError as error:
            errors.append(str(error)[:160])
        self.closed = True
        if errors:
            raise RuntimeError('close/unlock failed: ' + repr(errors))
        return {'run': str(self.run), 'primary': primary, 'incomplete': bool(self.failure)}


class NativeSink:
    """Bound at the producer pipe, before the first disk sink or queued write."""
    def __init__(self, write):
        self.write = write
        self.bytes = 0
        self.line = bytearray()
        self.evidence = None

    def feed(self, chunk):
        if not isinstance(chunk, bytes) or len(chunk) > CHUNK or self.bytes + len(chunk) > NATIVE:
            raise ValueError('native output limit')
        # Parse before admitting this chunk to disk. An oversized partial control
        # line never accumulates an unbounded in-memory buffer.
        for fragment in chunk.splitlines(keepends=True):
            if len(self.line) + len(fragment) > CHUNK:
                raise ValueError('native line limit')
            self.line.extend(fragment)
            if fragment.endswith(b'\n'):
                if self.line.startswith(b'Evidence: '):
                    if self.evidence is not None:
                        raise ValueError('duplicate evidence control')
                    self.evidence = bytes(self.line[len(b'Evidence: '):]).decode().strip()
                self.line.clear()
        self.write(chunk)
        self.bytes += len(chunk)

    def finish(self):
        if self.line:
            raise ValueError('truncated native control line')
        if not self.evidence:
            raise ValueError('missing native evidence')
        return self.evidence


class Frames:
    """Finite typed data slots, segmented one frame/ack at a time. No commands."""
    def __init__(self, qualification, slots):
        self.qualification = qualification
        self.slots = list(slots)
        self.index = 0
        self.part = 0
        self.data = bytearray()
        self.sequence = 0
        self.metadata = None

    def accept(self, frame):
        if len(encoded(frame)) > CHUNK or set(frame) != {'qualification', 'sequence', 'slot', 'part', 'length', 'sha256', 'data', 'last'}:
            raise ValueError('frame shape/size')
        if (type(frame['sequence']) is not int or type(frame['part']) is not int or
                not isinstance(frame['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', frame['sha256']) or
                frame['qualification'] != self.qualification or frame['sequence'] != self.sequence or
                self.index >= len(self.slots) or frame['slot'] != self.slots[self.index] or frame['part'] != self.part):
            raise ValueError('frame identity/order')
        if type(frame['length']) is not int or not 0 <= frame['length'] <= DOCUMENT or type(frame['last']) is not bool:
            raise ValueError('frame length')
        meta = (frame['length'], frame['sha256'])
        if self.metadata is not None and self.metadata != meta:
            raise ValueError('frame metadata changed')
        self.metadata = meta
        import base64
        chunk = base64.b64decode(frame['data'], validate=True)
        if len(self.data) + len(chunk) > frame['length']:
            raise ValueError('document overflow')
        self.data.extend(chunk)
        self.sequence += 1
        self.part += 1
        if not frame['last']:
            return None
        if len(self.data) != frame['length'] or hashlib.sha256(self.data).hexdigest() != frame['sha256']:
            raise ValueError('document digest/length')
        result = (frame['slot'], json.loads(self.data))
        self.index += 1
        self.part = 0
        self.data.clear()
        self.metadata = None
        return result

    def finish(self):
        if self.index != len(self.slots) or self.data:
            raise ValueError('truncated protocol')


def frames(qualification, slot, value, sequence):
    import base64
    data = encoded(value)
    digest = hashlib.sha256(data).hexdigest()
    for part, offset in enumerate(range(0, len(data), 32 * KIB)):
        chunk = data[offset:offset + 32 * KIB]
        frame = {'qualification': qualification, 'sequence': sequence, 'slot': slot,
                 'part': part, 'length': len(data), 'sha256': digest,
                 'data': base64.b64encode(chunk).decode(), 'last': offset + len(chunk) == len(data)}
        yield frame
        sequence += 1


class Witness:
    """One exclusive local prepaid slot; it observes the receiver, never itself."""
    def __init__(self, parent, qualification, admit):
        if not SAFE.fullmatch(qualification):
            raise ValueError('qualification id')
        admit()  # Actual local admission before allocation, not a remote promise.
        self.parent = Path(parent)
        self.parent_id = directory(self.parent)
        self.path = self.parent / (qualification + '.terminal.json')
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.identity = private_stat(os.fstat(self.fd))
        self.done = False
        try:
            write_all(self.fd, encoded({'status': 'incomplete', 'qualification': qualification}).ljust(RESERVE, b' '))
            os.fsync(self.fd)
        except BaseException:
            os.close(self.fd)
            raise

    def finish(self, value):
        if self.done:
            raise ValueError('witness already filled')
        try:
            if directory(self.parent) != self.parent_id or private_stat(os.lstat(self.path)) != self.identity:
                raise ValueError('witness changed')
            data = encoded(value)
            if len(data) > RESERVE or os.fstat(self.fd).st_size != RESERVE:
                raise ValueError('witness reserve limit')
            write_all(self.fd, data.ljust(RESERVE, b' '), 0)
            os.fsync(self.fd)
        finally:
            self.done = True
            os.close(self.fd)
        data, _ = read_file(self.path, RESERVE)
        if json.loads(data) != value or private_stat(os.lstat(self.path)) != self.identity:
            raise ValueError('witness readback mismatch')
        return str(self.path)


def validate_bundle(bundle, *, parent, qualification, source, run=None, owner=None):
    if bundle.get('qualification') != qualification or bundle.get('source') != source:
        raise ValueError('bundle identity')
    target = Path(bundle['run'])
    if target.parent != Path(parent) or run is not None and str(target) != run:
        raise ValueError('bundle run containment')
    directory(parent)
    private_stat(target.lstat(), True)
    values = {}
    for key, name, maximum in [('report', 'relay-report.json', DOCUMENT), ('closure', '.closure.json', RESERVE)]:
        fact = bundle[key]
        if fact['path'] != str(target / name):
            raise ValueError('bundle path')
        data, _ = read_file(fact['path'], maximum, fact)
        values[key] = json.loads(data)
    if values['report']['ownerExit'] != 'unobserved' or values['closure']['ownerExit'] != 'unobserved':
        raise ValueError('future owner-exit assertion')
    if values['closure']['runId'] != target.name or owner is not None and values['report'].get('owner') != owner:
        raise ValueError('closed owner/run mismatch')
    for key in ['qualification', 'source']:
        if values['report'][key] != bundle[key]:
            raise ValueError('report binding')
    return values


def padded_json_fact(path, maximum, fact=None):
    """Hash a physically padded reserve incrementally; bound the JSON document too."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        private_stat(info)
        if info.st_size > maximum:
            raise ValueError('physical closure limit')
        count, document, padding = 0, bytearray(), False
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, CHUNK)
            if not chunk:
                break
            count += len(chunk)
            if count > maximum:
                raise ValueError('closure grew')
            digest.update(chunk)
            if padding:
                if chunk.strip():
                    raise ValueError('closure trailing data')
            else:
                document.extend(chunk)
                # Receipts are one JSON line followed only by padding spaces.
                if b'\n' in document:
                    line, tail = document.split(b'\n', 1)
                    if tail.strip():
                        raise ValueError('closure trailing data')
                    document = bytearray(line)
                    padding = True
                if len(document) > DOCUMENT:
                    raise ValueError('closure document limit')
        after, entry = os.fstat(fd), os.lstat(path)
        for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']:
            if getattr(info, key) != getattr(after, key) or getattr(info, key) != getattr(entry, key):
                raise ValueError('closure changed')
        observed = {'path': str(path), 'bytes': count, 'sha256': digest.hexdigest()}
        if fact is not None and observed != fact:
            raise ValueError('closure path/hash mismatch')
        return json.loads(document), observed
    finally:
        os.close(fd)


def validate_node_bundle(bundle, parent, head):
    if bundle.get('schema') != 'hq-gallery-closed/v1' or bundle.get('parent') != parent or bundle.get('source') != head:
        raise ValueError('Node bundle identity')
    if not SAFE.fullmatch(bundle.get('runId', '')):
        raise ValueError('Node run id')
    target = Path(parent) / bundle['runId']
    directory(parent)
    private_stat(target.lstat(), True)
    if bundle['report']['path'] != str(target / 'report.json') or bundle['closure']['path'] != str(target / '.closure.json'):
        raise ValueError('Node bundle path')
    data, _ = read_file(target / 'report.json', DOCUMENT, bundle['report'])
    report = json.loads(data)
    closure, _ = padded_json_fact(target / '.closure.json', 8 * MIB, bundle['closure'])
    if (report['runId'] != bundle['runId'] or report['source'] != head or closure['format'] != 'hq.evidence-closure/v1' or
            closure['status'] != 'complete' or bundle['result']['incomplete'] or bundle['result']['code']):
        raise ValueError('Node evidence incomplete')
    if not report.get('cleanup', {}).get('rootAbsent') or report['cleanup']['remainingChildren']:
        raise ValueError('Node fixture cleanup incomplete')
    return {'bundle': bundle, 'identity': {key: report[key] for key in ['runId', 'host', 'pid', 'pgid']},
            'cleanup': report['cleanup'], 'digests': report['finalDigests']}
