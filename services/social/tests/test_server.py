"""The HTTP surface against a real loopback server: guards in order, routes and the error envelope."""

import contextlib
import http.client
import io
import json
import re
import socket
import threading
import unittest
from unittest import mock

from support import ScratchTestCase, ServiceTestCase, raw_exchange, read_reply

from social_service import server as server_module
from social_service import timebox, tools
from social_service.service import SocialService

HEX32 = re.compile('[0-9a-f]{32}')
UNRECOGNIZED = 'Unrecognized host'
CROSS_ORIGIN = 'Cross-origin request refused'
CROSS_SITE = 'Cross-site request refused'
RELOAD = 'Reload the workspace before saving'
SECURITY = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
}


class ListenerBurst(ScratchTestCase):
    def test_twenty_connections_wait_for_accept_then_all_receive_responses(self):
        service = SocialService(self.new_directory(), start_runs=False)
        self.addCleanup(service.close)
        server = server_module.create_server(service, '127.0.0.1', 0)
        self.addCleanup(server.server_close)
        port = server.server_address[1]

        with contextlib.ExitStack() as cleanup:
            connections = []
            # Do not accept until the entire burst is queued in the real listener.
            for _ in range(20):
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                cleanup.callback(connection.close)
                connection.connect()
                connections.append(connection)

            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
            thread.start()
            try:
                for connection in connections:
                    connection.request('GET', '/api/workspace', headers={'Connection': 'close'})
                replies = [read_reply(connection) for connection in connections]
                self.assertEqual(len(replies), 20)
                self.assertEqual([reply.status for reply in replies], [200] * 20)
                self.assertTrue(all(reply.json['csrf'] == service.token for reply in replies))
            finally:
                server.shutdown()
                thread.join(timeout=5)
            self.assertFalse(thread.is_alive(), 'The burst listener must stop before cleanup')


class Endpoint(ServiceTestCase):
    def assertRefused(self, reply, status, message):
        self.assertEqual((reply.status, reply.json), (status, {'error': message}))

    def post_raw(self, lines, body=b'', *, host=True):
        head = ['POST /api/content HTTP/1.1']
        if host:
            head.append(f'Host: 127.0.0.1:{self.harness.port}')
        head.extend(lines)
        return raw_exchange(self.harness.port, ('\r\n'.join(head) + '\r\n\r\n').encode() + body)

    def good_headers(self):
        return [f'X-Workspace-Token: {self.harness.token}', 'Content-Type: application/json']


class HostGuard(Endpoint):
    def test_the_bound_address_and_loopback_aliases_are_accepted(self):
        port = self.harness.port
        for host in (f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}', f'LOCALHOST:{port}'):
            with self.subTest(host=host):
                self.assertEqual(self.get('/api/workspace', headers={'Host': host}).status, 200)

    def test_anything_else_is_unrecognized(self):
        port = self.harness.port
        for host in ('evil.example', f'evil.example:{port}', '127.0.0.1', 'localhost', f'127.0.0.1:{port + 1}',
                     f'127.0.0.2:{port}', f'0.0.0.0:{port}', ''):
            with self.subTest(host=host):
                self.assertRefused(self.get('/api/workspace', headers={'Host': host}), 403, UNRECOGNIZED)

    def test_a_missing_or_repeated_host_is_refused(self):
        port = self.harness.port
        status, _, body = raw_exchange(port, b'GET /api/workspace HTTP/1.0\r\n\r\n')
        self.assertEqual((status, json.loads(body)), (403, {'error': UNRECOGNIZED}))
        request = (f'GET /api/workspace HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nHost: evil.example\r\n\r\n').encode()
        status, _, body = raw_exchange(port, request)
        self.assertEqual((status, json.loads(body)), (403, {'error': UNRECOGNIZED}))

    def test_every_method_and_route_is_host_guarded(self):
        for method, path in (('GET', '/api/workspace'), ('GET', '/nope'), ('POST', '/api/content'),
                             ('DELETE', '/api/content'), ('POST', '/nope')):
            with self.subTest(method=method, path=path):
                reply = self.harness.request(method, path, {} if method == 'POST' else None,
                                             headers={'Host': 'evil.example'})
                self.assertRefused(reply, 403, UNRECOGNIZED)

    def test_allowed_hosts_extend_the_set(self):
        self.restart(extra_hosts=('Front.Example.test', 'front.example.test:8443'))
        for host in ('front.example.test', 'FRONT.example.test', 'front.example.test:8443'):
            with self.subTest(host=host):
                self.assertEqual(self.get('/api/workspace', headers={'Host': host}).status, 200)
        self.assertRefused(self.get('/api/workspace', headers={'Host': 'front.example.test:9'}), 403, UNRECOGNIZED)


