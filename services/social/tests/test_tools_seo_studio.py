"""SEO workbench: editorial-readiness checks on supplied article packets."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, seo_studio

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
SOURCES = ['https://example.invalid/one', 'https://example.invalid/two']


def packet(slug: str = 'steeping-guide', title: str = 'A fictional steeping guide', sources: object = None, **extra: object) -> dict:
    return {'slug': slug, 'title': title, 'sources': list(SOURCES) if sources is None else sources, **extra}


def run(*packets: dict, **overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['seo-studio'])
    data['packets'] = list(packets) or [packet()]
    data.update(overrides)
    return seo_studio.run(data, now=NOW)


class SampleTests(unittest.TestCase):
    def test_sample_needs_a_second_source(self) -> None:
        result = seo_studio.run(copy.deepcopy(SAMPLES['seo-studio']), now=NOW)
        self.assertIs(result['ok'], False)
        self.assertEqual(result['site'], 'example.invalid')
        self.assertEqual(result['language'], 'en')
        self.assertEqual(result['as_of'], '2026-10-01')
        self.assertEqual(result['summary'], {'packets': 1, 'ready': 0, 'needs_attention': 1, 'findings': 1})
        self.assertEqual(result['packets'], [{
            'slug': 'steeping-guide', 'title': 'A fictional steeping guide', 'sources': 1, 'status': 'needs_attention',
            'findings': ['Needs at least 2 different http or https sources; found 1.']}])
        self.assertIn('as of 2026-10-01', result['basis'])
        self.assertTrue(result['rules'])

    def test_a_ready_packet_makes_ok_true(self) -> None:
        result = run()
        self.assertIs(result['ok'], True)
        self.assertEqual(result['packets'][0]['status'], 'ready')
        self.assertEqual(result['packets'][0]['findings'], [])
        self.assertEqual(result['summary'], {'packets': 1, 'ready': 1, 'needs_attention': 0, 'findings': 0})

    def test_ok_is_true_only_when_every_packet_is_ready(self) -> None:
        result = run(packet('good-one'), packet('good-two'), packet('bad-one', sources=['https://example.invalid/only']))
        self.assertIs(result['ok'], False)
        self.assertEqual([entry['status'] for entry in result['packets']], ['ready', 'ready', 'needs_attention'])
        self.assertEqual(result['summary'], {'packets': 3, 'ready': 2, 'needs_attention': 1, 'findings': 1})

    def test_deterministic_and_input_order_is_kept(self) -> None:
        packets = [packet('zeta'), packet('alpha')]
        self.assertEqual(run(*packets), run(*packets))
        self.assertEqual([entry['slug'] for entry in run(*packets)['packets']], ['zeta', 'alpha'])


class SlugTests(unittest.TestCase):
    def findings(self, slug: str) -> list[str]:
        return run(packet(slug))['packets'][0]['findings']

    def test_valid_slugs(self) -> None:
        for slug in ('a', 'steeping-guide', 'oolong-101', '2026-review', 'a' * 80):
            with self.subTest(slug=slug):
                self.assertEqual(self.findings(slug), [])

    def test_invalid_slugs(self) -> None:
        for slug in ('Steeping-Guide', 'steeping guide', 'steeping_guide', '-leading', 'trailing-', 'double--hyphen', 'ünïcode', 'a' * 81, 'slash/path', ' padded'):
            with self.subTest(slug=slug):
                self.assertEqual(self.findings(slug), ['Slug must use lowercase letters, digits and single hyphens, at most 80 characters.'])

    def test_duplicate_slugs_are_flagged_on_every_packet_that_shares_them(self) -> None:
        result = run(packet('same'), packet('other'), packet('same'))
        self.assertEqual([entry['status'] for entry in result['packets']], ['needs_attention', 'ready', 'needs_attention'])
        self.assertEqual(result['packets'][0]['findings'], ['Slug is used by 2 packets; each packet needs its own.'])


class TitleTests(unittest.TestCase):
    def test_length_range_is_inclusive(self) -> None:
        for length, ok in ((9, False), (10, True), (70, True), (71, False)):
            with self.subTest(length=length):
                findings = run(packet(title='t' * length))['packets'][0]['findings']
                self.assertEqual(findings == [], ok)
                if not ok:
                    self.assertEqual(findings, [f'Title is {length} characters; the illustrative range is 10–70.'])

    def test_length_is_counted_in_code_points_after_stripping(self) -> None:
        self.assertEqual(run(packet(title='\U0001F600' * 10))['packets'][0]['findings'], [])
        self.assertEqual(run(packet(title='  ' + 't' * 10 + '  '))['packets'][0]['findings'], [])


class SourceTests(unittest.TestCase):
    def test_missing_and_single_sources(self) -> None:
        self.assertEqual(run(packet(sources=[]))['packets'][0]['findings'], ['Needs at least 2 different http or https sources; found 0.'])
        self.assertEqual(run(packet(sources=SOURCES[:1]))['packets'][0]['findings'], ['Needs at least 2 different http or https sources; found 1.'])

    def test_duplicate_sources_count_once_after_normalization(self) -> None:
        result = run(packet(sources=['https://example.invalid/a', 'HTTPS://Example.invalid/a/', 'https://example.invalid/a#frag']))
        self.assertEqual(result['packets'][0]['findings'], ['Needs at least 2 different http or https sources; found 1.'])
        self.assertEqual(result['packets'][0]['sources'], 1)

    def test_non_http_sources_are_named_by_position(self) -> None:
        result = run(packet(sources=['https://example.invalid/a', 'ftp://example.invalid/b', 'not a url', 'https://example.invalid/c']))
        self.assertEqual(result['packets'][0]['findings'], ['Source 2 is not an http or https URL.', 'Source 3 is not an http or https URL.'])
        self.assertEqual(result['packets'][0]['sources'], 2)

    def test_many_bad_sources_are_summarized(self) -> None:
        result = run(packet(sources=['nope'] * 10))
        self.assertEqual(result['packets'][0]['findings'][:3], ['Source 1 is not an http or https URL.', 'Source 2 is not an http or https URL.', 'Source 3 is not an http or https URL.'])
        self.assertIn('7 more sources are not http or https URLs.', result['packets'][0]['findings'])

    def test_credentials_in_a_source_are_not_accepted(self) -> None:
        result = run(packet(sources=['https://user:pw@example.invalid/a', 'https://example.invalid/b']))
        self.assertEqual(result['packets'][0]['findings'][0], 'Source 1 is not an http or https URL.')


class BodyTests(unittest.TestCase):
    def test_word_count_is_reported_only_when_a_body_is_supplied(self) -> None:
        self.assertNotIn('word_count', run()['packets'][0])
        self.assertEqual(run(packet(body='word ' * 300))['packets'][0]['word_count'], 300)

    def test_minimum_words_is_illustrative_and_inclusive(self) -> None:
        self.assertEqual(run(packet(body='word ' * 300))['packets'][0]['findings'], [])
        self.assertEqual(run(packet(body='word ' * 299))['packets'][0]['findings'], ['Body has 299 words; the illustrative minimum is 300.'])
        self.assertEqual(run(packet(body=''))['packets'][0]['findings'], ['Body has 0 words; the illustrative minimum is 300.'])
        self.assertEqual(run(packet(body='one'))['packets'][0]['findings'], ['Body has 1 word; the illustrative minimum is 300.'])

    def test_a_null_body_counts_as_absent(self) -> None:
        self.assertNotIn('word_count', run(packet(body=None))['packets'][0])

    def test_unknown_packet_keys_are_ignored(self) -> None:
        self.assertEqual(run(packet(description='ignored', tags=['x'])), run(packet()))


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, *packets: dict, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(*packets, **overrides)
        self.assertEqual(str(caught.exception), message)

    def test_config(self) -> None:
        self.assertRejects('config must be an object with a site and language', config=None)
        self.assertRejects('config must be an object with a site and language', config='example.invalid')
        self.assertRejects('config site must be text', config={'language': 'en'})
        self.assertRejects('config site must be a host name such as example.invalid', config={'site': 'https://example.invalid', 'language': 'en'})
        self.assertRejects('config site must be a host name such as example.invalid', config={'site': 'exa mple.invalid', 'language': 'en'})
        self.assertRejects('config site must be a host name such as example.invalid', config={'site': 'a..b', 'language': 'en'})
        self.assertRejects('config site must be at most 253 characters', config={'site': 'a' * 254, 'language': 'en'})
        self.assertRejects('config language must be text', config={'site': 'example.invalid'})
        self.assertRejects('config language must be a language code such as en or en-GB', config={'site': 'example.invalid', 'language': 'english!'})
        self.assertRejects('config language must be a language code such as en or en-GB', config={'site': 'example.invalid', 'language': 'e'})
        self.assertEqual(run(config={'site': 'blog.example.invalid', 'language': 'en-GB', 'extra': 1})['language'], 'en-GB')

    def test_as_of(self) -> None:
        for value in ('2026-13-01', '2026/10/01', '2026-10-01T00:00:00Z', '2027-02-29', 20261001, None, ''):
            with self.subTest(value=value):
                self.assertRejects('as_of must be a date in YYYY-MM-DD form, such as 2026-10-01', as_of=value)
        self.assertEqual(run(as_of='2028-02-29')['as_of'], '2028-02-29')

    def test_packets_list(self) -> None:
        message = 'packets must be a list of 1–200 article packets'
        self.assertRejects(message, packets=[])
        self.assertRejects(message, *[packet(f'slug-{index}') for index in range(201)])

    def test_packets_list_other_types(self) -> None:
        data = copy.deepcopy(SAMPLES['seo-studio'])
        for value in ('p', None, {}, []):
            data['packets'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^packets must be a list of 1–200 article packets$'):
                seo_studio.run(data, now=NOW)

    def test_the_packets_ceiling_is_accepted(self) -> None:
        result = run(*[packet(f'slug-{index}') for index in range(200)])
        self.assertEqual(result['summary']['packets'], 200)

    def test_packet_shape(self) -> None:
        self.assertRejects('packet 1 must be an object with a slug, title and sources', 'text')
        self.assertRejects('packet 1: slug must be text', {'title': 'A fictional guide', 'sources': SOURCES})
        self.assertRejects('packet 1: slug cannot be blank', packet(' '))
        self.assertRejects('packet 1: slug must be at most 200 characters', packet('s' * 201))
        self.assertRejects('packet 1: title must be text', {'slug': 's', 'sources': SOURCES})
        self.assertRejects('packet 1: title cannot be blank', packet(title=''))
        self.assertRejects('packet 1: title must be at most 500 characters', packet(title='t' * 501))
        self.assertRejects('packet 1: sources must be a list of up to 50 source URLs', {'slug': 's', 'title': 'A fictional guide'})
        self.assertRejects('packet 1: sources must be a list of up to 50 source URLs', packet(sources='https://example.invalid/a'))
        self.assertRejects('packet 1: sources must be a list of up to 50 source URLs', packet(sources=['https://example.invalid/a'] * 51))
        self.assertRejects('packet 2: source 1 must be text of at most 2,048 characters', packet(), packet('other', sources=[5]))
        self.assertRejects('packet 1: source 1 must be text of at most 2,048 characters', packet(sources=['https://example.invalid/' + 'a' * 2_048]))
        self.assertRejects('packet 1: body must be text', packet(body=4))
        self.assertRejects('packet 1: body must be at most 100,000 characters', packet(body='b' * 100_001))

    def test_fifty_sources_are_accepted(self) -> None:
        sources = [f'https://example.invalid/{index}' for index in range(50)]
        self.assertEqual(run(packet(sources=sources))['packets'][0]['sources'], 50)


if __name__ == '__main__':
    unittest.main()
