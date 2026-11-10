"""Creator fit: topic overlap with explicit missing-evidence reasons."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, creator_relationships

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
AS_OF = '2026-10-01T12:00:00Z'


def creator(handle: str = 'c1', topics: object = None, **extra: object) -> dict:
    return {'handle': handle, 'topics': ['tea'] if topics is None else topics, **extra}


def run(*creators: dict, **overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['creator-relationships'])
    if creators:
        data['batch'] = {'account_id': 'fixture-account', 'creators': list(creators)}
    data.update(overrides)
    return creator_relationships.run(data, now=NOW)


def only(*creators: dict, **overrides: object) -> dict:
    return run(*creators, **overrides)['creators'][0]


class SampleTests(unittest.TestCase):
    def test_sample_result(self) -> None:
        result = creator_relationships.run(copy.deepcopy(SAMPLES['creator-relationships']), now=NOW)
        self.assertEqual((result['account_id'], result['as_of']), ('fixture-account', AS_OF))
        self.assertEqual(result['niche_topics'], ['tea', 'slow mornings'])
        self.assertEqual(result['brand_topics'], ['tea'])
        self.assertEqual(result['counts'], {'creators': 2, 'strong_fit': 0, 'possible_fit': 0, 'needs_evidence': 1, 'weak_fit': 1})
        self.assertEqual([entry['handle'] for entry in result['creators']], ['fixture-creator-a', 'fixture-creator-b'])
        a, b = result['creators']
        self.assertEqual((a['status'], a['niche_matches'], a['brand_matches'], a['age_days']), ('needs_evidence', ['tea'], ['tea'], None))
        self.assertEqual(a['missing_evidence'], {'last_post_at': 'not supplied', 'followers': 'not supplied', 'audience_location': 'not supplied'})
        self.assertEqual((b['status'], b['niche_matches'], b['brand_matches']), ('weak_fit', [], []))
        self.assertIn('policy', result)
        self.assertIn('No creator was looked up or contacted', result['basis'])

    def test_every_creator_has_the_fields_the_summary_reads(self) -> None:
        for entry in creator_relationships.run(copy.deepcopy(SAMPLES['creator-relationships']), now=NOW)['creators']:
            self.assertIsInstance(entry['handle'], str)
            self.assertIn(entry['status'], ('strong_fit', 'possible_fit', 'weak_fit', 'needs_evidence'))
            self.assertIsInstance(entry['niche_matches'], list)
            self.assertIsInstance(entry['missing_evidence'], dict)
            self.assertTrue(entry['age_days'] is None or isinstance(entry['age_days'], float))
            self.assertTrue(all(value in ('not supplied', 'dated after as_of') for value in entry['missing_evidence'].values()))

    def test_policy_states_how_status_is_decided(self) -> None:
        policy = creator_relationships.run(copy.deepcopy(SAMPLES['creator-relationships']), now=NOW)['policy']
        for key in ('basis', 'strong_fit', 'possible_fit', 'needs_evidence', 'weak_fit'):
            self.assertIsInstance(policy[key], str)
        self.assertEqual((policy['required_evidence'], policy['reported_evidence'], policy['stale_after_days']),
                         (['topics', 'last_post_at'], ['followers', 'audience_location'], 90))

    def test_deterministic(self) -> None:
        self.assertEqual(run(), run())


class StatusTests(unittest.TestCase):
    def test_strong_fit_with_a_brand_match_and_recent_activity(self) -> None:
        entry = only(creator(last_post_at='2026-09-27T23:59:00Z'), niche_topics=['tea', 'a', 'b', 'c'])
        self.assertEqual((entry['status'], entry['age_days']), ('strong_fit', 3.5))
        self.assertEqual(entry['missing_evidence'], {'followers': 'not supplied', 'audience_location': 'not supplied'})

    def test_strong_fit_with_half_of_the_niche_topics_and_no_brand_topics(self) -> None:
        entry = only(creator(topics=['tea', 'slow mornings']), niche_topics=['tea', 'slow mornings', 'cycling', 'books'],
                     brand_topics=[])
        self.assertEqual(entry['status'], 'needs_evidence')
        fresh = only(creator(topics=['tea', 'slow mornings'], last_post_at='2026-09-30T12:00:00Z'),
                     niche_topics=['tea', 'slow mornings', 'cycling', 'books'], brand_topics=[])
        self.assertEqual(fresh['status'], 'strong_fit')

    def test_possible_fit_with_a_weak_overlap(self) -> None:
        entry = only(creator(topics=['tea'], last_post_at='2026-09-30T12:00:00Z'), niche_topics=['tea', 'a', 'b', 'c'], brand_topics=['coffee'])
        self.assertEqual(entry['status'], 'possible_fit')
        self.assertIn('Matches fewer than half of the niche topics and no brand topic.', entry['reasons'][-1])

    def test_stale_activity_caps_the_fit_at_possible(self) -> None:
        for days, expected in ((90, 'strong_fit'), (91, 'possible_fit')):
            with self.subTest(days=days):
                moment = datetime(2026, 10, 1, 12, tzinfo=timezone.utc).timestamp() - days * 86_400
                stamp = datetime.fromtimestamp(moment, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                self.assertEqual(only(creator(last_post_at=stamp))['status'], expected)
        stale = only(creator(last_post_at='2026-05-01T12:00:00Z'))
        self.assertIn('more than 90', stale['reasons'][-1])

    def test_a_niche_match_without_activity_evidence_needs_evidence(self) -> None:
        entry = only(creator())
        self.assertEqual((entry['status'], entry['age_days']), ('needs_evidence', None))
        self.assertIn('no usable last_post_at was supplied', entry['reasons'][-1])

    def test_activity_dated_after_as_of_is_not_used(self) -> None:
        entry = only(creator(last_post_at='2026-10-02T00:00:00Z'))
        self.assertEqual((entry['status'], entry['age_days']), ('needs_evidence', None))
        self.assertEqual(entry['missing_evidence']['last_post_at'], 'dated after as_of')

    def test_no_topics_needs_evidence(self) -> None:
        for topics in ([], None):
            with self.subTest(topics=topics):
                data = {'handle': 'c1'} if topics is None else creator(topics=topics)
                entry = only(data)
                self.assertEqual((entry['status'], entry['niche_matches']), ('needs_evidence', []))
                self.assertEqual(entry['missing_evidence']['topics'], 'not supplied')
                self.assertIn('fit cannot be assessed', entry['reasons'][0])

    def test_no_niche_match_is_a_weak_fit_whatever_the_evidence(self) -> None:
        entry = only(creator(topics=['cycling'], last_post_at='2026-09-30T12:00:00Z', followers=10, audience_location='NZ'))
        self.assertEqual((entry['status'], entry['missing_evidence']), ('weak_fit', {}))

    def test_a_brand_only_match_is_not_a_niche_match(self) -> None:
        entry = only(creator(topics=['coffee']), niche_topics=['tea'], brand_topics=['coffee'])
        self.assertEqual((entry['status'], entry['niche_matches'], entry['brand_matches']), ('weak_fit', [], ['coffee']))


class TopicMatchingTests(unittest.TestCase):
    def matches(self, topics: list[str], niche: list[str]) -> list[str]:
        return only(creator(topics=topics), niche_topics=niche)['niche_matches']

    def test_equal_and_contained_topics_match_ignoring_case(self) -> None:
        self.assertEqual(self.matches(['TEA'], ['tea']), ['tea'])
        self.assertEqual(self.matches(['iced tea recipes'], ['tea']), ['tea'])
        self.assertEqual(self.matches(['Slow  Mornings'], ['slow mornings']), ['slow mornings'])

    def test_partial_words_do_not_match(self) -> None:
        self.assertEqual(self.matches(['teapot', 'steam'], ['tea']), [])

    def test_matches_follow_the_niche_topic_order_and_spelling(self) -> None:
        self.assertEqual(self.matches(['b topic', 'a topic'], ['A Topic', 'B Topic', 'c']), ['A Topic', 'B Topic'])

    def test_duplicate_niche_topics_collapse(self) -> None:
        result = run(creator(), niche_topics=['Tea', 'tea ', 'other'])
        self.assertEqual(result['niche_topics'], ['Tea', 'other'])


class OrderingTests(unittest.TestCase):
    def test_sorted_by_fit_then_matches_then_handle(self) -> None:
        fresh = '2026-09-30T12:00:00Z'
        result = run(
            creator('weak', ['cycling'], last_post_at=fresh),
            creator('needs-b'),
            creator('possible-b', ['tea'], last_post_at=fresh),
            creator('needs-a'),
            creator('possible', ['tea'], last_post_at=fresh),
            creator('strong-a', ['tea', 'slow mornings'], last_post_at=fresh),
            creator('Possible-c', ['tea'], last_post_at=fresh),
            niche_topics=['tea', 'slow mornings', 'x', 'y', 'z'], brand_topics=['slow mornings'],
        )
        self.assertEqual([(entry['handle'], entry['status']) for entry in result['creators']], [
            ('strong-a', 'strong_fit'),
            ('possible', 'possible_fit'), ('possible-b', 'possible_fit'), ('Possible-c', 'possible_fit'),
            ('needs-a', 'needs_evidence'), ('needs-b', 'needs_evidence'),
            ('weak', 'weak_fit'),
        ])

    def test_counts_by_status(self) -> None:
        result = run(creator('a', last_post_at='2026-09-30T12:00:00Z'), creator('b'), creator('c', ['cycling']))
        self.assertEqual(result['counts'], {'creators': 3, 'strong_fit': 1, 'possible_fit': 0, 'needs_evidence': 1, 'weak_fit': 1})


class DatesAndOptionalFieldsTests(unittest.TestCase):
    def test_age_is_exact_utc_elapsed_time_across_a_dst_change(self) -> None:
        entry = only(creator(last_post_at='2026-03-07T12:00:00-05:00'), as_of='2026-03-08T12:00:00-04:00')
        self.assertEqual(entry['age_days'], round(23 / 24, 2))

    def test_age_is_a_float_with_two_places(self) -> None:
        entry = only(creator(last_post_at='2026-09-30T12:00:00Z'))
        self.assertEqual(entry['age_days'], 1.0)
        self.assertIsInstance(entry['age_days'], float)
        self.assertEqual(only(creator(last_post_at='2026-10-01T09:00:00Z'))['age_days'], 0.12)

    def test_supplied_optional_fields_are_echoed_and_no_longer_missing(self) -> None:
        entry = only(creator(name='Fixture Creator', followers=1234, audience_location='Nowhere, Fictionland', last_post_at='2026-09-30T12:00:00Z'))
        self.assertEqual((entry['name'], entry['followers'], entry['audience_location']), ('Fixture Creator', 1234, 'Nowhere, Fictionland'))
        self.assertEqual(entry['missing_evidence'], {})
        self.assertNotIn('name', only(creator()))

    def test_unknown_creator_keys_are_ignored(self) -> None:
        self.assertEqual(run(creator(email='ignored@example.invalid', bio='ignored')), run(creator()))

    def test_brand_topics_are_optional(self) -> None:
        data = copy.deepcopy(SAMPLES['creator-relationships'])
        del data['brand_topics']
        result = creator_relationships.run(data, now=NOW)
        self.assertEqual(result['brand_topics'], [])
        self.assertEqual(result['creators'][0]['brand_matches'], [])


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, *creators: dict, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(*creators, **overrides)
        self.assertEqual(str(caught.exception), message)

    def test_batch(self) -> None:
        self.assertRejects('batch must be an object with an account_id and creators', batch=None)
        self.assertRejects('batch must be an object with an account_id and creators', batch=[creator()])
        self.assertRejects('batch account_id must be text', batch={'creators': [creator()]})
        self.assertRejects('batch account_id cannot be blank', batch={'account_id': ' ', 'creators': [creator()]})
        self.assertRejects('batch account_id must be at most 100 characters', batch={'account_id': 'a' * 101, 'creators': [creator()]})
        self.assertRejects('batch creators must be a list of 1–200 creators', batch={'account_id': 'a'})
        self.assertRejects('batch creators must be a list of 1–200 creators', batch={'account_id': 'a', 'creators': []})
        self.assertRejects('batch creators must be a list of 1–200 creators',
                           batch={'account_id': 'a', 'creators': [creator(f'c{index}') for index in range(201)]})

    def test_the_creators_ceiling_is_accepted(self) -> None:
        self.assertEqual(run(*[creator(f'c{index}') for index in range(200)])['counts']['creators'], 200)

    def test_creator_shape(self) -> None:
        self.assertRejects('creator 1 must be an object with a handle and topics', 'text')
        self.assertRejects('creator 1: handle must be text', {'topics': ['tea']})
        self.assertRejects('creator 1: handle cannot be blank', creator(' '))
        self.assertRejects('creator 1: handle must be at most 100 characters', creator('h' * 101))
        self.assertRejects('creator 1: name must be at most 200 characters', creator(name='n' * 201))
        self.assertRejects('creator 1: topics must be a list of up to 50 topics', creator(topics='tea'))
        self.assertRejects('creator 1: topics must be a list of up to 50 topics', creator(topics=[str(index) for index in range(51)]))
        self.assertRejects('creator 1: topics entry 1 must be text', creator(topics=[3]))
        self.assertRejects('creator 1: topics entry 1 must be at most 100 characters', creator(topics=['t' * 101]))
        self.assertRejects('creator 1: audience_location must be at most 200 characters', creator(audience_location='a' * 201))
        for bad in (-1, 1.5, '10', True, 10 ** 10 + 1):
            with self.subTest(followers=bad):
                self.assertRejects('creator 1: followers must be a whole number from 0 to 10,000,000,000', creator(followers=bad))
        self.assertRejects('creator 1: last_post_at must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z',
                           creator(last_post_at='2026-09-30'))
        self.assertRejects('creator handle "C1" is used more than once', creator('c1'), creator('C1'))

    def test_topic_lists(self) -> None:
        self.assertRejects('niche_topics must be a list of 1–50 topics', niche_topics=[])
        self.assertRejects('niche_topics must be a list of 1–50 topics', niche_topics=None)
        self.assertRejects('niche_topics must be a list of 1–50 topics', niche_topics='tea')
        self.assertRejects('niche_topics must be a list of 1–50 topics', niche_topics=[str(index) for index in range(51)])
        self.assertRejects('niche_topics entry 1 cannot be blank', niche_topics=[' '])
        self.assertRejects('niche_topics entry 1 must be at most 80 characters', niche_topics=['t' * 81])
        self.assertRejects('niche_topics may hold at most 600 characters in total', niche_topics=['t' * 78 + str(index % 10) + chr(97 + index) for index in range(8)])
        self.assertRejects('brand_topics must be a list of up to 50 topics', brand_topics='tea')
        self.assertRejects('brand_topics entry 1 must be text', brand_topics=[5])

    def test_as_of(self) -> None:
        message = 'as_of must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z'
        for value in ('2026-10-01', '2026-10-01T12:00:00', 'today', None):
            with self.subTest(value=value):
                self.assertRejects(message, as_of=value)


if __name__ == '__main__':
    unittest.main()