class OriginGuard(Endpoint):
    def origins(self, *forms):
        port = self.harness.port
        return [form.format(port=port) for form in forms]

    def test_same_origin_forms_are_accepted(self):
        for origin in self.origins('http://127.0.0.1:{port}', 'https://127.0.0.1:{port}', 'http://localhost:{port}',
                                   'HTTP://LOCALHOST:{port}', 'http://[::1]:{port}'):
            with self.subTest(origin=origin):
                self.assertEqual(self.get('/api/workspace', headers={'Origin': origin}).status, 200)

    def test_other_origins_are_refused_on_every_method(self):
        for origin in self.origins('https://evil.example', 'http://evil.example:{port}', 'null', '',
                                   'http://127.0.0.1:{port}/', 'http://127.0.0.1:{port}/path', 'ftp://127.0.0.1:{port}',
                                   'file://', 'http://127.0.0.1', '127.0.0.1:{port}', 'http://127.0.0.1:{port} x'):
            for method in ('GET', 'POST'):
                with self.subTest(origin=origin, method=method):
                    reply = self.harness.request(method, '/api/workspace' if method == 'GET' else '/api/brands',
                                                 {'name': 'x'} if method == 'POST' else None,
                                                 headers={'Origin': origin})
                    self.assertRefused(reply, 403, CROSS_ORIGIN)

    def test_an_allowed_host_origin_is_accepted(self):
        self.restart(extra_hosts=('front.example.test',))
        reply = self.get('/api/workspace', headers={'Host': 'front.example.test', 'Origin': 'https://front.example.test'})
        self.assertEqual(reply.status, 200)
        # The origin must name an accepted host, not just any host.
        reply = self.get('/api/workspace', headers={'Host': 'front.example.test', 'Origin': 'https://other.example'})
        self.assertRefused(reply, 403, CROSS_ORIGIN)


class FetchSiteGuard(Endpoint):
    def test_only_cross_site_is_refused(self):
        for value in ('cross-site', 'Cross-Site', ' cross-site '):
            with self.subTest(value=value):
                self.assertRefused(self.get('/api/workspace', headers={'Sec-Fetch-Site': value}), 403, CROSS_SITE)
        for value in ('same-origin', 'same-site', 'none'):
            with self.subTest(value=value):
                self.assertEqual(self.get('/api/workspace', headers={'Sec-Fetch-Site': value}).status, 200)

    def test_the_post_is_refused_the_same_way(self):
        reply = self.post('/api/brands', {'name': 'x'}, headers={'Sec-Fetch-Site': 'cross-site'})
        self.assertRefused(reply, 403, CROSS_SITE)


