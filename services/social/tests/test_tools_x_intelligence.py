"""Signal inbox: whole-word term matching over supplied feed items."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, x_intelligence

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def run(**overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['x-intelligence'])
    data.update(overrides)
    return x_intelligence.run(data, now=NOW)


def one(content: str = '', *, title: str | None = None, terms: list[str] | None = None, **item: object) -> dict:
    entry: dict = {'id': 'item-1', **item}
    if content:
        entry['content_text'] = content
    if title is not None:
        entry['title'] = title
    return run(terms=terms or ['oolong'], items=[entry])


class SampleTests(unittest.TestCase):
    def test_sample_counts_and_evidence(self) -> None:
        result = x_intelligence.run(copy.deepcopy(SAMPLES['x-intelligence']), now=NOW)
        self.assertEqual(result['counts'], {'items': 2, 'matched': 2, 'unmatched': 0, 'evidence': 2})
        self.assertEqual(result['topic'], 'Neighborhood tea')
        self.assertEqual(result['terms'], ['oolong', 'steeping'])
        self.assertEqual(result['evidence'], [
            {'item_id': 'fixture-item-1', 'title': 'A corner shop tries cold-brew oolong',
             'text': 'Matched "oolong" and "steeping" in supplied item fixture-item-1.',
             'url': 'https://example.invalid/cold-brew', 'matched_terms': ['oolong', 'steeping']},
            {'item_id': 'fixture-item-2', 'title': 'Steeping questions at a market stall',
             'text': 'Matched "steeping" in supplied item fixture-item-2.', 'matched_terms': ['steeping']},
        ])
        self.assertEqual(result['evidence_omitted'], 0)
        self.assertIn('Supplied feed items only', result['basis'])

    def test_deterministic(self) -> None:
        self.assertEqual(run(), run())


class MatchingTests(unittest.TestCase):
    def test_case_insensitive_whole_words_in_the_text(self) -> None:
        self.assertEqual(one('We tasted OOLONG, then left.')['counts']['matched'], 1)
        self.assertEqual(one('Oolongs are lovely.')['counts']['matched'], 0)
        self.assertEqual(one('pre-oolong ritual')['counts']['matched'], 1)
        self.assertEqual(one('super_oolong')['counts']['matched'], 0)

    def test_the_title_matches_too(self) -> None:
        result = one(title='All about Oolong')
        self.assertEqual(result['counts']['matched'], 1)
        self.assertEqual(result['evidence'][0]['title'], 'All about Oolong')

    def test_title_and_text_matches_are_combined(self) -> None:
        result = one('Gongfu brewing.', title='Oolong', terms=['oolong', 'gongfu', 'matcha'])
        self.assertEqual(result['evidence'][0]['matched_terms'], ['oolong', 'gongfu'])

    def test_a_phrase_matches_across_whitespace_and_case(self) -> None:
        self.assertEqual(one('Cold\n  Brew oolong is nice', terms=['cold brew'])['counts']['matched'], 1)
        self.assertEqual(one('cold-brew', terms=['cold brew'])['counts']['matched'], 0)

    def test_casefolding_handles_non_ascii(self) -> None:
        self.assertEqual(one('Die STRASSE ist lang', terms=['straße'])['counts']['matched'], 1)

    def test_no_matches_gives_an_empty_but_complete_result(self) -> None:
        result = one('Nothing relevant here.')
        self.assertEqual(result['counts'], {'items': 1, 'matched': 0, 'unmatched': 1, 'evidence': 0})
        self.assertEqual(result['evidence'], [])
        self.assertEqual(result['evidence_omitted'], 0)

    def test_terms_are_deduplicated_ignoring_case_and_keep_the_first_spelling(self) -> None:
        result = one('oolong', terms=['Oolong', 'oolong', ' OOLONG '])
        self.assertEqual(result['terms'], ['Oolong'])
        self.assertEqual(result['evidence'][0]['text'], 'Matched "Oolong" in supplied item item-1.')

    def test_more_than_three_terms_are_summarized(self) -> None:
        result = one('a b c d e', terms=['a', 'b', 'c', 'd', 'e'])
        self.assertEqual(result['evidence'][0]['text'], 'Matched "a", "b", "c" and 2 more in supplied item item-1.')
        self.assertEqual(result['evidence'][0]['matched_terms'], ['a', 'b', 'c', 'd', 'e'])

    def test_evidence_is_ordered_by_matches_then_input_order(self) -> None:
        items = [
            {'id': 'one-term-first', 'content_text': 'oolong'},
            {'id': 'none', 'content_text': 'nothing'},
            {'id': 'two-terms', 'content_text': 'oolong gongfu'},
            {'id': 'one-term-second', 'content_text': 'gongfu'},
        ]
        result = run(terms=['oolong', 'gongfu'], items=items)
        self.assertEqual([record['item_id'] for record in result['evidence']], ['two-terms', 'one-term-first', 'one-term-second'])
        self.assertEqual(result['counts'], {'items': 4, 'matched': 3, 'unmatched': 1, 'evidence': 3})

    def test_a_missing_title_falls_back_to_the_item_id(self) -> None:
        self.assertEqual(one('oolong')['evidence'][0]['title'], 'Item item-1')

    def test_title_only_items_are_accepted(self) -> None:
        result = one(title='Oolong day')
        self.assertEqual(result['counts']['matched'], 1)

    def test_json_feed_extras_are_ignored(self) -> None:
        item = {'id': 'f1', 'title': 'Oolong', 'content_html': '<p>x</p>', 'date_published': '2026-10-01T00:00:00Z',
                'authors': [{'name': 'A. Writer'}], 'tags': ['tea'], 'language': 'en'}
        self.assertEqual(run(terms=['oolong'], items=[item])['counts']['matched'], 1)

    def test_evidence_listing_is_capped_but_counts_are_complete(self) -> None:
        items = [{'id': f'i{index}', 'content_text': 'oolong'} for index in range(400)]
        result = run(terms=['oolong'], items=items)
        self.assertEqual(len(result['evidence']), 300)
        self.assertEqual(result['evidence_omitted'], 100)
        self.assertEqual(result['counts'], {'items': 400, 'matched': 400, 'unmatched': 0, 'evidence': 300})

    def test_the_input_is_not_modified(self) -> None:
        data = copy.deepcopy(SAMPLES['x-intelligence'])
        before = copy.deepcopy(data)
        x_intelligence.run(data, now=NOW)
        self.assertEqual(data, before)


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(**overrides)
        self.assertEqual(str(caught.exception), message)

    def test_items_list(self) -> None:
        message = 'items must be a list of 1–5,000 feed items'
        self.assertRejects(message, items=[])
        self.assertRejects(message, items='nope')
        self.assertRejects(message, items=None)
        self.assertRejects(message, items=[{'id': str(index), 'content_text': 'x'} for index in range(5_001)])
        with self.assertRaisesRegex(ValueError, '^items must be a list'):
            x_intelligence.run({'topic': 't', 'terms': ['a']}, now=NOW)

    def test_the_items_ceiling_is_accepted(self) -> None:
        result = run(items=[{'id': str(index), 'content_text': 'oolong'} for index in range(5_000)])
        self.assertEqual(result['counts']['items'], 5_000)

    def test_terms(self) -> None:
        self.assertRejects('terms must be a list of 1–50 non-empty terms', terms=[])
        self.assertRejects('terms must be a list of 1–50 non-empty terms', terms='oolong')
        self.assertRejects('terms must be a list of 1–50 non-empty terms', terms=[str(index) for index in range(51)])
        self.assertRejects('terms entry 2 cannot be blank', terms=['oolong', '  '])
        self.assertRejects('terms entry 1 must be text', terms=[5])
        self.assertRejects('terms entry 1 must be at most 100 characters', terms=['t' * 101])
        self.assertRejects('terms may hold at most 600 characters in total', terms=['t' * 99 + str(index) for index in range(7)])

    def test_fifty_terms_are_accepted(self) -> None:
        self.assertEqual(len(run(terms=[f'term{index}' for index in range(50)])['terms']), 50)

    def test_topic(self) -> None:
        self.assertRejects('topic cannot be blank', topic='   ')
        self.assertRejects('topic must be text', topic=None)
        self.assertRejects('topic must be at most 200 characters', topic='t' * 201)

    def test_items(self) -> None:
        self.assertRejects('item 1 must be an object with an id and text', items=['text'])
        self.assertRejects('item 1: id must be text', items=[{'content_text': 'x'}])
        self.assertRejects('item 1: id cannot be blank', items=[{'id': ' ', 'content_text': 'x'}])
        self.assertRejects('item 1: id must be at most 100 characters', items=[{'id': 'i' * 101, 'content_text': 'x'}])
        self.assertRejects('item 2 needs a title or content_text', items=[{'id': 'a', 'content_text': 'x'}, {'id': 'b'}])
        self.assertRejects('item 1 needs a title or content_text', items=[{'id': 'a', 'content_text': ' ', 'title': ''}])
        self.assertRejects('item 1: content_text must be text', items=[{'id': 'a', 'content_text': 4}])
        self.assertRejects('item 1: content_text must be at most 20,000 characters', items=[{'id': 'a', 'content_text': 'c' * 20_001}])
        self.assertRejects('item 1: title must be at most 200 characters', items=[{'id': 'a', 'title': 't' * 201}])
        self.assertRejects('item id "a" is used more than once', items=[{'id': 'a', 'title': 'x'}, {'id': 'a', 'title': 'y'}])

    def test_item_urls_must_be_http_or_https(self) -> None:
        message = 'item 1: url must be an http or https URL of at most 500 characters'
        for url in ('ftp://example.invalid/a', 'javascript:alert(1)', 'example.invalid', 'https://user:pw@example.invalid/',
                    'https://example.invalid/' + 'a' * 500, 5, ' padded https://example.invalid/'):
            with self.subTest(url=url):
                self.assertRejects(message, items=[{'id': 'a', 'title': 'x', 'url': url}])
        ok = run(items=[{'id': 'a', 'title': 'oolong', 'url': 'http://example.invalid/Path?x=1'}])
        self.assertEqual(ok['evidence'][0]['url'], 'http://example.invalid/Path?x=1')

    def test_null_or_blank_optional_values_are_treated_as_absent(self) -> None:
        for url in (None, '', '   '):
            with self.subTest(url=url):
                result = run(terms=['oolong'], items=[{'id': 'a', 'title': 'oolong', 'content_text': None, 'url': url}])
                self.assertNotIn('url', result['evidence'][0])


if __name__ == '__main__':
    unittest.main()
