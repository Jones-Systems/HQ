"""TikTok signals: compare post snapshots you supply.

Every number comes from the supplied batches. Nothing is collected, no TikTok account or API is touched,
and a batch observed after ``as_of`` is left out and counted.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import (check_input, need_list, need_object, optional_text, parse_datetime, plural, short_text,
                      text_list, whole_number)

MAX_BATCHES = 20
MAX_RECORDS = 5_000
POSTS_LISTED = 200
METRICS = ('views', 'likes', 'comments', 'shares')


def _record(raw: Any, label: str) -> tuple[str, dict[str, int]]:
    record = need_object(raw, f'{label} must be an object with a post_id')
    post_id = short_text(record.get('post_id'), f'{label}: post_id', 100)
    metrics = {metric: whole_number(record[metric], f'{label}: {metric}')
               for metric in METRICS if record.get(metric) is not None}
    return post_id, metrics


def _batch(raw: Any, index: int) -> dict[str, Any]:
    label = f'batch {index + 1}'
    batch = need_object(raw, f'{label} must be an object with a manifest and records')
    manifest = need_object(batch.get('manifest'), f'{label}: manifest must be an object with a batch_id and observed_at')
    observed = manifest.get('observed_at')
    records_raw = need_list(batch.get('records'), f'{label}: records', 0, MAX_RECORDS, 'post records')
    records: dict[str, dict[str, int]] = {}
    for position, entry in enumerate(records_raw):
        post_id, metrics = _record(entry, f'{label} record {position + 1}')
        if post_id in records:
            raise ValueError(f'{label} lists post "{post_id}" more than once')
        records[post_id] = metrics
    return {
        'batch_id': short_text(manifest.get('batch_id'), f'{label}: manifest batch_id', 100),
        'observed_at': observed,
        'moment': parse_datetime(observed, f'{label}: manifest observed_at'),
        'source': optional_text(manifest.get('source'), f'{label}: manifest source', 200),
        'records': records,
    }


def _values(observation: dict[str, Any]) -> dict[str, int]:
    return {metric: observation[metric] for metric in METRICS if metric in observation}


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    niche = need_object(data.get('niche'), 'niche must be an object with a name and optional terms')
    niche_name = short_text(niche.get('name'), 'niche name', 200)
    niche_terms = text_list([] if niche.get('terms') is None else niche['terms'], 'niche terms', 0, 50, 100, 'terms')
    as_of_text = data.get('as_of')
    as_of = parse_datetime(as_of_text, 'as_of')
    batches = [_batch(raw, index) for index, raw in enumerate(need_list(data.get('batches'), 'batches', 1, MAX_BATCHES, 'snapshot batches'))]
    ids = [batch['batch_id'] for batch in batches]
    if len(set(ids)) != len(ids):
        raise ValueError('batch_id values must be unique across batches')

    used = sorted((batch for batch in batches if batch['moment'] <= as_of), key=lambda batch: (batch['moment'], batch['batch_id']))
    position = {batch['batch_id']: number for number, batch in enumerate(used, start=1)}
    batch_log = []
    for batch in batches:
        entry: dict[str, Any] = {'batch': position.get(batch['batch_id']), 'batch_id': batch['batch_id'], 'observed_at': batch['observed_at']}
        if batch['source'] is not None:
            entry['source'] = batch['source']
        entry['records'] = len(batch['records'])
        entry['used'] = batch['batch_id'] in position
        batch_log.append(entry)

    observations: dict[str, list[dict[str, Any]]] = {}
    for batch in used:
        for post_id, metrics in batch['records'].items():
            observations.setdefault(post_id, []).append(
                {'batch': position[batch['batch_id']], 'batch_id': batch['batch_id'], 'observed_at': batch['observed_at'], **metrics})

    posts: dict[str, dict[str, Any]] = {}
    for post_id, series in observations.items():
        first, last = series[0], series[-1]
        change = {metric: last[metric] - first[metric]
                  for metric in METRICS if len(series) > 1 and metric in first and metric in last}
        posts[post_id] = {
            'post_id': post_id,
            'observation_count': len(series),
            'observations': [{'batch': item['batch'], **_values(item)} for item in series],
            'first': {'batch_id': first['batch_id'], 'observed_at': first['observed_at'], **_values(first)},
            'last': {'batch_id': last['batch_id'], 'observed_at': last['observed_at'], **_values(last)},
            'change': change,
        }

    ranking_metric = next((metric for metric in METRICS if any(metric in post['change'] for post in posts.values())), None)
    for post in posts.values():
        base = post['first'].get(ranking_metric) if ranking_metric else None
        delta = post['change'].get(ranking_metric) if ranking_metric else None
        post['growth_percent'] = round(delta / base * 100, 2) if delta is not None and base else None

    def order(post: dict[str, Any]) -> tuple[Any, ...]:
        delta = post['change'].get(ranking_metric) if ranking_metric else None
        percent = post['growth_percent']
        if delta is None:
            return (1, 0, 0.0, post['post_id'])
        return (0, -delta, -(percent if percent is not None else float('-inf')), post['post_id'])

    ordered = sorted(posts.values(), key=order)
    rank = 0
    for post in ordered:
        if ranking_metric and ranking_metric in post['change']:
            rank += 1
            post['rank'] = rank
        else:
            post['rank'] = None
    ranked = [post for post in ordered if post['rank'] is not None]

    records_used = sum(len(batch['records']) for batch in used)
    records_after = sum(len(batch['records']) for batch in batches) - records_used
    after = len(batches) - len(used)
    qualifications = [f'Supplied snapshots only, as of {as_of_text}. No TikTok access.',
                      'Niche terms are recorded for context; posts are not filtered or scored by them.']
    if after:
        qualifications.append(f'{plural(after, "batch", "batches")} observed after as_of, holding {plural(records_after, "record")}, '
                              'left out. They are not used anywhere in this analysis.')
    if not used:
        qualifications.append('No batch was observed on or before as_of, so there is nothing to compare.')
    elif ranking_metric is None:
        qualifications.append('No post has the same metric in two snapshots, so there is no growth ranking.')
    else:
        qualifications.append(f'Growth ranks the change in {ranking_metric} between a post\'s first and last supplied snapshot. A post seen in one snapshot is not ranked.')

    return {
        'basis': f'Supplied snapshots only, as of {as_of_text}. Nothing was collected from TikTok.',
        'niche': niche_name,
        'niche_terms': niche_terms,
        'as_of': as_of_text,
        'qualifications': qualifications,
        'ranking_metric': ranking_metric,
        'batches_supplied': len(batches),
        'batches_used': len(used),
        'batches_after_as_of': after,
        'records_used': records_used,
        'records_after_as_of': records_after,
        'posts_observed': len(posts),
        'posts_ranked': len(ranked),
        'posts_omitted': max(0, len(ordered) - POSTS_LISTED),
        'batch_log': batch_log,
        'posts': ordered[:POSTS_LISTED],
        'ranking': [{'rank': post['rank'], 'post_id': post['post_id'], 'metric': ranking_metric,
                     'first': post['first'].get(ranking_metric), 'last': post['last'].get(ranking_metric),
                     'change': post['change'][ranking_metric], 'change_percent': post['growth_percent']}
                    for post in ranked[:POSTS_LISTED]],
    }