class GuardOrder(Endpoint):
    def test_host_then_origin_then_fetch_site(self):
        bad = {'Host': 'evil.example', 'Origin': 'https://evil.example', 'Sec-Fetch-Site': 'cross-site'}
        self.assertRefused(self.get('/api/workspace', headers=bad), 403, UNRECOGNIZED)
        del bad['Host']
        self.assertRefused(self.get('/api/workspace', headers=bad), 403, CROSS_ORIGIN)
        del bad['Origin']
        self.assertRefused(self.get('/api/workspace', headers=bad), 403, CROSS_SITE)

    def test_the_request_guards_run_before_method_route_and_token_checks(self):
        headers = {'Origin': 'https://evil.example'}
        self.assertRefused(self.harness.request('DELETE', '/api/content', headers=headers), 403, CROSS_ORIGIN)
        self.assertRefused(self.harness.request('GET', '/nope', headers=headers), 403, CROSS_ORIGIN)
        self.assertRefused(self.post('/api/content', {}, headers=headers, token=False), 403, CROSS_ORIGIN)

    def test_a_post_checks_token_content_type_encoding_length_then_json(self):
        token = f'X-Workspace-Token: {self.harness.token}'
        stages = [
            # Each stage is valid for every guard before the one it names and invalid for all that follow.
            (['X-Workspace-Token: wrong', 'Content-Type: text/plain', 'Transfer-Encoding: chunked', 'Content-Length: 0'],
             b'', 403, RELOAD),
            ([token, 'Content-Type: text/plain', 'Transfer-Encoding: chunked', 'Content-Length: 0'],
             b'', 400, 'JSON required'),
            ([token, 'Content-Type: application/json', 'Transfer-Encoding: chunked', 'Content-Length: 0'],
             b'', 400, 'Transfer encoding not supported'),
            ([token, 'Content-Type: application/json', 'Content-Length: 0'],
             b'', 400, 'Input must be 1–2,000,000 bytes'),
            ([token, 'Content-Type: application/json', 'Content-Length: 4'],
             b'nope', 400, 'JSON object required'),
        ]
        for lines, body, status, message in stages:
            with self.subTest(expect=message):
                code, _, payload = self.post_raw(lines, body)
                self.assertEqual((code, json.loads(payload)), (status, {'error': message}))


class TokenGuard(Endpoint):
    def test_a_post_needs_the_workspace_token(self):
        for token in (None, '', 'wrong', self.harness.token[:-1], self.harness.token + 'x', self.harness.token.upper()):
            with self.subTest(token=token):
                reply = self.post('/api/brands', {'name': 'x'}, token=token if token is not None else False)
                self.assertRefused(reply, 403, RELOAD)
        self.assertEqual(self.get('/api/workspace').json['brands'], [{'id': 'default', 'name': 'My workspace', 'project_id': None}])

    def test_the_workspace_hands_out_the_token_that_works(self):
        token = self.get('/api/workspace').json['csrf']
        self.assertEqual(token, self.service.token)
        self.assertEqual(self.post('/api/brands', {'name': 'x'}, token=token).status, 201)

    def test_the_token_is_per_process_and_url_safe(self):
        first = self.service.token
        self.restart()
        self.assertNotEqual(first, self.service.token)
        self.assertGreaterEqual(len(self.service.token), 32)
        self.assertRefused(self.post('/api/brands', {'name': 'x'}, token=first), 403, RELOAD)
        self.assertRegex(self.service.token, r'^[A-Za-z0-9_-]+$')

    def test_the_comparison_is_constant_time(self):
        with mock.patch.object(server_module.hmac, 'compare_digest', wraps=server_module.hmac.compare_digest) as compare:
            self.post('/api/brands', {'name': 'x'}, token='nope')
        compare.assert_called_once()

    def test_a_non_ascii_token_header_is_a_plain_refusal(self):
        reply = self.post('/api/brands', {'name': 'x'}, headers={'X-Workspace-Token': 'tökén'}, token=False)
        self.assertRefused(reply, 403, RELOAD)

    def test_gets_need_no_token(self):
        self.assertEqual(self.get('/api/workspace').status, 200)
        self.assertEqual(self.get('/api/sample/x-studio').status, 200)


