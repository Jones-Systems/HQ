"""Search visibility: counts over supplied answer observations."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, search_visibility

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
STEEPING = 'https://example.invalid/steeping'


def run(**overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['search-visibility'])
    data.update(overrides)
    return search_visibility.run(data, now=NOW)


def answer(query: str = 'how long to steep oolong', engine: str = 'fixture-engine', cited: list[str] | None = None, **extra: object) -> dict:
    return {'query': query, 'engine': engine, 'cited': [STEEPING] if cited is None else cited, **extra}


class SampleTests(unittest.TestCase):
    def test_sample_facts(self) -> None:
        result = search_visibility.run(copy.deepcopy(SAMPLES['search-visibility']), now=NOW)
        self.assertEqual(result['panel'], 'Fictional tea questions')
        self.assertEqual((result['queries'], result['answers'], result['answers_in_panel'], result['answers_outside_panel']), (1, 1, 1, 0))
        self.assertEqual(result['engines'], [{'engine': 'fixture-engine', 'answers': 1, 'answers_with_citations': 1}])
        self.assertEqual(result['citations'], [{'url': STEEPING, 'count': 1, 'in_inventory': True, 'title': 'Steeping guide'}])
        self.assertEqual(result['coverage'], {'queries_with_inventory_citation': 1, 'queries': 1, 'ratio': 1.0})
        self.assertEqual((result['queries_covered'], result['coverage_ratio']), (1, 1.0))
        self.assertEqual(result['entity_mentions'], [{'name': 'Larkspur Tea Co.', 'kind': 'brand', 'answers_mentioning': 0, 'queries_mentioning': 0}])
        self.assertEqual((result['inventory_urls'], result['inventory_cited'], result['uncited_inventory']), (1, 1, []))
        self.assertEqual(result['answers_without_text'], 1)
        self.assertIn('No search engine was queried', result['basis'])

    def test_deterministic(self) -> None:
        self.assertEqual(run(), run())


class CoverageTests(unittest.TestCase):
    PANEL = {'name': 'p', 'queries': ['q one', 'q two', 'q three']}

    def test_coverage_counts_queries_with_an_inventory_citation(self) -> None:
        result = run(panel=self.PANEL, answers=[
            answer('q one', cited=[STEEPING]),
            answer('q two', cited=['https://other.invalid/page']),
            answer('q three', cited=[]),
        ])
        self.assertEqual(result['coverage'], {'queries_with_inventory_citation': 1, 'queries': 3, 'ratio': round(1 / 3, 4)})
        self.assertEqual([(row['query'], row['covered']) for row in result['query_coverage']], [('q one', True), ('q two', False), ('q three', False)])

    def test_a_query_with_no_answers_is_listed_and_not_covered(self) -> None:
        result = run(panel=self.PANEL, answers=[answer('q one')])
        self.assertEqual(result['query_coverage'][1], {'query': 'q two', 'answers': 0, 'engine_count': 0, 'engines': [], 'inventory_cited_answers': 0, 'covered': False})

    def test_one_covering_answer_among_several_is_enough(self) -> None:
        result = run(answers=[answer(cited=[]), answer(engine='b', cited=[STEEPING]), answer(engine='c', cited=['https://other.invalid/'])])
        self.assertEqual(result['coverage']['queries_with_inventory_citation'], 1)
        self.assertEqual(result['query_coverage'][0]['inventory_cited_answers'], 1)
        self.assertEqual(result['query_coverage'][0]['engine_count'], 3)

    def test_cited_urls_are_compared_in_normalized_form(self) -> None:
        result = run(answers=[answer(cited=['HTTPS://Example.INVALID/steeping/#top'])])
        self.assertEqual(result['citations'], [{'url': STEEPING, 'count': 1, 'in_inventory': True, 'title': 'Steeping guide'}])
        self.assertEqual(result['coverage']['queries_with_inventory_citation'], 1)

    def test_a_url_repeated_inside_one_answer_counts_once(self) -> None:
        result = run(answers=[answer(cited=[STEEPING, STEEPING + '/'])])
        self.assertEqual(result['citations'][0]['count'], 1)

    def test_queries_match_ignoring_case_and_spacing(self) -> None:
        result = run(answers=[answer('  How LONG to   steep OOLONG ')])
        self.assertEqual((result['answers_in_panel'], result['answers_outside_panel']), (1, 0))

    def test_answers_outside_the_panel_are_counted_and_excluded(self) -> None:
        result = run(answers=[answer(), answer('unrelated question', cited=['https://other.invalid/x'])])
        self.assertEqual((result['answers'], result['answers_in_panel'], result['answers_outside_panel']), (2, 1, 1))
        self.assertEqual([row['url'] for row in result['citations']], [STEEPING])

    def test_duplicate_panel_queries_collapse(self) -> None:
        result = run(panel={'name': 'p', 'queries': ['Same', 'same ', 'other']})
        self.assertEqual(result['queries'], 2)

    def test_citations_are_ordered_by_count_then_url(self) -> None:
        result = run(inventory=[], answers=[
            answer(engine='a', cited=['https://b.invalid/', 'https://a.invalid/']),
            answer(engine='b', cited=['https://c.invalid/', 'https://a.invalid/']),
            answer(engine='c', cited=['https://a.invalid/']),
        ])
        self.assertEqual([(row['url'], row['count'], row['in_inventory']) for row in result['citations']],
                         [('https://a.invalid/', 3, False), ('https://b.invalid/', 1, False), ('https://c.invalid/', 1, False)])
        self.assertEqual((result['citations_total'], result['citations_unique']), (5, 3))
        self.assertEqual(result['coverage']['ratio'], 0.0)

    def test_inventory_pages_never_cited_are_listed(self) -> None:
        result = run(inventory=[{'url': STEEPING, 'title': 'Steeping guide'}, {'url': 'https://example.invalid/zeta'},
                                {'url': 'https://example.invalid/alpha', 'title': 'Alpha'}])
        self.assertEqual(result['uncited_inventory'], [{'url': 'https://example.invalid/alpha', 'title': 'Alpha'}, {'url': 'https://example.invalid/zeta'}])
        self.assertEqual((result['inventory_urls'], result['inventory_cited']), (3, 1))

    def test_duplicate_inventory_pages_keep_the_first_title(self) -> None:
        result = run(inventory=[{'url': STEEPING, 'title': 'First'}, {'url': STEEPING + '/', 'title': 'Second'}])
        self.assertEqual(result['inventory_urls'], 1)
        self.assertEqual(result['citations'][0]['title'], 'First')

    def test_engines_are_grouped_ignoring_case_and_sorted(self) -> None:
        result = run(answers=[answer(engine='Zed', cited=[]), answer(engine='alpha'), answer(engine='ALPHA', cited=[]), answer(engine='Beta')])
        self.assertEqual(result['engines'], [
            {'engine': 'alpha', 'answers': 2, 'answers_with_citations': 1},
            {'engine': 'Beta', 'answers': 1, 'answers_with_citations': 1},
            {'engine': 'Zed', 'answers': 1, 'answers_with_citations': 0}])

    def test_per_query_engine_list_is_capped_but_counted(self) -> None:
        result = run(answers=[answer(engine=f'engine-{index}') for index in range(8)])
        self.assertEqual(result['query_coverage'][0]['engine_count'], 8)
        self.assertEqual(result['query_coverage'][0]['engines'], [f'engine-{index}' for index in range(5)])

    def test_citation_listing_is_capped_but_totals_are_complete(self) -> None:
        answers = [answer(engine=f'e{index}', cited=[f'https://example.invalid/u{index}-{n}' for n in range(50)]) for index in range(5)]
        result = run(inventory=[], answers=answers)
        self.assertEqual((len(result['citations']), result['citations_unique'], result['citations_omitted']), (150, 250, 100))
        self.assertEqual(result['citations_total'], 250)


class EntityTests(unittest.TestCase):
    def test_mentions_are_counted_from_answer_text(self) -> None:
        result = run(
            panel={'name': 'p', 'queries': ['q one', 'q two']},
            entities=[{'name': 'Larkspur Tea Co.', 'kind': 'brand'}, {'name': 'Rival Leaf', 'kind': 'competitor'}, {'name': 'Nobody', 'kind': 'brand'}],
            answers=[
                answer('q one', text='Try LARKSPUR tea co. for oolong. Rival Leaf is pricier.'),
                answer('q one', engine='b', text='Larkspur Tea Co. again.'),
                answer('q two', text='Larkspur Tea Co. and more'),
                answer('q two', engine='b', text='No names here.'),
                answer('q two', engine='c'),
            ])
        mentions = {row['name']: row for row in result['entity_mentions']}
        self.assertEqual((mentions['Larkspur Tea Co.']['answers_mentioning'], mentions['Larkspur Tea Co.']['queries_mentioning']), (3, 2))
        self.assertEqual((mentions['Rival Leaf']['answers_mentioning'], mentions['Rival Leaf']['queries_mentioning']), (1, 1))
        self.assertEqual(mentions['Nobody']['answers_mentioning'], 0)
        self.assertEqual([row['name'] for row in result['entity_mentions']], ['Larkspur Tea Co.', 'Rival Leaf', 'Nobody'])
        self.assertEqual(result['answers_without_text'], 1)

    def test_entities_match_whole_words_only(self) -> None:
        result = run(entities=[{'name': 'Lark', 'kind': 'brand'}], answers=[answer(text='Larkspur is a flower; a lark sings.')])
        self.assertEqual(result['entity_mentions'][0]['answers_mentioning'], 1)
        none = run(entities=[{'name': 'Lark', 'kind': 'brand'}], answers=[answer(text='Larkspur only')])
        self.assertEqual(none['entity_mentions'][0]['answers_mentioning'], 0)

    def test_mentions_in_answers_outside_the_panel_are_not_counted(self) -> None:
        result = run(answers=[answer('other', text='Larkspur Tea Co.')])
        self.assertEqual(result['entity_mentions'][0]['answers_mentioning'], 0)

    def test_entities_may_be_empty_and_kind_defaults(self) -> None:
        self.assertEqual(run(entities=[])['entity_mentions'], [])
        self.assertEqual(run(entities=[{'name': 'Thing'}])['entity_mentions'][0]['kind'], 'entity')

    def test_duplicate_entity_names_collapse(self) -> None:
        self.assertEqual(len(run(entities=[{'name': 'Same'}, {'name': 'same '}])['entity_mentions']), 1)


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(**overrides)
        self.assertEqual(str(caught.exception), message)

    def test_panel(self) -> None:
        self.assertRejects('panel must be an object with a name and queries', panel=None)
        self.assertRejects('panel must be an object with a name and queries', panel=['q'])
        self.assertRejects('panel name must be text', panel={'queries': ['q']})
        self.assertRejects('panel queries must be a list of 1–200 queries', panel={'name': 'p', 'queries': []})
        self.assertRejects('panel queries must be a list of 1–200 queries', panel={'name': 'p'})
        self.assertRejects('panel queries must be a list of 1–200 queries', panel={'name': 'p', 'queries': [str(index) for index in range(201)]})
        self.assertRejects('panel query 2 cannot be blank', panel={'name': 'p', 'queries': ['q', ' ']})
        self.assertRejects('panel query 1 must be at most 300 characters', panel={'name': 'p', 'queries': ['q' * 301]})
        self.assertEqual(run(panel={'name': 'p', 'queries': [f'q{index}' for index in range(200)]})['queries'], 200)

    def test_entities(self) -> None:
        self.assertRejects('entities must be a list of up to 100 entities with a name and kind', entities='brand')
        self.assertRejects('entities must be a list of up to 100 entities with a name and kind', entities=None)
        self.assertRejects('entities must be a list of up to 100 entities with a name and kind', entities=[{'name': str(index)} for index in range(101)])
        self.assertRejects('entity 1 must be an object with a name and kind', entities=['x'])
        self.assertRejects('entity 1: name must be text', entities=[{'kind': 'brand'}])
        self.assertRejects('entity 1: name must be at most 200 characters', entities=[{'name': 'n' * 201}])
        self.assertRejects('entity 1: kind must be at most 50 characters', entities=[{'name': 'n', 'kind': 'k' * 51}])

    def test_inventory(self) -> None:
        self.assertRejects('inventory must be a list of up to 2,000 pages with a url and title', inventory='x')
        self.assertRejects('inventory must be a list of up to 2,000 pages with a url and title',
                           inventory=[{'url': f'https://example.invalid/{index}'} for index in range(2_001)])
        self.assertRejects('inventory page 1 must be an object with a url and title', inventory=['https://example.invalid/'])
        self.assertRejects('inventory page 1: url must be an http or https URL', inventory=[{'title': 'x'}])
        self.assertRejects('inventory page 2: url must be an http or https URL', inventory=[{'url': STEEPING}, {'url': 'ftp://example.invalid/x'}])
        self.assertRejects('inventory page 1: title must be at most 200 characters', inventory=[{'url': STEEPING, 'title': 't' * 201}])
        self.assertEqual(run(inventory=[])['coverage']['queries_with_inventory_citation'], 0)

    def test_answers_list(self) -> None:
        message = 'answers must be a list of 1–5,000 answer observations'
        self.assertRejects(message, answers=[])
        self.assertRejects(message, answers='a')
        self.assertRejects(message, answers=None)
        self.assertRejects(message, answers=[answer()] * 5_001)
        self.assertEqual(run(answers=[answer(cited=[])] * 5_000)['answers'], 5_000)

    def test_answer_shape(self) -> None:
        self.assertRejects('answer 1 must be an object with a query, engine and cited URLs', answers=['x'])
        self.assertRejects('answer 1: query must be text', answers=[{'engine': 'e', 'cited': []}])
        self.assertRejects('answer 1: engine must be text', answers=[{'query': 'q', 'cited': []}])
        self.assertRejects('answer 1: engine must be at most 60 characters', answers=[answer(engine='e' * 61)])
        self.assertRejects('answer 1: cited must be a list of up to 50 http or https URLs', answers=[answer(cited='https://example.invalid/')])
        self.assertRejects('answer 1: cited must be a list of up to 50 http or https URLs', answers=[answer(cited=[f'https://example.invalid/{n}' for n in range(51)])])
        self.assertRejects('answer 1: cited entry 2 must be an http or https URL of at most 1,000 characters', answers=[answer(cited=[STEEPING, 'steeping'])])
        self.assertRejects('answer 1: text must be text', answers=[answer(text=5)])
        self.assertRejects('answer 1: text must be at most 20,000 characters', answers=[answer(text='t' * 20_001)])

    def test_a_missing_cited_list_means_no_citations(self) -> None:
        result = run(answers=[{'query': 'how long to steep oolong', 'engine': 'e'}])
        self.assertEqual(result['citations'], [])
        self.assertEqual(result['engines'][0]['answers_with_citations'], 0)

    def test_engine_count_is_bounded(self) -> None:
        self.assertRejects('answers may name at most 30 different engines', answers=[answer(engine=f'engine-{index}') for index in range(31)])
        self.assertEqual(len(run(answers=[answer(engine=f'engine-{index}') for index in range(30)])['engines']), 30)

    def test_unknown_keys_in_nested_documents_are_ignored(self) -> None:
        extra = {'note': 'ignored'}
        result = run(panel={'name': 'p', 'queries': ['how long to steep oolong'], **extra},
                     entities=[{'name': 'Thing', 'kind': 'brand', **extra}], inventory=[{'url': STEEPING, 'title': 't', **extra}],
                     answers=[answer(**extra)])
        self.assertEqual(result['coverage']['queries_with_inventory_citation'], 1)


if __name__ == '__main__':
    unittest.main()
