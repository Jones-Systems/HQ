"""Synthetic extension boundaries; no real providers or credentials. Uses cleanup-owned support scratch."""
import hashlib
import json
from unittest import mock
from support import ServiceTestCase, ROOT


class Extensions(ServiceTestCase):
    service_options = {'start_runs': False}

    def test_authored_extension_exchanges(self):
        artifact = json.loads((ROOT / 'contract/extension-exchanges.json').read_text())
        for exchange in artifact['exchanges']:
            reply = self.harness.request(exchange['method'], exchange['path'], exchange['body'])
            self.assertEqual(reply.status, exchange['status'])
            self.assertEqual(reply.json, exchange['response'])

    def test_publishing_off_is_not_advertised_and_all_routes_are_404(self):
        workspace = self.get('/api/workspace').json
        self.assertNotIn('hq-publishing-simulator-v1', workspace['features'])
        self.assertNotIn('publishing', workspace)
        for path in ('connections', 'connections/a/disconnect', 'requests', 'requests/a/approve', 'requests/a/cancel'):
            self.assertEqual(self.post('/api/publishing/' + path, {}, token=False).status, 404)
            self.assertEqual(self.get('/api/publishing/' + path).status, 404)

    def test_brand_project_is_idempotent_and_validates_utf16_and_strict_keys(self):
        for project in ('project-example', None, '😀' * 80):
            for _ in range(2):
                reply = self.post('/api/brands/default/project', {'project_id': project})
                self.assertEqual(reply.status, 200)
                self.assertEqual(reply.json['project_id'], project)
        for project in (' x', 'x ', 'x\n', '😀' * 81, 42):
            self.assertEqual(self.post('/api/brands/default/project', {'project_id': project}).status, 400)
        self.assertEqual(self.post('/api/brands/missing/project', {'project_id': None}).status, 404)
        self.assertEqual(self.post('/api/brands/default/project', {'project_id': None, 'extra': 1}).status, 400)

    def save_source(self):
        body = dict(name='Synthetic feed', kind='feed-items', file_name='feed.json', text='[ {"title":"Example"} ]', as_of='2020-01-01')
        reply = self.post('/api/sources', body)
        self.assertEqual(reply.status, 201, reply.body)
        return body, reply.json

    def test_sources_provenance_duplicate_archive_run_association_and_restart(self):
        body, source = self.save_source()
        self.assertEqual(source['sha256'], hashlib.sha256(body['text'].encode()).hexdigest())
        self.assertNotIn('content', source)
        self.assertEqual(source['status'], 'stale')
        self.assertEqual(self.post('/api/sources', body).status, 409)
        self.assertEqual(self.get('/api/sources/' + source['id']).json['content'], [{'title': 'Example'}])
        run = self.post('/api/runs', dict(tool='x-studio', input={}, source_ids=[source['id']])).json
        self.assertEqual(run['source_ids'], [source['id']])
        self.assertEqual(self.get('/api/workspace').json['sources'][0]['used_by_runs'], [run['id']])
        self.assertEqual(self.post('/api/sources/' + source['id'] + '/archive', {'archived': 1}).status, 200)
        self.assertEqual(self.post('/api/runs', dict(tool='x-studio', input={}, source_ids=[source['id']])).status, 400)
        self.restart()
        self.assertEqual(self.get('/api/sources/' + source['id']).json['archived'], 1)

    def test_source_parse_shape_filename_and_unknown_keys_reject_without_persistence(self):
        base = dict(name='Example', kind='feed-items', file_name='feed.json', text='[]', as_of='')
        for patch in ({'text': '{'}, {'text': '{}'}, {'kind': 'network'}, {'file_name': '../feed.json'}, {'extra': True}):
            self.assertEqual(self.post('/api/sources', {**base, **patch}).status, 400)
        self.assertEqual(self.get('/api/workspace').json['sources'], [])
        self.assertEqual(self.post('/api/sources', {**base, 'kind': 'search-answers', 'text': '{}\n{}'}).json['records'], 2)


