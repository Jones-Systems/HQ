"""Persisted supplied-data extensions and local-only publishing simulator. No network providers."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from .errors import ConflictError, NotFoundError, ValidationError
from .validation import MESSAGES, reject_unknown_fields

BRAND_PROJECT = 'hq-brand-project-v1'
SOURCES = 'hq-sources-v1'
PUBLISHING = 'hq-publishing-simulator-v1'
ACCOUNT_CHANNELS = ('X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit')
SOURCE_SHAPES = {
    'feed-items': None, 'tiktok-niche': {}, 'tiktok-manifest': {}, 'tiktok-records': None,
    'seo-config': {}, 'seo-packet': {}, 'search-panel': 'queries', 'search-entities': None,
    'search-inventory': None, 'search-answers': None, 'reddit-bundle': 'posts', 'creator-batch': 'creators',
}


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-16-le', 'surrogatepass')) // 2 > maximum:
        raise ValidationError(f'{label} must be text, 1–{maximum} characters')
    return value


def date_value(value: Any) -> datetime | None:
    if value == '' or value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError('Use an ISO-8601 as-of date')
    try:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T.+)?', value):
            raise ValueError()
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        raise ValidationError('Use an ISO-8601 as-of date') from None


def parse_source(data: dict[str, Any]) -> tuple[dict[str, Any], Any]:
    reject_unknown_fields(data, ('name', 'kind', 'file_name', 'text', 'as_of'))
    if set(data) != {'name', 'kind', 'file_name', 'text', 'as_of'}:
        raise ValidationError('Source fields are required')
    name = text(data.get('name'), 'Source name', 120)
    filename = text(data.get('file_name'), 'File name', 255)
    if any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in '/\\' for c in filename):
        raise ValidationError('File name must have no path separator or control character')
    kind = data.get('kind')
    if not isinstance(kind, str) or kind not in SOURCE_SHAPES:
        raise ValidationError('Unknown source kind')
    raw = data.get('text')
    if not isinstance(raw, str):
        raise ValidationError('Source text must be 1–1,500,000 UTF-8 bytes')
    try:
        size = len(raw.encode('utf-8'))
    except UnicodeError:
        raise ValidationError('Source text must be valid UTF-8') from None
    if not 1 <= size <= 1_500_000:
        raise ValidationError('Source text must be 1–1,500,000 UTF-8 bytes')
    def reject(value):
        raise ValueError('Non-finite JSON number')
    def load(value):
        result = json.loads(value, parse_constant=reject)
        canonical(result)  # also rejects numeric overflow
        return result
    try:
        try:
            content = load(raw)
        except json.JSONDecodeError:
            if kind != 'search-answers':
                raise
            content = []
            for line_number, line in enumerate(raw.splitlines(), 1):
                if line.strip():
                    try:
                        content.append(load(line))
                    except json.JSONDecodeError as error:
                        raise ValidationError(f'JSON line {line_number}, column {error.colno}: invalid JSON value') from None
    except json.JSONDecodeError as error:
        raise ValidationError(f'JSON line {error.lineno}, column {error.colno}: invalid JSON value') from None
    except (ValueError, RecursionError):
        raise ValidationError('JSON line 1, column 1: invalid JSON value') from None
    shape = SOURCE_SHAPES[kind]
    if shape is None:
        valid = isinstance(content, list)
        records = len(content) if valid else 0
    else:
        valid = isinstance(content, dict)
        if isinstance(shape, str):
            valid = valid and isinstance(content.get(shape), list)
            records = len(content[shape]) if valid else 0
        else:
            records = 1
    if not valid:
        raise ValidationError(f'Source shape does not match {kind}')
    as_of = data['as_of']
    if not isinstance(as_of, str):
        raise ValidationError('Use an ISO-8601 as-of date')
    if as_of == '':
        as_of = content.get('as_of') if isinstance(content, dict) else None
    date_value(as_of)
    return dict(name=name, kind=kind, file_name=filename, sha256=digest(raw), bytes=size,
                records=records, as_of=as_of, archived=0), content


class Extensions:
    def __init__(self, service, publishing: str):
        if publishing not in ('off', 'simulator'):
            raise ValueError('Only off or simulator publishing is supported')
        self.service = service
        self.store = service.store
        self.publishing = publishing
        self.provider = SimulatorProvider(service)

    def rows(self, kind: str) -> list[dict[str, Any]]:
        return self.store.extension_rows(kind)

    def get(self, kind: str, identifier: str) -> dict[str, Any]:
        for row in self.rows(kind):
            if row['id'] == identifier:
                return row
        raise NotFoundError('Source not found' if kind == 'source' else 'Request not found')

    def put(self, kind: str, row: dict[str, Any]):
        self.store.put_extension(kind, row)
        return row

    def metadata(self, row):
        result = {k: v for k, v in row.items() if k != 'content'}
        as_of = date_value(row['as_of'])
        age = max(0, (self.service._clock() - as_of).days) if as_of else None
        result.update(age_days=age, status='stale' if as_of and (self.service._clock() - as_of).total_seconds() > 30 * 86400 else 'valid',
                      used_by_runs=self.store.source_runs(row['id']))
        return result

    def snapshot(self):
        result = {'sources': [self.metadata(r) for r in self.rows('source')[:500]]}
        if self.publishing == 'simulator':
            with self.store._lock:
                requests = self.rows('request')
                for row in requests:
                    draft = self.store.get_draft(row['draft_id'])
                    if row['status'] == 'pending_approval' and (not draft or draft['version'] != row['draft_version']):
                        row.update(status='invalidated', decided_at=self.service.now())
                        self.put('request', row)
                result['publishing'] = dict(mode='simulator', connections=self.rows('connection'), requests=requests[:200])
        return result

    def route(self, method: str, path: str, data: dict[str, Any]):
        parts = path.strip('/').split('/')
        now = self.service.now()
        with self.store._lock:
            if method == 'POST' and len(parts) == 4 and parts[:2] == ['api', 'brands'] and parts[3] == 'project':
                reject_unknown_fields(data, ('project_id',))
                project = data.get('project_id')
                if 'project_id' not in data or (project is not None and (not isinstance(project, str) or
                        not 1 <= len(project.encode('utf-16-le', 'surrogatepass')) // 2 <= 160 or project != project.strip() or
                        any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in project))):
                    raise ValidationError('Project ID must be 1–160 characters with no surrounding spaces')
                return 200, self.store.set_brand_project(parts[2], project)
            if parts[:2] == ['api', 'sources']:
                if method == 'POST' and len(parts) == 2:
                    row, content = parse_source(data)
                    if any(r['kind'] == row['kind'] and r['sha256'] == row['sha256'] for r in self.rows('source')):
                        raise ConflictError('This file is already saved as a source')
                    row.update(id=self.service._new_id(), imported_at=now, content=content)
                    return 201, self.metadata(self.put('source', row))
                if method == 'GET' and len(parts) == 3:
                    row = self.get('source', parts[2])
                    return 200, dict(self.metadata(row), content=row['content'])
                if method == 'POST' and len(parts) == 4 and parts[3] == 'archive':
                    reject_unknown_fields(data, ('archived',))
                    if type(data.get('archived')) is not int or data['archived'] not in (0, 1):
                        raise ValidationError('Invalid archive state')
                    row = self.get('source', parts[2])
                    row['archived'] = data['archived']
                    return 200, self.metadata(self.put('source', row))
            if parts[:2] == ['api', 'publishing'] and self.publishing == 'simulator':
                return self.publish(method, parts[2:], data, now)
        raise NotFoundError('Route not found')

    def publish(self, method, parts, data, now):
        if method != 'POST':
            raise NotFoundError('Route not found')
        if parts == ['connections']:
            reject_unknown_fields(data, ('channel', 'label'))
            if data.get('channel') not in ACCOUNT_CHANNELS:
                raise ValidationError('Choose an account channel')
            label = text(data.get('label'), 'Channel label', 80)
            if len(self.rows('connection')) >= 50:
                raise ConflictError('Connection limit reached')
            row = self.provider.connect(data['channel'], label, now)
            return 201, self.put('connection', row)
        if len(parts) == 3 and parts[0] == 'connections' and parts[2] == 'disconnect':
            reject_unknown_fields(data, ())
            row = self.get('connection', parts[1])
            row.update(status='disconnected', disconnected_at=now)
            return 200, self.put('connection', row)
        if parts == ['requests']:
            reject_unknown_fields(data, ('draft_id', 'draft_version', 'connection_id'))
            if not isinstance(data.get('draft_id'), str) or not isinstance(data.get('connection_id'), str):
                raise ValidationError('Choose a draft and simulated connection')
            draft = self.store.get_draft(data['draft_id'])
            if not draft or type(data.get('draft_version')) is not int or draft['version'] != data['draft_version']:
                raise ConflictError(MESSAGES['conflict'])
            if draft['channel'] not in ACCOUNT_CHANNELS:
                raise ValidationError('Choose a draft for an account channel')
            connection = self.get('connection', data.get('connection_id'))
            if connection['status'] != 'simulated' or connection['channel'] != draft['channel']:
                raise ValidationError('Choose a simulated connection for this channel')
            content = dict(title=draft['title'], body=draft['body'])
            row = dict(id=self.service._new_id(), connection_id=connection['id'], channel=draft['channel'],
                       draft_id=draft['id'], draft_version=draft['version'], content=content,
                       content_sha256=self.provider.prepare(draft['channel'], content),
                       status='pending_approval', created_at=now, decided_at=None, receipt=None)
            return 201, self.put('request', row)
        if len(parts) == 3 and parts[0] == 'requests' and parts[2] in ('approve', 'cancel'):
            approve = parts[2] == 'approve'
            reject_unknown_fields(data, ('content_sha256',) if approve else ())
            row = self.get('request', parts[1])
            if row['status'] != 'pending_approval':
                raise ConflictError('This request is no longer pending')
            if not approve:
                row.update(status='cancelled', decided_at=now)
                return 200, self.put('request', row)
            if data.get('content_sha256') != row['content_sha256']:
                raise ConflictError('The approved content does not match this request')
            draft = self.store.get_draft(row['draft_id'])
            if not draft or draft['version'] != row['draft_version']:
                row.update(status='invalidated', decided_at=now)
                self.put('request', row)
                raise ConflictError('The draft changed after this request; create a new request')
            # Persist non-replayability before touching the outbox. Failure/response loss is never retried.
            row.update(status='failed', decided_at=now)
            self.put('request', row)
            receipt = self.provider.deliver(row, now)
            row.update(status='delivered_simulated', receipt=receipt)
            return 200, self.put('request', row)
        raise NotFoundError('Route not found')


class SimulatorProvider:
    """Provider seam: connect, prepare, deliver and readback. This implementation performs local I/O only."""
    def __init__(self, service):
        self.service = service
        self.store = service.store

    def connect(self, channel, label, now):
        return dict(id=self.service._new_id(), channel=channel, label=label,
                    status='simulated', created_at=now, disconnected_at=None)

    def prepare(self, channel, content):
        return digest(canonical(dict(channel=channel, **content)))

    def deliver(self, row, now):
        directory = self.service.data_dir / 'publishing'
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / 'outbox.jsonl'
        sequence = self.store.next_outbox_sequence()
        receipt = dict(simulated=True, delivered_at=now, outbox_sequence=sequence, readback='simulated')
        payload = (canonical(dict(request_id=row['id'], content=row['content'], channel=row['channel'], receipt=receipt)) + '\n').encode('utf-8')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            view = memoryview(payload)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise OSError('Outbox write incomplete')
                view = view[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        for target in (directory, self.service.data_dir):
            directory_fd = os.open(target, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        return self.readback(receipt, payload)

    def readback(self, receipt, payload):
        path = self.service.data_dir / 'publishing' / 'outbox.jsonl'
        with path.open('rb') as stream:
            stream.seek(-len(payload), os.SEEK_END)
            if stream.read(len(payload)) != payload:
                raise OSError('Simulated outbox readback was not confirmed')
        return dict(receipt, simulated=True, readback='simulated')