class BodyGuards(Endpoint):
    def test_content_type_must_be_json(self):
        for content_type in (None, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonx',
                             'application/json5', 'multipart/form-data; boundary=x', ''):
            with self.subTest(content_type=content_type):
                lines = [f'X-Workspace-Token: {self.harness.token}', 'Content-Length: 2']
                if content_type is not None:
                    lines.append(f'Content-Type: {content_type}')
                status, _, body = self.post_raw(lines, b'{}')
                self.assertEqual((status, json.loads(body)), (400, {'error': 'JSON required'}))

    def test_json_content_type_variants_are_accepted(self):
        for content_type in ('application/json', 'Application/JSON', 'application/json; charset=utf-8',
                             'application/json;charset=UTF-8'):
            with self.subTest(content_type=content_type):
                reply = self.post('/api/brands', {'name': 'x'}, headers={'Content-Type': content_type})
                self.assertEqual(reply.status, 201)

    def test_transfer_encoding_is_refused_and_the_connection_closed(self):
        lines = self.good_headers() + ['Transfer-Encoding: chunked']
        status, headers, body = self.post_raw(lines, b'2\r\n{}\r\n0\r\n\r\n')
        self.assertEqual((status, json.loads(body)), (400, {'error': 'Transfer encoding not supported'}))
        self.assertEqual(headers['connection'], 'close')
        status, _, body = self.post_raw(self.good_headers() + ['Transfer-Encoding: identity', 'Content-Length: 2'], b'{}')
        self.assertEqual((status, json.loads(body)), (400, {'error': 'Transfer encoding not supported'}))

    def test_content_length_is_required_and_bounded(self):
        message = {'error': 'Input must be 1–2,000,000 bytes'}
        cases = {'absent': [], 'zero': ['Content-Length: 0'], 'text': ['Content-Length: abc'],
                 'negative': ['Content-Length: -5'], 'signed': ['Content-Length: +5'], 'float': ['Content-Length: 1.5'],
                 'over by one': ['Content-Length: 2000001'], 'huge': ['Content-Length: ' + '9' * 40],
                 'repeated': ['Content-Length: 2', 'Content-Length: 2'], 'blank': ['Content-Length: ']}
        for name, extra in cases.items():
            with self.subTest(name):
                status, headers, body = self.post_raw(self.good_headers() + extra, b'')
                self.assertEqual((status, json.loads(body)), (400, message))

    def test_the_largest_allowed_body_passes_the_length_guard(self):
        filler = 'x' * (2_000_000 - len('{"title":"t","body":""}'))
        payload = ('{"title":"t","body":"' + filler + '"}').encode()
        self.assertEqual(len(payload), 2_000_000)
        reply = self.post('/api/content', raw=payload)
        # It is a valid object, so the next failing rule is the draft's own 50,000-character body limit.
        self.assertRefused(reply, 400, 'Body must be text, 0–50000 characters')

    def test_one_byte_over_is_refused_without_reading_the_body(self):
        status, headers, body = self.post_raw(self.good_headers() + ['Content-Length: 2000001'])
        self.assertEqual((status, json.loads(body)), (400, {'error': 'Input must be 1–2,000,000 bytes'}))
        self.assertEqual(headers['connection'], 'close')

    def test_the_body_must_be_a_json_object(self):
        for name, payload in {
            'array': b'[]', 'string': b'"x"', 'number': b'5', 'null': b'null', 'true': b'true', 'empty text': b' ',
            'truncated': b'{"title": ', 'trailing comma': b'{"title": "x",}', 'NaN': b'{"title": NaN}',
            'Infinity': b'{"title": Infinity}', 'bom': b'\xef\xbb\xbf{"title": "x"}', 'latin-1': b'{"title": "\xe9"}',
            'lone byte': b'\xff', 'single quotes': b"{'title': 'x'}", 'deep nesting': b'[' * 100_000 + b']' * 100_000,
        }.items():
            with self.subTest(name):
                self.assertRefused(self.post('/api/content', raw=payload), 400, 'JSON object required')

    def test_a_refused_post_leaves_the_connection_usable(self):
        connection = self.harness.connection()
        self.addCleanup(connection.close)
        big = {'title': 't', 'body': 'x' * 1_500_000}
        reply = self.harness.request('POST', '/api/content', big, token='stale', connection=connection)
        self.assertRefused(reply, 403, RELOAD)
        self.assertEqual(self.harness.request('GET', '/api/workspace', connection=connection).status, 200)
        reply = self.harness.request('POST', '/api/content', {'title': 'x'}, headers={'Content-Type': 'text/plain'},
                                     connection=connection)
        self.assertRefused(reply, 400, 'JSON required')
        self.assertEqual(self.harness.request('GET', '/api/workspace', connection=connection).status, 200)

    def test_a_get_with_a_body_does_not_desynchronize_the_connection(self):
        connection = self.harness.connection()
        self.addCleanup(connection.close)
        self.assertEqual(self.harness.request('GET', '/api/workspace', raw=b'{"ignored": true}', connection=connection).status, 200)
        self.assertEqual(self.harness.request('GET', '/api/sample/x-studio', connection=connection).status, 200)


