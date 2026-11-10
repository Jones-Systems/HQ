"""TikTok signals: growth between supplied snapshot batches."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, tiktok_intelligence

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def batch(batch_id: str, observed_at: str, *records: dict, **manifest: object) -> dict:
    return {'manifest': {'batch_id': batch_id, 'observed_at': observed_at, **manifest}, 'records': list(records)}


def run(batches: list[dict] | None = None, **overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['tiktok-intelligence'])
    if batches is not None:
        data['batches'] = batches
    data.update(overrides)
    return tiktok_intelligence.run(data, now=NOW)


def post(result: dict, post_id: str) -> dict:
    return next(entry for entry in result['posts'] if entry['post_id'] == post_id)


class SampleTests(unittest.TestCase):
    def test_sample_ranks_the_post_seen_twice(self) -> None:
        result = tiktok_intelligence.run(copy.deepcopy(SAMPLES['tiktok-intelligence']), now=NOW)
        self.assertEqual(result['niche'], 'Fictional tea rituals')
        self.assertEqual(result['niche_terms'], ['oolong', 'gongfu'])
        self.assertEqual(result['as_of'], '2026-10-01T12:00:00Z')
        self.assertEqual((result['batches_supplied'], result['batches_used'], result['batches_after_as_of']), (2, 2, 0))
        self.assertEqual((result['records_used'], result['records_after_as_of'], result['posts_observed'], result['posts_ranked']), (3, 0, 2, 1))
        self.assertEqual(result['ranking_metric'], 'views')
        self.assertEqual(result['ranking'], [{'rank': 1, 'post_id': 'fixture-post-1', 'metric': 'views', 'first': 1200, 'last': 1500,
                                              'change': 300, 'change_percent': 25.0}])
        first = post(result, 'fixture-post-1')
        self.assertEqual(first['observations'], [{'batch': 1, 'views': 1200}, {'batch': 2, 'views': 1500}])
        self.assertEqual(first['first'], {'batch_id': 'fixture-batch-1', 'observed_at': '2026-09-30T12:00:00Z', 'views': 1200})
        self.assertEqual(first['last'], {'batch_id': 'fixture-batch-2', 'observed_at': '2026-10-01T12:00:00Z', 'views': 1500})
        self.assertEqual((first['change'], first['rank'], first['growth_percent']), ({'views': 300}, 1, 25.0))
        second = post(result, 'fixture-post-2')
        self.assertEqual((second['change'], second['rank'], second['growth_percent'], second['observation_count']), ({}, None, None, 1))
        self.assertEqual([entry['post_id'] for entry in result['posts']], ['fixture-post-1', 'fixture-post-2'])

    def test_qualifications_state_the_basis(self) -> None:
        result = tiktok_intelligence.run(copy.deepcopy(SAMPLES['tiktok-intelligence']), now=NOW)
        self.assertIn('Supplied snapshots only, as of 2026-10-01T12:00:00Z. No TikTok access.', result['qualifications'])
        self.assertIn('Supplied snapshots only', result['basis'])
        self.assertTrue(any('not filtered or scored' in line for line in result['qualifications']))

    def test_batch_log_lists_every_supplied_batch(self) -> None:
        result = tiktok_intelligence.run(copy.deepcopy(SAMPLES['tiktok-intelligence']), now=NOW)
        self.assertEqual(result['batch_log'], [
            {'batch': 1, 'batch_id': 'fixture-batch-1', 'observed_at': '2026-09-30T12:00:00Z', 'source': 'supplied snapshot', 'records': 2, 'used': True},
            {'batch': 2, 'batch_id': 'fixture-batch-2', 'observed_at': '2026-10-01T12:00:00Z', 'source': 'supplied snapshot', 'records': 1, 'used': True},
        ])

    def test_deterministic(self) -> None:
        self.assertEqual(run(), run())


class AsOfTests(unittest.TestCase):
    def test_batches_observed_after_as_of_are_excluded_and_counted(self) -> None:
        result = run([
            batch('b1', '2026-09-30T12:00:00Z', {'post_id': 'p1', 'views': 10}),
            batch('b2', '2026-10-01T12:00:01Z', {'post_id': 'p1', 'views': 99}, {'post_id': 'p2', 'views': 5}),
        ])
        self.assertEqual((result['batches_used'], result['batches_after_as_of'], result['records_used'], result['records_after_as_of']), (1, 1, 1, 2))
        self.assertEqual([entry['post_id'] for entry in result['posts']], ['p1'])
        self.assertEqual(result['posts'][0]['last']['views'], 10)
        self.assertEqual(result['ranking'], [])
        self.assertEqual([entry['used'] for entry in result['batch_log']], [True, False])
        self.assertIsNone(result['batch_log'][1]['batch'])
        self.assertTrue(any('1 batch observed after as_of, holding 2 records, left out' in line for line in result['qualifications']))

    def test_the_boundary_instant_is_included(self) -> None:
        result = run([batch('b1', '2026-10-01T12:00:00Z', {'post_id': 'p1', 'views': 1})])
        self.assertEqual(result['batches_used'], 1)

    def test_offsets_are_compared_in_utc(self) -> None:
        inside = batch('in', '2026-10-01T14:00:00+02:00', {'post_id': 'p', 'views': 1})
        outside = batch('out', '2026-10-01T13:30:00+01:00', {'post_id': 'p', 'views': 2})
        result = run([inside, outside])
        self.assertEqual([entry['used'] for entry in result['batch_log']], [True, False])

    def test_batches_are_ordered_by_observation_time_not_supply_order(self) -> None:
        result = run([
            batch('late', '2026-10-01T10:00:00Z', {'post_id': 'p', 'views': 300}),
            batch('early', '2026-09-30T10:00:00Z', {'post_id': 'p', 'views': 100}),
        ])
        entry = post(result, 'p')
        self.assertEqual((entry['first']['batch_id'], entry['last']['batch_id'], entry['change']), ('early', 'late', {'views': 200}))
        self.assertEqual([item['batch'] for item in result['batch_log']], [2, 1])

    def test_dst_day_offsets_order_by_instant(self) -> None:
        # 01:30 EST (06:30Z) is before 03:30 EDT (07:30Z) on the US spring-forward day.
        result = run([
            batch('after', '2026-03-08T03:30:00-04:00', {'post_id': 'p', 'views': 20}),
            batch('before', '2026-03-08T01:30:00-05:00', {'post_id': 'p', 'views': 10}),
        ], as_of='2026-03-08T12:00:00Z')
        self.assertEqual(post(result, 'p')['change'], {'views': 10})
        self.assertEqual(post(result, 'p')['first']['batch_id'], 'before')

    def test_every_batch_after_as_of_leaves_nothing_to_compare(self) -> None:
        result = run([batch('b1', '2026-10-02T00:00:00Z', {'post_id': 'p', 'views': 1})])
        self.assertEqual((result['batches_used'], result['posts_observed'], result['posts']), (0, 0, []))
        self.assertTrue(any('No batch was observed on or before as_of' in line for line in result['qualifications']))


class RankingTests(unittest.TestCase):
    def test_posts_are_ranked_by_change_then_percent_then_id(self) -> None:
        result = run([
            batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'big', 'views': 1000}, {'post_id': 'small', 'views': 10},
                  {'post_id': 'tie-b', 'views': 100}, {'post_id': 'tie-a', 'views': 100}, {'post_id': 'falls', 'views': 500},
                  {'post_id': 'pct-low', 'views': 400}, {'post_id': 'pct-high', 'views': 200}),
            batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'big', 'views': 1200}, {'post_id': 'small', 'views': 60},
                  {'post_id': 'tie-b', 'views': 150}, {'post_id': 'tie-a', 'views': 150}, {'post_id': 'falls', 'views': 400},
                  {'post_id': 'pct-low', 'views': 450}, {'post_id': 'pct-high', 'views': 250}),
        ])
        order = [row['post_id'] for row in result['ranking']]
        # Change: big +200 and falls -100. Five posts gain +50, so the larger percent ranks first (small 500%, the tie pair 50%,
        # pct-high 25%, pct-low 12.5%) and equal percents fall back to the post id.
        self.assertEqual(order, ['big', 'small', 'tie-a', 'tie-b', 'pct-high', 'pct-low', 'falls'])
        self.assertEqual([row['rank'] for row in result['ranking']], [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(post(result, 'small')['growth_percent'], 500.0)

    def test_unranked_posts_follow_ranked_ones_in_id_order(self) -> None:
        result = run([
            batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'z-once', 'views': 5}, {'post_id': 'a-once', 'views': 5}, {'post_id': 'grows', 'views': 1}),
            batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'grows', 'views': 2}),
        ])
        self.assertEqual([(entry['post_id'], entry['rank']) for entry in result['posts']], [('grows', 1), ('a-once', None), ('z-once', None)])

    def test_zero_baseline_has_no_percent(self) -> None:
        result = run([batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': 0}), batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'p', 'views': 7})])
        self.assertEqual((post(result, 'p')['change'], post(result, 'p')['growth_percent']), ({'views': 7}, None))
        self.assertIsNone(result['ranking'][0]['change_percent'])

    def test_other_metrics_are_tracked_and_can_drive_the_ranking(self) -> None:
        result = run([
            batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'likes': 10, 'shares': 1}, {'post_id': 'q', 'likes': 10}),
            batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'p', 'likes': 30, 'shares': 4}, {'post_id': 'q', 'likes': 12}),
        ])
        self.assertEqual(result['ranking_metric'], 'likes')
        self.assertEqual(post(result, 'p')['change'], {'likes': 20, 'shares': 3})
        self.assertEqual([row['post_id'] for row in result['ranking']], ['p', 'q'])

    def test_a_metric_missing_from_one_end_has_no_change(self) -> None:
        result = run([
            batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': 10}),
            batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'p', 'likes': 3}),
        ])
        self.assertEqual(post(result, 'p')['change'], {})
        self.assertIsNone(result['ranking_metric'])
        self.assertTrue(any('no growth ranking' in line for line in result['qualifications']))
        self.assertEqual(post(result, 'p')['first']['views'], 10)
        self.assertEqual(post(result, 'p')['last']['likes'], 3)

    def test_a_single_batch_has_no_ranking(self) -> None:
        result = run([batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': 10})])
        self.assertEqual((result['ranking_metric'], result['ranking'], result['posts_ranked']), (None, [], 0))

    def test_integral_floats_are_accepted_and_unknown_record_keys_ignored(self) -> None:
        result = run([batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': 10.0, 'caption': 'ignored', 'tags': ['x']}),
                      batch('b2', '2026-10-01T00:00:00Z', {'post_id': 'p', 'views': 12})])
        self.assertEqual(post(result, 'p')['change'], {'views': 2})
        self.assertIsInstance(post(result, 'p')['first']['views'], int)

    def test_the_posts_listing_is_capped_but_counts_are_complete(self) -> None:
        records = [{'post_id': f'p{index:04d}', 'views': index} for index in range(250)]
        result = run([batch('b1', '2026-09-30T00:00:00Z', *records), batch('b2', '2026-10-01T00:00:00Z', *[{**item, 'views': item['views'] + 1} for item in records])])
        self.assertEqual((len(result['posts']), result['posts_omitted'], result['posts_observed']), (200, 50, 250))
        self.assertEqual(len(result['ranking']), 200)

    def test_twenty_batches_are_accepted(self) -> None:
        batches = [batch(f'b{index}', f'2026-09-{index + 1:02d}T00:00:00Z', {'post_id': 'p', 'views': index}) for index in range(20)]
        result = run(batches)
        self.assertEqual(post(result, 'p')['observation_count'], 20)
        self.assertEqual(post(result, 'p')['change'], {'views': 19})


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, batches: list[dict] | None = None, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(batches, **overrides)
        self.assertEqual(str(caught.exception), message)

    def test_niche(self) -> None:
        self.assertRejects('niche must be an object with a name and optional terms', niche=None)
        self.assertRejects('niche must be an object with a name and optional terms', niche='tea')
        self.assertRejects('niche name must be text', niche={'terms': ['a']})
        self.assertRejects('niche name cannot be blank', niche={'name': ' '})
        self.assertRejects('niche name must be at most 200 characters', niche={'name': 'n' * 201})
        self.assertRejects('niche terms must be a list of up to 50 terms', niche={'name': 'n', 'terms': 'tea'})
        self.assertRejects('niche terms must be a list of up to 50 terms', niche={'name': 'n', 'terms': [str(index) for index in range(51)]})
        self.assertRejects('niche terms entry 1 cannot be blank', niche={'name': 'n', 'terms': ['']})
        self.assertEqual(run(niche={'name': 'only a name'})['niche_terms'], [])

    def test_as_of(self) -> None:
        message = 'as_of must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z'
        for value in ('2026-10-01', '2026-10-01T12:00:00', 'yesterday', '2026-02-30T00:00:00Z', None, 5):
            with self.subTest(value=value):
                self.assertRejects(message, as_of=value)
        with self.assertRaisesRegex(ValueError, '^as_of must be'):
            tiktok_intelligence.run({'niche': {'name': 'n'}, 'batches': SAMPLES['tiktok-intelligence']['batches']}, now=NOW)

    def test_batches_list(self) -> None:
        message = 'batches must be a list of 1–20 snapshot batches'
        self.assertRejects(message, [])
        self.assertRejects(message, batches='b')
        too_many = [batch(f'b{index}', '2026-09-30T00:00:00Z') for index in range(21)]
        self.assertRejects(message, too_many)

    def test_batch_shape(self) -> None:
        good = batch('b1', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': 1})
        self.assertRejects('batch 1 must be an object with a manifest and records', ['x'])
        self.assertRejects('batch 2: manifest must be an object with a batch_id and observed_at', [good, {'records': []}])
        self.assertRejects('batch 1: manifest batch_id must be text', [{'manifest': {'observed_at': '2026-09-30T00:00:00Z'}, 'records': []}])
        self.assertRejects('batch 1: manifest batch_id must be at most 100 characters', [batch('b' * 101, '2026-09-30T00:00:00Z')])
        self.assertRejects('batch 1: manifest observed_at must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z',
                           [batch('b', 'last tuesday')])
        self.assertRejects('batch 1: manifest source must be at most 200 characters', [batch('b', '2026-09-30T00:00:00Z', source='s' * 201)])
        self.assertRejects('batch 1: records must be a list of up to 5,000 post records', [{'manifest': good['manifest'], 'records': 'x'}])
        self.assertRejects('batch 1: records must be a list of up to 5,000 post records', [{'manifest': good['manifest']}])
        self.assertRejects('batch_id values must be unique across batches', [good, copy.deepcopy(good)])

    def test_records_list_ceiling(self) -> None:
        records = [{'post_id': f'p{index}'} for index in range(5_001)]
        self.assertRejects('batch 1: records must be a list of up to 5,000 post records', [batch('b', '2026-09-30T00:00:00Z', *records)])
        self.assertEqual(run([batch('b', '2026-09-30T00:00:00Z', *records[:5_000])])['posts_observed'], 5_000)

    def test_record_shape(self) -> None:
        def with_record(record: object) -> list[dict]:
            return [{'manifest': {'batch_id': 'b', 'observed_at': '2026-09-30T00:00:00Z'}, 'records': [record]}]
        self.assertRejects('batch 1 record 1 must be an object with a post_id', with_record('p'))
        self.assertRejects('batch 1 record 1: post_id must be text', with_record({'views': 1}))
        self.assertRejects('batch 1 record 1: post_id cannot be blank', with_record({'post_id': ''}))
        for field in ('views', 'likes', 'comments', 'shares'):
            for bad in (-1, 1.5, '12', True, 10 ** 12 + 1, [1]):
                with self.subTest(field=field, bad=bad):
                    self.assertRejects(f'batch 1 record 1: {field} must be a whole number from 0 to 1,000,000,000,000', with_record({'post_id': 'p', field: bad}))
        self.assertRejects('batch 1 lists post "p" more than once',
                           [batch('b', '2026-09-30T00:00:00Z', {'post_id': 'p'}, {'post_id': 'p'})])

    def test_null_metrics_are_absent(self) -> None:
        result = run([batch('b', '2026-09-30T00:00:00Z', {'post_id': 'p', 'views': None, 'likes': 3})])
        self.assertEqual(post(result, 'p')['first'], {'batch_id': 'b', 'observed_at': '2026-09-30T00:00:00Z', 'likes': 3})


if __name__ == '__main__':
    unittest.main()