class Publishing(ServiceTestCase):
    service_options = {'start_runs': False, 'publishing': 'simulator'}

    def request(self):
        draft = self.harness.save(title='Synthetic', body='Example only', channel='X')
        connection = self.post('/api/publishing/connections', dict(channel='X', label='Simulated example')).json
        reply = self.post('/api/publishing/requests', dict(draft_id=draft['id'], draft_version=draft['version'], connection_id=connection['id']))
        self.assertEqual(reply.status, 201, reply.body)
        return draft, reply.json

    def test_exact_hash_approval_is_one_shot_and_survives_restart(self):
        _, request = self.request()
        path = '/api/publishing/requests/' + request['id'] + '/approve'
        self.assertEqual(self.post(path, {'content_sha256': 'wrong'}).status, 409)
        reply = self.post(path, {'content_sha256': request['content_sha256']})
        self.assertEqual(reply.status, 200, reply.body)
        self.assertTrue(reply.json['receipt']['simulated'])
        self.assertEqual(self.post(path, {'content_sha256': request['content_sha256']}).status, 409)
        self.restart(publishing='simulator')
        self.assertEqual(self.post(path, {'content_sha256': request['content_sha256']}).status, 409)
        lines = (self.data / 'publishing/outbox.jsonl').read_text().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(json.loads(lines[0])['receipt']['simulated'])

    def test_draft_edit_invalidates_and_cancel_never_delivers(self):
        draft, request = self.request()
        self.harness.save(**{k: v for k, v in draft.items() if k != 'updated_at'})
        self.assertEqual(self.post('/api/publishing/requests/' + request['id'] + '/approve', {'content_sha256': request['content_sha256']}).status, 409)
        self.assertEqual(self.get('/api/workspace').json['publishing']['requests'][0]['status'], 'invalidated')
        _, request = self.request()
        self.assertEqual(self.post('/api/publishing/requests/' + request['id'] + '/cancel', {}).status, 200)
        self.assertFalse((self.data / 'publishing/outbox.jsonl').exists())

    def test_outbox_failure_is_not_replayed(self):
        _, request = self.request()
        path = '/api/publishing/requests/' + request['id'] + '/approve'
        with mock.patch('social_service.extensions.os.fsync', side_effect=OSError('synthetic disk failure')):
            self.assertEqual(self.post(path, {'content_sha256': request['content_sha256']}).status, 500)
        self.assertEqual(self.post(path, {'content_sha256': request['content_sha256']}).status, 409)


class SourceShapes(ServiceTestCase):
    service_options = {'start_runs': False}

    def test_all_closed_kinds_accept_their_top_level_shape(self):
        shapes = {'feed-items': [], 'tiktok-niche': {}, 'tiktok-manifest': {}, 'tiktok-records': [],
                  'seo-config': {}, 'seo-packet': {}, 'search-panel': {'queries': []},
                  'search-entities': [], 'search-inventory': [], 'search-answers': [],
                  'reddit-bundle': {'posts': []}, 'creator-batch': {'creators': []}}
        for kind, value in shapes.items():
            with self.subTest(kind=kind):
                reply = self.post('/api/sources', dict(name='Example', kind=kind, file_name='example.json',
                                                      text=json.dumps(value), as_of=''))
                self.assertEqual(reply.status, 201, reply.body)
                self.assertEqual(reply.json['records'], 1 if kind in ('tiktok-niche', 'tiktok-manifest', 'seo-config', 'seo-packet') else 0)

    def test_invalid_source_dates_and_json_lines_leave_no_rows(self):
        base = dict(name='Example', kind='search-answers', file_name='answers.jsonl', text='{}\n{', as_of='')
        reply = self.post('/api/sources', base)
        self.assertEqual(reply.status, 400)
        self.assertIn('line 2, column 2', reply.error)
        self.assertEqual(self.post('/api/sources', dict(base, text='[]', as_of='2026-02-30')).status, 400)
        self.assertEqual(self.get('/api/workspace').json['sources'], [])