class Envelope(Endpoint):
    def test_unsupported_methods_get_405_after_the_guards(self):
        for method in ('PUT', 'PATCH', 'DELETE', 'OPTIONS'):
            with self.subTest(method=method):
                reply = self.harness.request(method, '/api/content')
                self.assertRefused(reply, 405, 'Method not allowed')
                self.assertEqual(reply.headers['allow'], 'GET, POST')

    def test_head_gets_405_without_a_body(self):
        reply = self.harness.request('HEAD', '/api/workspace')
        self.assertEqual((reply.status, reply.body), (405, b''))
        self.assertEqual(reply.headers['content-length'], str(len(b'{"error":"Method not allowed"}')))

    def test_a_method_http_server_does_not_know_still_gets_the_envelope(self):
        status, headers, body = raw_exchange(self.harness.port,
                                             f'BREW /api/workspace HTTP/1.1\r\nHost: 127.0.0.1:{self.harness.port}\r\n\r\n'.encode())
        self.assertEqual((status, json.loads(body)), (405, {'error': 'Method not allowed'}))
        self.assertEqual(headers['content-type'], 'application/json; charset=utf-8')

    def test_a_broken_request_line_still_gets_the_envelope(self):
        status, headers, body = raw_exchange(self.harness.port, b'GARBAGE\r\n\r\n')
        self.assertEqual(status, 400)
        self.assertEqual(list(json.loads(body)), ['error'])

    def test_unknown_routes_are_404(self):
        for path in ('/', '/api', '/api/', '/api/workspace/', '/api/work', '/index.html', '/api/content',
                     '/api/brands', '/api/runs', '/api/sample/x-studio/extra', '/api/runs/' + '0' * 32 + '/x',
                     '/%61pi/workspace', '/api//workspace', '/api/../api/workspace'):
            with self.subTest(path=path):
                self.assertRefused(self.get(path), 404, 'Route not found')

    def test_posts_to_get_routes_and_unknown_paths_are_404_once_the_guards_pass(self):
        for path in ('/api/workspace', '/api/sample/x-studio', '/api/runs/' + '0' * 32, '/api/missing', '/', '/api/content/'):
            with self.subTest(path=path):
                self.assertRefused(self.post(path, {}), 404, 'Route not found')
        self.assertRefused(self.post('/api/missing', {}, token=False), 403, RELOAD)

    def test_the_query_string_is_ignored(self):
        self.assertEqual(self.get('/api/workspace?x=1&y=2').status, 200)
        self.assertEqual(self.post('/api/brands?x=1', {'name': 'q'}).status, 201)

    def test_security_headers_and_json_content_type_on_every_outcome(self):
        replies = [
            self.get('/api/workspace'), self.get('/api/sample/nope'), self.get('/nope'),
            self.get('/api/workspace', headers={'Host': 'evil.example'}), self.harness.request('DELETE', '/api/content'),
            self.post('/api/brands', {'name': 'x'}), self.post('/api/brands', {'name': ''}),
            self.post('/api/brands', {'name': 'x'}, token='bad'),
        ]
        for reply in replies:
            with self.subTest(status=reply.status, body=reply.body[:40]):
                for name, value in SECURITY.items():
                    self.assertEqual(reply.headers.get(name), value, name)
                self.assertEqual(reply.headers['content-type'], 'application/json; charset=utf-8')
                self.assertEqual(int(reply.headers['content-length']), len(reply.body))
        self.assertEqual([reply.status for reply in replies], [200, 400, 404, 403, 405, 201, 400, 403])

    def test_every_error_is_exactly_one_text_field(self):
        errors = [self.get('/api/sample/nope'), self.get('/nope'), self.get('/api/runs/zz'), self.post('/api/brands', {}),
                  self.post('/api/content', {'title': 'x', 'id': 'a', 'version': 1}), self.post('/api/brands', {'name': 'x'}, token='bad')]
        for reply in errors:
            self.assertGreaterEqual(reply.status, 400)
            self.assertEqual(list(reply.json), ['error'])
            self.assertIsInstance(reply.json['error'], str)

    def test_unexpected_failures_are_a_fixed_500_that_leaks_nothing(self):
        secret = 'database path /home/someone/secret.sqlite3'
        with mock.patch.object(self.service.store, 'brands', side_effect=RuntimeError(secret)), \
                contextlib.redirect_stderr(io.StringIO()) as log:
            reply = self.get('/api/workspace')
        self.assertRefused(reply, 500, 'The service could not complete this request. Your existing data is preserved.')
        self.assertNotIn(secret, reply.body.decode())
        self.assertNotIn(secret, log.getvalue())
        self.assertEqual(self.get('/api/workspace').status, 200)  # the server keeps serving

    def test_text_is_utf8_json(self):
        brand = self.post('/api/brands', {'name': 'Café 茶 😀'})
        self.assertIn('Café 茶 😀'.encode('utf-8'), brand.body)
        self.assertEqual(brand.json['name'], 'Café 茶 😀')
        lone = self.post('/api/brands', raw=b'{"name": "ok\\ud800"}')
        self.assertRefused(lone, 400, 'Brand name must be text, 1–80 characters')


