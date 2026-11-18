"""Reddit opportunities: an explained heuristic over a supplied corpus."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, reddit_opportunities

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
AS_OF = '2026-10-01T12:00:00Z'


def post(post_id: str = 'p1', title: str = 'Which oolong for a beginner?', **extra: object) -> dict:
    return {'id': post_id, 'title': title, **extra}


def run(*posts: dict, **overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['reddit-opportunities'])
    if posts:
        data['bundle'] = {'corpus': 'fixture-corpus', 'posts': list(posts)}
    data.update(overrides)
    return reddit_opportunities.run(data, now=NOW)


def only(*posts: dict, **overrides: object) -> dict:
    return run(*posts, **overrides)['analysis']['opportunities'][0]


class SampleTests(unittest.TestCase):
    def test_sample_result(self) -> None:
        result = reddit_opportunities.run(copy.deepcopy(SAMPLES['reddit-opportunities']), now=NOW)
        self.assertEqual(result['profile'], 'example-tea-shop (illustrative profile; rankings apply to that profile)')
        self.assertEqual(result['import'], {'corpus': 'fixture-corpus', 'posts': 1})
        self.assertEqual(result['as_of'], AS_OF)
        self.assertEqual(result['opportunities_found'], 1)
        (opportunity,) = result['analysis']['opportunities']
        self.assertEqual((opportunity['id'], opportunity['title']), ('fixture-post-1', 'Which oolong for a beginner?'))
        self.assertEqual(opportunity['score'], 0.575)
        self.assertEqual(opportunity['matched_terms'], ['oolong'])
        self.assertEqual(opportunity['reasons'], [
            'Question form: title is phrased as a question (+0.35).',
            'Profile relevance: title mentions "oolong" (+0.23).',
            'Recency: no created_at was supplied, so recency is not scored (+0.00).',
        ])
        self.assertEqual(result['analysis']['considered'], 1)
        self.assertIn('No Reddit access', result['basis'])

    def test_deterministic(self) -> None:
        self.assertEqual(run(), run())


class ScoringTests(unittest.TestCase):
    def test_all_three_components_are_added_with_their_weights(self) -> None:
        opportunity = only(post(created_at='2026-09-30T12:00:00Z'))
        # question 1.0 * 0.35 + relevance 0.5 * 0.45 + recency (1 - 1/30) * 0.20
        self.assertEqual(opportunity['score'], round(0.35 + 0.225 + 0.2 * (1 - 1 / 30), 3))
        self.assertEqual(opportunity['age_days'], 1.0)
        self.assertEqual(opportunity['reasons'][2], 'Recency: created 1.0 days before as_of (credit falls evenly to none at 30 days) (+0.19).')

    def test_score_stays_within_zero_and_one(self) -> None:
        opportunity = only(post('p', 'Which tea, oolong, matcha or kettle?', body='teapot gongfu brewing', created_at=AS_OF))
        self.assertLessEqual(opportunity['score'], 1.0)
        self.assertGreater(opportunity['score'], 0.9)

    def test_question_forms(self) -> None:
        cases = {
            'Is oolong good': ('title opens with the question word "is"', 0.6),
            'Looking for oolong': ('title asks for help or recommendations ("looking for")', 0.6),
            'Need advice on oolong': ('title asks for help or recommendations ("advice")', 0.6),
            'Oolong brewing log': ('no question form in the title or body', 0.0),
        }
        for title, (reason, weight) in cases.items():
            with self.subTest(title=title):
                opportunity = only(post('p', title))
                self.assertEqual(opportunity['reasons'][0], f'Question form: {reason} (+{0.35 * weight:.2f}).')

    def test_a_question_in_the_body_earns_partial_credit(self) -> None:
        opportunity = only(post('p', 'Oolong brewing log', body='Anyone know why it tastes bitter?'))
        self.assertEqual(opportunity['reasons'][0], 'Question form: the body contains a question (+0.10).')

    def test_title_matches_outweigh_body_only_matches(self) -> None:
        in_title = only(post('a', 'Oolong notes'))
        in_body = only(post('b', 'Notes', body='about oolong'))
        self.assertGreater(in_title['score'], in_body['score'])
        self.assertEqual(in_body['reasons'][1], 'Profile relevance: body mentions "oolong" (+0.11).')

    def test_relevance_saturates_at_four_points(self) -> None:
        opportunity = only(post('a', 'oolong matcha', body='kettle teapot'))
        self.assertEqual(opportunity['reasons'][1], 'Profile relevance: title mentions "oolong" and "matcha"; body mentions "teapot" and "kettle" (+0.45).')

    def test_recency_cases(self) -> None:
        fresh = only(post(created_at=AS_OF))
        self.assertEqual(fresh['reasons'][2], 'Recency: created 0.0 days before as_of (credit falls evenly to none at 30 days) (+0.20).')
        old = only(post(created_at='2026-08-01T12:00:00Z'))
        self.assertEqual(old['reasons'][2], 'Recency: created 61.0 days before as_of (credit falls evenly to none at 30 days) (+0.00).')
        future = only(post(created_at='2026-10-02T12:00:00Z'))
        self.assertEqual(future['reasons'][2], 'Recency: created_at is after as_of, so recency is not scored (+0.00).')
        self.assertNotIn('age_days', future)

    def test_recency_uses_exact_utc_time_across_a_dst_change(self) -> None:
        # 12:00 EST on 7 March to 12:00 EDT on 8 March is 23 real hours.
        opportunity = only(post(created_at='2026-03-07T12:00:00-05:00'), as_of='2026-03-08T12:00:00-04:00')
        self.assertEqual(opportunity['age_days'], round(23 / 24, 2))

    def test_offsets_are_normalized(self) -> None:
        a = only(post(created_at='2026-09-30T14:00:00+02:00'))
        b = only(post(created_at='2026-09-30T12:00:00Z'))
        self.assertEqual((a['score'], a['age_days']), (b['score'], b['age_days']))

    def test_context_fields_are_echoed_but_not_scored(self) -> None:
        plain = only(post())
        rich = only(post(subreddit='r/tea', score=-3, comments=12, created_at=None))
        self.assertEqual(plain['score'], rich['score'])
        self.assertEqual((rich['subreddit'], rich['engagement']), ('r/tea', {'score': -3, 'comments': 12}))
        self.assertNotIn('engagement', plain)


class RankingTests(unittest.TestCase):
    def test_only_profile_relevant_posts_are_opportunities(self) -> None:
        result = run(post('a', 'Which oolong?'), post('b', 'Which bike?'), post('c', 'Cycling shoes', body='tea once'))
        self.assertEqual([item['id'] for item in result['analysis']['opportunities']], ['a', 'c'])
        self.assertEqual((result['analysis']['considered'], result['analysis']['relevant'], result['analysis']['not_relevant']), (3, 2, 1))
        self.assertEqual(result['import'], {'corpus': 'fixture-corpus', 'posts': 3})

    def test_no_relevant_posts_gives_an_empty_list(self) -> None:
        result = run(post('a', 'Which bike?'))
        self.assertEqual(result['analysis']['opportunities'], [])
        self.assertEqual(result['opportunities_found'], 0)

    def test_ordered_by_score_then_id(self) -> None:
        result = run(post('c', 'Oolong notes'), post('b', 'Which oolong?'), post('a', 'Oolong notes'))
        self.assertEqual([item['id'] for item in result['analysis']['opportunities']], ['b', 'a', 'c'])

    def test_whole_words_only(self) -> None:
        self.assertEqual(run(post('a', 'Steam and teams'))['analysis']['relevant'], 0)
        self.assertEqual(run(post('a', 'Gongfu-style steeping'))['analysis']['relevant'], 1)

    def test_listing_is_capped_but_counts_are_complete(self) -> None:
        result = run(*[post(f'p{index:03d}', 'Which oolong?') for index in range(250)])
        self.assertEqual(len(result['analysis']['opportunities']), 200)
        self.assertEqual((result['analysis']['omitted'], result['opportunities_found']), (50, 250))
        self.assertEqual(result['analysis']['opportunities'][0]['id'], 'p000')


class ProfileTests(unittest.TestCase):
    def test_a_supplied_profile_replaces_the_built_in_one(self) -> None:
        result = run(post('a', 'Which bike for commuting?'), profile={'name': 'Bike shop', 'terms': ['bike', 'commuting']})
        self.assertEqual(result['profile'], 'Bike shop (supplied profile; rankings apply to that profile)')
        self.assertEqual(result['profile_terms'], ['bike', 'commuting'])
        self.assertEqual(result['analysis']['opportunities'][0]['matched_terms'], ['bike', 'commuting'])
        self.assertEqual(run(post('a', 'Which oolong?'), profile={'name': 'Bike shop', 'terms': ['bike']})['analysis']['relevant'], 0)

    def test_many_matched_terms_are_summarized_in_the_reason(self) -> None:
        terms = [f'term{index}' for index in range(8)]
        opportunity = only(post('a', ' '.join(terms)), profile={'name': 'p', 'terms': terms})
        self.assertIn('"term0", "term1", "term2", "term3", "term4" and 3 more', opportunity['reasons'][1])
        self.assertEqual(len(opportunity['matched_terms']), 8)

    def test_profile_validation(self) -> None:
        for profile, message in (
            ('bike', 'profile must be an object with a name and terms'),
            ({'terms': ['a']}, 'profile name must be text'),
            ({'name': 'p'}, 'profile terms must be a list of 1–50 terms'),
            ({'name': 'p', 'terms': []}, 'profile terms must be a list of 1–50 terms'),
            ({'name': 'p', 'terms': [' ']}, 'profile terms entry 1 cannot be blank'),
            ({'name': 'p' * 101, 'terms': ['a']}, 'profile name must be at most 100 characters'),
            ({'name': 'p', 'terms': ['t' * 100] * 10 + ['u']}, 'profile terms may hold at most 1,000 characters in total'),
        ):
            with self.subTest(profile=profile), self.assertRaises(ValueError) as caught:
                run(profile=profile)
            self.assertEqual(str(caught.exception), message)


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, *posts: dict, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(*posts, **overrides)
        self.assertEqual(str(caught.exception), message)

    def test_bundle(self) -> None:
        self.assertRejects('bundle must be an object with a corpus and posts', bundle=None)
        self.assertRejects('bundle must be an object with a corpus and posts', bundle=[post()])
        self.assertRejects('bundle corpus must be text', bundle={'posts': [post()]})
        self.assertRejects('bundle corpus cannot be blank', bundle={'corpus': ' ', 'posts': [post()]})
        self.assertRejects('bundle corpus must be at most 200 characters', bundle={'corpus': 'c' * 201, 'posts': [post()]})
        self.assertRejects('bundle posts must be a list of 1–5,000 posts', bundle={'corpus': 'c'})
        self.assertRejects('bundle posts must be a list of 1–5,000 posts', bundle={'corpus': 'c', 'posts': []})
        self.assertRejects('bundle posts must be a list of 1–5,000 posts', bundle={'corpus': 'c', 'posts': [post(f'p{index}') for index in range(5_001)]})

    def test_the_posts_ceiling_is_accepted(self) -> None:
        result = run(*[post(f'p{index}', 'Which bike?') for index in range(5_000)])
        self.assertEqual(result['import']['posts'], 5_000)

    def test_as_of(self) -> None:
        message = 'as_of must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z'
        for value in ('2026-10-01', '2026-10-01T12:00:00', 'now', None, 3):
            with self.subTest(value=value):
                self.assertRejects(message, as_of=value)

    def test_post_shape(self) -> None:
        self.assertRejects('post 1 must be an object with an id and title', 'text')
        self.assertRejects('post 1: id must be text', {'title': 'x'})
        self.assertRejects('post 1: id must be at most 100 characters', post('i' * 101))
        self.assertRejects('post 1: title must be text', {'id': 'a'})
        self.assertRejects('post 1: title cannot be blank', post(title=' '))
        self.assertRejects('post 1: title must be at most 300 characters', post(title='t' * 301))
        self.assertRejects('post 1: body must be text', post(body=5))
        self.assertRejects('post 1: body must be at most 20,000 characters', post(body='b' * 20_001))
        self.assertRejects('post 1: subreddit must be at most 100 characters', post(subreddit='s' * 101))
        self.assertRejects('post 1: created_at must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z', post(created_at='2026-09-30'))
        self.assertRejects('post 1: score must be a whole number from -1,000,000,000 to 1,000,000,000', post(score=1.5))
        self.assertRejects('post 1: score must be a whole number from -1,000,000,000 to 1,000,000,000', post(score=10 ** 9 + 1))
        self.assertRejects('post 1: comments must be a whole number from 0 to 1,000,000,000', post(comments=-1))
        self.assertRejects('post id "a" is used more than once', post('a'), post('a'))

    def test_null_optional_fields_are_absent(self) -> None:
        opportunity = only(post(body=None, subreddit=None, created_at=None, score=None, comments=None))
        self.assertNotIn('subreddit', opportunity)
        self.assertNotIn('created_at', opportunity)

    def test_unknown_post_keys_are_ignored(self) -> None:
        self.assertEqual(run(post(permalink='/r/x', flair='ignored', awards=[1])), run(post()))


if __name__ == '__main__':
    unittest.main()
