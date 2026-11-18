"""Cross-cutting analyzer contract: samples, determinism, purity, JSON safety, bounds and error discipline."""

from __future__ import annotations

import ast
import copy
import importlib
import json
import re
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from social_service import tools

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
SERVICE_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = SERVICE_ROOT / 'social_service' / 'tools'
ANALYZERS = sorted(tools.MODULES.items())
SIZE_LIMIT = 1_000_000


def run(tool: str, data: dict[str, Any]) -> dict[str, Any]:
    return importlib.import_module(f'social_service.tools.{tools.MODULES[tool]}').run(data, now=NOW)


def sample_result(tool: str) -> dict[str, Any]:
    return run(tool, tools.sample(tool))


def dumps(value: Any) -> str:
    return json.dumps(value, allow_nan=False, sort_keys=True)


def lists_in(value: Any) -> Iterator[list[Any]]:
    if isinstance(value, list):
        yield value
        for item in value:
            yield from lists_in(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from lists_in(item)


class RegistryTests(unittest.TestCase):
    def test_every_catalog_tool_has_a_sample_and_an_analyzer_module(self) -> None:
        self.assertEqual(set(tools.MODULES), set(tools.TOOL_IDS))
        self.assertEqual(set(tools.SAMPLES), set(tools.TOOL_IDS))
        self.assertEqual(len(tools.TOOL_IDS), 8)
        for tool, name in ANALYZERS:
            with self.subTest(tool=tool):
                module = importlib.import_module(f'social_service.tools.{name}')
                self.assertTrue(callable(module.run))
                self.assertTrue((TOOLS_DIR / f'{name}.py').is_file())

    def test_execute_dispatches_to_the_analyzer(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                self.assertEqual(tools.execute(tool, tools.sample(tool), now=NOW), sample_result(tool))


class SampleTests(unittest.TestCase):
    def test_every_sample_succeeds_with_a_json_result(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                result = sample_result(tool)
                self.assertIsInstance(result, dict)
                self.assertTrue(result)
                json.loads(dumps(result))

    def test_results_are_deterministic(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                first, second = sample_result(tool), sample_result(tool)
                self.assertEqual(first, second)
                self.assertEqual(dumps(first), dumps(second))

    def test_results_do_not_depend_on_now(self) -> None:
        later = datetime(2030, 1, 1, tzinfo=timezone.utc)
        for tool, name in ANALYZERS:
            with self.subTest(tool=tool):
                module = importlib.import_module(f'social_service.tools.{name}')
                self.assertEqual(module.run(tools.sample(tool), now=NOW), module.run(tools.sample(tool), now=later))

    def test_input_is_never_modified(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                data = tools.sample(tool)
                before = copy.deepcopy(data)
                run(tool, data)
                self.assertEqual(data, before)

    def test_results_do_not_alias_the_input(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                data = tools.sample(tool)
                result = run(tool, data)
                snapshot = dumps(result)
                for value in list(data.values()):
                    if isinstance(value, list):
                        value.append('mutated after the run')
                    elif isinstance(value, dict):
                        value['mutated'] = 'after the run'
                self.assertEqual(dumps(result), snapshot)

    def test_mutating_a_result_never_changes_a_later_result(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                first = sample_result(tool)
                expected = dumps(first)
                for node in [first, *lists_in(first)]:
                    if isinstance(node, list):
                        node.append('mutated')
                    for value in (node.values() if isinstance(node, dict) else []):
                        if isinstance(value, (list, dict)):
                            value.clear()
                self.assertEqual(dumps(sample_result(tool)), expected)

    def test_every_result_states_its_basis(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                result = sample_result(tool)
                basis = result.get('basis')
                self.assertIsInstance(basis, str)
                self.assertIn('supplied', basis.lower())

    def test_no_result_claims_an_effect_that_has_not_happened(self) -> None:
        pattern = re.compile(r'\b(published|posted|scheduled|connected|live|verified|personali[sz]ed)\b', re.IGNORECASE)
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                self.assertIsNone(pattern.search(dumps(sample_result(tool))), pattern.search(dumps(sample_result(tool))))


class SummaryShapeTests(unittest.TestCase):
    """The fields HQ's summarizers read (modules/social/workbench/results.ts), with the types they check."""

    def test_x_studio(self) -> None:
        blocks = sample_result('x-studio')['content']['blocks']
        self.assertTrue(blocks)
        for block in blocks:
            self.assertIsInstance(block['kind'], str)
            self.assertTrue(block['text'].strip())

    def test_social_publisher(self) -> None:
        result = sample_result('social-publisher')
        self.assertIsInstance(result['qualification'], str)
        self.assertEqual([channel['platform'] for channel in result['channels']], ['x', 'linkedin', 'instagram', 'tiktok', 'facebook'])
        for channel in result['channels']:
            for finding in channel['findings']:
                self.assertRegex(finding['rule_id'], r'^(x|linkedin|instagram|tiktok|facebook)\.(caption|format|owner_scope)$')
                self.assertIn(finding['status'], ('pass', 'fail'))

    def test_x_intelligence(self) -> None:
        result = sample_result('x-intelligence')
        self.assertTrue(all(isinstance(value, int) for value in result['counts'].values()))
        for record in result['evidence']:
            self.assertTrue(record['title'] and record['text'])

    def test_creator_relationships(self) -> None:
        for creator in sample_result('creator-relationships')['creators']:
            self.assertTrue(creator.get('name') or creator.get('handle'))
            self.assertIsInstance(creator['status'], str)
            self.assertTrue(all(isinstance(topic, str) for topic in creator['niche_matches']))
            self.assertIsInstance(creator['missing_evidence'], dict)
            self.assertTrue(creator['age_days'] is None or isinstance(creator['age_days'], float))

    def test_seo_studio_reddit_and_the_top_level_fact_tools(self) -> None:
        self.assertIsInstance(sample_result('seo-studio')['ok'], bool)
        self.assertIsInstance(sample_result('reddit-opportunities')['profile'], str)
        tiktok = sample_result('tiktok-intelligence')
        for key in ('niche', 'as_of', 'qualifications', 'posts', 'ranking'):
            self.assertIn(key, tiktok)
        visibility = sample_result('search-visibility')
        for key in ('queries', 'answers', 'engines', 'citations', 'coverage', 'entity_mentions', 'basis'):
            self.assertIn(key, visibility)


PURITY_SCRIPT = r'''
import importlib, json, os, socket, subprocess, sys
from datetime import datetime, timezone

sys.path.insert(0, sys.argv[1])
from social_service import tools

modules = {tool: importlib.import_module('social_service.tools.' + name) for tool, name in tools.MODULES.items()}
samples = {tool: tools.sample(tool) for tool in tools.TOOL_IDS}
now = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)

EXACT = {'open', 'os.system', 'os.posix_spawn', 'os.spawn', 'os.fork', 'os.forkpty', 'subprocess.Popen', 'os.listdir',
         'os.scandir', 'os.mkdir', 'os.remove', 'os.rename', 'os.rmdir', 'os.putenv', 'os.unsetenv', 'os.chdir'}
PREFIXES = ('socket.', 'os.exec', 'ctypes.', 'urllib.Request', 'http.client.', 'shutil.')


def hook(event, args):
    if event in EXACT or event.startswith(PREFIXES):
        raise RuntimeError('forbidden audit event: ' + event)


sys.addaudithook(hook)


def blocked(label, action):
    try:
        action()
    except RuntimeError as error:
        if 'forbidden audit event' not in str(error):
            raise
        return label
    raise SystemExit('the hook did not block ' + label)


controls = [
    blocked('open', lambda: open(os.devnull)),
    blocked('socket', lambda: socket.socket()),
    blocked('subprocess.Popen', lambda: subprocess.Popen(['true'])),
    blocked('os.system', lambda: os.system('true')),
]
ran = {}
for tool, module in modules.items():
    direct = module.run(samples[tool], now=now)
    dispatched = tools.execute(tool, samples[tool], now=now)
    assert direct == dispatched, tool
    ran[tool] = sorted(direct)
print(json.dumps({'controls': controls, 'ran': ran}))
'''


class PurityTests(unittest.TestCase):
    def test_samples_run_under_an_audit_hook_that_forbids_files_sockets_and_processes(self) -> None:
        completed = subprocess.run([sys.executable, '-I', '-B', '-c', PURITY_SCRIPT, str(SERVICE_ROOT)],
                                   capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report['controls'], ['open', 'socket', 'subprocess.Popen', 'os.system'])
        self.assertEqual(set(report['ran']), set(tools.TOOL_IDS))
        for tool, keys in report['ran'].items():
            self.assertTrue(keys, tool)

    ALLOWED_IMPORTS = {'__future__', 'datetime', 'math', 're', 'typing'}
    FORBIDDEN_NAMES = {'open', 'exec', 'eval', '__import__', 'input', 'print', 'compile', 'globals', 'locals', 'vars'}
    FORBIDDEN_ATTRIBUTES = {'now', 'utcnow', 'today', 'time', 'getenv', 'environ', 'system', 'popen', 'urlopen'}

    def test_analyzers_import_only_pure_standard_library_modules(self) -> None:
        for name in ['_common', *tools.MODULES.values()]:
            with self.subTest(module=name):
                tree = ast.parse((TOOLS_DIR / f'{name}.py').read_text(encoding='utf-8'))
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            self.assertIn(alias.name.split('.')[0], self.ALLOWED_IMPORTS)
                    elif isinstance(node, ast.ImportFrom):
                        if node.level:
                            self.assertEqual((node.level, node.module), (1, '_common'))
                        else:
                            self.assertIn((node.module or '').split('.')[0], self.ALLOWED_IMPORTS)

    def test_analyzers_use_no_clock_environment_or_dynamic_code(self) -> None:
        for name in ['_common', *tools.MODULES.values()]:
            with self.subTest(module=name):
                tree = ast.parse((TOOLS_DIR / f'{name}.py').read_text(encoding='utf-8'))
                for node in ast.walk(tree):
                    if isinstance(node, ast.Name):
                        self.assertNotIn(node.id, self.FORBIDDEN_NAMES, f'line {node.lineno}')
                    elif isinstance(node, ast.Attribute):
                        self.assertNotIn(node.attr, self.FORBIDDEN_ATTRIBUTES, f'line {node.lineno}')


def maximal_inputs() -> dict[str, list[dict[str, Any]]]:
    """For each tool, inputs at or near every documented bound, with long strings and every optional field set."""
    sentences = ' '.join(f'Sentence {index} says something plain and unremarkable.' for index in range(1_000))[:20_000]
    terms = [f'term-{index:02d}-abcd' for index in range(50)]
    domain = 'https://example.invalid/'
    queries = [f'query {index:03d} ' + 'q' * 280 for index in range(200)]
    entity_names = [f'Entity {index:03d} ' + 'e' * 180 for index in range(100)]
    inventory = [{'url': f'{domain}page-{index:04d}/' + 'p' * 950, 'title': 't' * 200} for index in range(2_000)]
    profile_terms = [f'profile-term-{index:03d}-x' for index in range(50)]
    topics = [f'niche-{index:02d}-tp' for index in range(50)]
    return {
        'x-studio': [{'notes': sentences, 'format': format_, 'audience': 'a' * 200, 'intent': 'i' * 300} for format_ in ('short_post', 'thread', 'article')]
                    + [{'notes': '\U0001F600 ' * 10_000, 'format': 'thread'}, {'notes': '\n\n'.join(['a.'] * 4_900), 'format': 'article'}],
        'social-publisher': [{'caption': '\U0001F600' * 30_000, 'format': 'text'}, {'caption': 'c' * 30_000}],
        'x-intelligence': [{
            'topic': 't' * 200, 'terms': terms,
            'items': [{'id': f'item-{index:05d}-' + 'x' * 80, 'title': 'T' * 200, 'content_text': ' '.join(terms), 'url': domain + 'p' * 476}
                      for index in range(5_000)]}],
        'tiktok-intelligence': [{
            'niche': {'name': 'n' * 200, 'terms': [f't{index:02d}' + 'x' * 90 for index in range(50)]}, 'as_of': '2026-10-01T12:00:00Z',
            'batches': [{'manifest': {'batch_id': f'batch-{batch:02d}', 'observed_at': f'2026-09-{batch + 1:02d}T00:00:00Z', 'source': 's' * 200},
                         'records': [{'post_id': f'post-{post:05d}-' + 'x' * 80, 'views': 10 ** 12 - batch, 'likes': batch * post, 'comments': post, 'shares': batch}
                                     for post in range(5_000)]} for batch in range(20)]}],
        'seo-studio': [{
            'config': {'site': 'example.invalid', 'language': 'en-GB'}, 'as_of': '2026-10-01',
            'packets': [{'slug': f'slug-{index:03d}' + '-a' * 30, 'title': 'T' * 70, 'body': 'word ' * 100,
                         'sources': [f'{domain}source-{n}' for n in range(40)] + ['nope'] * 10} for index in range(200)]}],
        'search-visibility': [{
            'panel': {'name': 'p' * 200, 'queries': queries},
            'entities': [{'name': name, 'kind': 'k' * 50} for name in entity_names],
            'inventory': inventory,
            'answers': [{'query': queries[index % 200], 'engine': f'engine-{index % 30:02d}-' + 'e' * 40,
                         'cited': [inventory[(index * 7 + n) % 2_000]['url'] for n in range(50)],
                         'text': ' '.join(entity_names[(index + n) % 100] for n in range(3))} for index in range(5_000)]}],
        'reddit-opportunities': [{
            'bundle': {'corpus': 'c' * 200, 'posts': [{
                'id': f'post-{index:05d}-' + 'i' * 80, 'title': ' '.join(profile_terms)[:299] + '?', 'body': ' '.join(profile_terms[16:]) + '?',
                'subreddit': 'r' * 100, 'created_at': '2026-09-30T12:00:00Z', 'score': 10 ** 9, 'comments': 10 ** 9} for index in range(5_000)]},
            'as_of': '2026-10-01T12:00:00Z', 'profile': {'name': 'p' * 100, 'terms': profile_terms}}],
        'creator-relationships': [{
            'batch': {'account_id': 'a' * 100, 'creators': [{
                'handle': f'creator-{index:03d}-' + 'h' * 80, 'name': 'n' * 200, 'topics': topics, 'followers': 10 ** 10,
                'last_post_at': '2026-09-30T12:00:00Z', 'audience_location': 'a' * 200} for index in range(200)]},
            'niche_topics': topics, 'brand_topics': topics, 'as_of': '2026-10-01T12:00:00Z'}],
    }


class BoundsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.inputs = maximal_inputs()
        cls.results = {tool: [run(tool, data) for data in variants] for tool, variants in cls.inputs.items()}

    def test_maximal_inputs_give_bounded_json_safe_results(self) -> None:
        self.assertEqual(set(self.results), set(tools.TOOL_IDS))
        for tool, results in self.results.items():
            for index, result in enumerate(results):
                with self.subTest(tool=tool, variant=index):
                    text = json.dumps(result, allow_nan=False)
                    self.assertLess(len(text.encode('utf-8')), SIZE_LIMIT)
                    self.assertEqual(json.loads(text), result)

    def test_no_result_lists_more_than_500_entries(self) -> None:
        for tool, results in self.results.items():
            for index, result in enumerate(results):
                with self.subTest(tool=tool, variant=index):
                    self.assertLessEqual(max((len(items) for items in lists_in(result)), default=0), 500)

    def test_maximal_results_are_deterministic(self) -> None:
        for tool, variants in self.inputs.items():
            with self.subTest(tool=tool):
                self.assertEqual(dumps(run(tool, variants[0])), dumps(self.results[tool][0]))

    def test_maximal_results_keep_their_counts_honest(self) -> None:
        results = {tool: results[0] for tool, results in self.results.items()}
        self.assertEqual(results['x-intelligence']['counts'], {'items': 5_000, 'matched': 5_000, 'unmatched': 0, 'evidence': 300})
        self.assertEqual(results['x-intelligence']['evidence_omitted'], 4_700)
        self.assertEqual((results['tiktok-intelligence']['posts_observed'], len(results['tiktok-intelligence']['posts']), results['tiktok-intelligence']['posts_omitted']), (5_000, 200, 4_800))
        self.assertEqual(results['seo-studio']['summary']['packets'], 200)
        self.assertEqual((results['search-visibility']['answers'], results['search-visibility']['queries']), (5_000, 200))
        self.assertEqual((results['reddit-opportunities']['opportunities_found'], len(results['reddit-opportunities']['analysis']['opportunities'])), (5_000, 200))
        self.assertEqual(results['creator-relationships']['counts']['creators'], 200)


GARBAGE: list[Any] = [None, True, 0, -1, 1.5, 10 ** 30, '', '   ', 'text', 'x' * 30_000, '\ud800', '\U0001F600', '2026-13-45', [], [None], [[]], [{}], {}, {'a': 1}]


def paths(value: Any, prefix: tuple[Any, ...] = ()) -> Iterator[tuple[Any, ...]]:
    if prefix:
        yield prefix
    if isinstance(value, dict):
        for key, item in value.items():
            yield from paths(item, prefix + (key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from paths(item, prefix + (index,))


def mutate(data: dict[str, Any], path: tuple[Any, ...], replacement: Any, *, delete: bool = False) -> dict[str, Any]:
    clone = copy.deepcopy(data)
    parent: Any = clone
    for step in path[:-1]:
        parent = parent[step]
    if delete:
        del parent[path[-1]]
    else:
        parent[path[-1]] = replacement
    return clone


class ErrorDisciplineTests(unittest.TestCase):
    def check(self, tool: str, data: Any) -> None:
        try:
            result = run(tool, data)
        except ValueError as error:
            message = str(error)
            self.assertTrue(0 < len(message) <= 240, message)
            for leak in ('Traceback', '<class', ' at 0x', 'NoneType', 'KeyError', 'TypeError'):
                self.assertNotIn(leak, message)
        else:
            self.assertIsInstance(result, dict)
            dumps(result)

    def test_non_object_and_empty_inputs_are_refused_cleanly(self) -> None:
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                with self.assertRaises(ValueError):
                    run(tool, {})
                for garbage in (None, [], 'text', 3):
                    with self.assertRaises(ValueError):
                        tools.execute(tool, garbage, now=NOW)  # type: ignore[arg-type]

    def test_wrong_typed_or_missing_values_anywhere_never_escape_as_other_exceptions(self) -> None:
        for tool in tools.TOOL_IDS:
            sample = tools.sample(tool)
            for path in paths(sample):
                with self.subTest(tool=tool, path=path):
                    for garbage in GARBAGE:
                        self.check(tool, mutate(sample, path, garbage))
                    if isinstance(path[-1], str):
                        self.check(tool, mutate(sample, path, None, delete=True))

    def test_oversized_text_in_any_sample_string_is_refused_or_handled(self) -> None:
        for tool in tools.TOOL_IDS:
            sample = tools.sample(tool)
            for path in paths(sample):
                node: Any = sample
                for step in path:
                    node = node[step]
                if isinstance(node, str):
                    with self.subTest(tool=tool, path=path):
                        self.check(tool, mutate(sample, path, node + 'x' * 300_000))

    def test_non_finite_numbers_and_deep_nesting_are_refused_everywhere(self) -> None:
        deep: Any = 'x'
        for _ in range(100):
            deep = [deep]
        for tool in tools.TOOL_IDS:
            with self.subTest(tool=tool):
                for extra in (float('nan'), float('inf'), deep, {'k': deep}):
                    data = tools.sample(tool)
                    data['unrelated'] = extra
                    with self.assertRaises(ValueError):
                        run(tool, data)


if __name__ == '__main__':
    unittest.main()