class Routes(Endpoint):
    def test_workspace_shape(self):
        reply = self.get('/api/workspace')
        self.assertEqual(reply.status, 200)
        data = reply.json
        self.assertEqual(list(data), ['brands', 'content', 'runs', 'tools', 'features', 'csrf', 'sources'])
        self.assertEqual(data['brands'], [{'id': 'default', 'name': 'My workspace', 'project_id': None}])
        self.assertEqual((data['content'], data['runs']), ([], []))
        self.assertEqual(data['features'], ['hq-editorial-timebox-v1', 'hq-references-v1', 'hq-brand-project-v1', 'hq-sources-v1'])

    def test_tools_are_the_eight_in_hq_order(self):
        data = self.get('/api/workspace').json
        self.assertEqual([tool['id'] for tool in data['tools']], list(tools.TOOL_IDS))
        self.assertEqual(len(data['tools']), 8)
        for tool in data['tools']:
            self.assertEqual(sorted(tool), ['category', 'description', 'id', 'mark', 'name'])
            self.assertIn(tool['category'], ('Discover', 'Create', 'Measure', 'Plan', 'Connect'))

    def test_features_without_zone_data_do_not_advertise_timeboxes(self):
        self.restart(timezones=False)
        self.assertEqual(self.get('/api/workspace').json['features'], ['hq-references-v1', 'hq-brand-project-v1', 'hq-sources-v1'])

    def test_the_service_detects_missing_zone_data_for_itself(self):
        with mock.patch.object(timebox, '_zone_names', return_value=frozenset()):
            self.restart(timezones=None)
            self.assertEqual(self.get('/api/workspace').json['features'], ['hq-references-v1', 'hq-brand-project-v1', 'hq-sources-v1'])
            reply = self.post('/api/content', {'title': 'x', 'planned_date': '2026-10-22',
                                               'planning_slot': {'start': '09:00', 'duration_minutes': 30, 'timezone': 'UTC'}})
            self.assertRefused(reply, 400, 'Unknown time zone')
        self.restart(timezones=None)
        self.assertEqual(self.get('/api/workspace').json['features'], ['hq-editorial-timebox-v1', 'hq-references-v1', 'hq-brand-project-v1', 'hq-sources-v1'])

    def test_persisted_extensions_are_advertised_but_publishing_stays_off(self):
        features = self.get('/api/workspace').json['features']
        self.assertIn('hq-brand-project-v1', features)
        self.assertIn('hq-sources-v1', features)
        self.assertNotIn('hq-publishing-simulator-v1', features)

    def test_samples_for_every_tool_equal_hq_examples(self):
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                reply = self.get(f'/api/sample/{tool}')
                self.assertEqual(reply.status, 200)
                if tool in tools.SAMPLES:
                    self.assertEqual(reply.json, tools.SAMPLES[tool])
                self.assertIsInstance(reply.json, dict)
        self.assertEqual(len(tools.SAMPLES), 8)

    def test_unknown_sample_tools_are_400(self):
        for path in ('/api/sample/nope', '/api/sample/', '/api/sample/X-STUDIO', '/api/sample/x-studio%2F',
                     '/api/sample/..'):
            with self.subTest(path=path):
                self.assertRefused(self.get(path), 400, 'Unknown tool')

    def test_run_lookup_errors(self):
        for path in ('/api/runs/zz', '/api/runs/', '/api/runs/' + 'A' * 32, '/api/runs/' + '0' * 31,
                     '/api/runs/' + '0' * 33):
            with self.subTest(path=path):
                self.assertRefused(self.get(path), 400, 'Invalid run ID')
        self.assertRefused(self.get('/api/runs/' + '0' * 32), 404, 'Run not found')

    def test_brands_are_created_listed_by_name_and_may_repeat(self):
        zed = self.post('/api/brands', {'name': '  Zed  '})
        self.assertEqual(zed.status, 201)
        self.assertEqual(list(zed.json), ['id', 'name', 'project_id'])
        self.assertIsNone(zed.json['project_id'])
        self.assertRegex(zed.json['id'], HEX32)
        self.assertEqual(zed.json['name'], 'Zed')
        self.post('/api/brands', {'name': 'alpha'})
        self.post('/api/brands', {'name': 'Zed'})
        workspace = self.get('/api/workspace').json
        self.assertEqual(workspace['sources'], [])
        for brand in workspace['brands']:
            self.assertEqual(list(brand), ['id', 'name', 'project_id'])
            self.assertIsNone(brand['project_id'])
            if brand['id'] != 'default':
                self.assertRegex(brand['id'], HEX32)
        names = [brand['name'] for brand in workspace['brands']]
        self.assertEqual(names, ['alpha', 'My workspace', 'Zed', 'Zed'])

    def test_brand_errors(self):
        for body, message in (({}, 'Brand name must be text, 1–80 characters'),
                              ({'name': ''}, 'Brand name must be text, 1–80 characters'),
                              ({'name': 'n' * 81}, 'Brand name must be text, 1–80 characters'),
                              ({'name': 'x', 'project_id': 'p'}, 'Unknown field: project_id')):
            with self.subTest(body=body):
                self.assertRefused(self.post('/api/brands', body), 400, message)
        self.assertEqual(len(self.get('/api/workspace').json['brands']), 1)

    def test_a_new_brand_can_be_used_by_a_draft(self):
        brand = self.post('/api/brands', {'name': 'Larkspur'}).json
        draft = self.harness.save(brand_id=brand['id'])
        self.assertEqual(draft['brand_id'], brand['id'])
        self.assertRefused(self.post('/api/content', {'title': 'x', 'brand_id': 'nope'}), 400, 'Unknown brand')

    def test_the_server_handles_concurrent_clients(self):
        results = []

        def work(index):
            reply = self.post('/api/brands', {'name': f'brand {index}'})
            results.append(reply.status)

        import threading
        threads = [threading.Thread(target=work, args=(index,)) for index in range(16)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results, [201] * 16)
        self.assertEqual(len(self.get('/api/workspace').json['brands']), 17)


class Binding(unittest.TestCase):
    def test_loopback_detection(self):
        for host in ('127.0.0.1', '::1', 'localhost', 'LOCALHOST', '127.0.0.2'):
            self.assertTrue(server_module.is_loopback_host(host), host)
        for host in ('0.0.0.0', '::', '192.0.2.1', '10.0.0.1', 'example.com', '', '127.0.0.1.example', 'localhost.'):
            self.assertFalse(server_module.is_loopback_host(host), host)

    def test_ipv6_hosts_are_bracketed(self):
        self.assertEqual(server_module.display_host('::1'), '[::1]')
        self.assertEqual(server_module.display_host('127.0.0.1'), '127.0.0.1')
        self.assertEqual(server_module.display_host('localhost'), 'localhost')


@unittest.skipUnless(socket.has_ipv6, 'This Python has no IPv6 support')
class IPv6Loopback(ServiceTestCase):
    def test_a_server_can_bind_the_ipv6_loopback(self):
        probe = socket.socket(socket.AF_INET6)
        try:
            probe.bind(('::1', 0))
        except OSError:
            self.skipTest('The IPv6 loopback address is not available on this host')
        finally:
            probe.close()
        from social_service.server import create_server
        import threading
        import http.client
        server = create_server(self.service, '::1', 0)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        connection = http.client.HTTPConnection('::1', port, timeout=10)
        connection.request('GET', '/api/workspace')
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 200)  # Host is "[::1]:port"
        connection.close()


if __name__ == '__main__':
    unittest.main()
