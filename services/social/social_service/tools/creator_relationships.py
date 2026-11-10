"""Creator fit: rank creators you supply, with explicit fit and missing-evidence reasons.

Fit is topic overlap between the supplied creator topics and the supplied niche and brand topics. Nothing
is looked up, no creator is contacted, and missing evidence is reported rather than guessed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import (check_input, contains_term, days_between, fold, need_list, need_object, optional_text,
                      parse_datetime, plural, quote_list, short_text, text_list, whole_number)

CREATORS_MAX = 200
STALE_AFTER_DAYS = 90
STATUS_ORDER = {'strong_fit': 0, 'possible_fit': 1, 'needs_evidence': 2, 'weak_fit': 3}
POLICY = {
    'basis': 'Topic overlap between supplied creator topics and the niche topics, with brand topics as extra support.',
    'strong_fit': f'Matches a niche topic and either a brand topic or at least half of the niche topics, with a last post within {STALE_AFTER_DAYS} days of as_of.',
    'possible_fit': f'Matches a niche topic but not strongly, or the last post is more than {STALE_AFTER_DAYS} days before as_of.',
    'needs_evidence': 'No topics were supplied, or a niche topic matches but no usable last_post_at was supplied.',
    'weak_fit': 'Topics were supplied and none match a niche topic.',
    'required_evidence': ['topics', 'last_post_at'],
    'reported_evidence': ['followers', 'audience_location'],
    'stale_after_days': STALE_AFTER_DAYS,
}


def _creator(raw: Any, index: int) -> dict[str, Any]:
    label = f'creator {index + 1}'
    creator = need_object(raw, f'{label} must be an object with a handle and topics')
    last_post = creator.get('last_post_at')
    return {
        'handle': short_text(creator.get('handle'), f'{label}: handle', 100),
        'name': optional_text(creator.get('name'), f'{label}: name', 200),
        'topics': text_list([] if creator.get('topics') is None else creator['topics'], f'{label}: topics', 0, 50, 100, 'topics'),
        'followers': None if creator.get('followers') is None else whole_number(creator['followers'], f'{label}: followers', high=10_000_000_000),
        'last_post_at': last_post,
        'last_post': None if last_post is None else parse_datetime(last_post, f'{label}: last_post_at'),
        'audience_location': optional_text(creator.get('audience_location'), f'{label}: audience_location', 200),
    }


def _matched(topics: list[str], wanted: list[str]) -> list[str]:
    """The ``wanted`` topics that equal, or appear as whole words inside, one of the creator's topics."""
    folded = [fold(topic) for topic in topics]
    return [topic for topic in wanted if any(fold(topic) == own or contains_term(own, fold(topic)) for own in folded)]


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    batch = need_object(data.get('batch'), 'batch must be an object with an account_id and creators')
    account_id = short_text(batch.get('account_id'), 'batch account_id', 100)
    niche_topics = text_list(data.get('niche_topics'), 'niche_topics', 1, 50, 80, 'topics', total_high=600)
    brand_value = data.get('brand_topics')
    brand_topics = text_list([] if brand_value is None else brand_value, 'brand_topics', 0, 50, 80, 'topics', total_high=600)
    as_of_text = data.get('as_of')
    as_of = parse_datetime(as_of_text, 'as_of')
    creators = [_creator(raw, index) for index, raw in enumerate(need_list(batch.get('creators'), 'batch creators', 1, CREATORS_MAX, 'creators'))]
    handles: set[str] = set()
    for creator in creators:
        key = fold(creator['handle'])
        if key in handles:
            raise ValueError(f'creator handle "{creator["handle"]}" is used more than once')
        handles.add(key)

    assessed = []
    for creator in creators:
        niche = _matched(creator['topics'], niche_topics)
        brand = _matched(creator['topics'], brand_topics)
        missing: dict[str, str] = {}
        age: float | None = None
        if not creator['topics']:
            missing['topics'] = 'not supplied'
        if creator['last_post'] is None:
            missing['last_post_at'] = 'not supplied'
        elif creator['last_post'] > as_of:
            missing['last_post_at'] = 'dated after as_of'
        else:
            age = days_between(as_of, creator['last_post'])
        if creator['followers'] is None:
            missing['followers'] = 'not supplied'
        if creator['audience_location'] is None:
            missing['audience_location'] = 'not supplied'

        reasons = []
        if not creator['topics']:
            status = 'needs_evidence'
            reasons.append('No topics were supplied, so fit cannot be assessed.')
        elif not niche:
            status = 'weak_fit'
            reasons.append(f'None of the supplied topics match the {plural(len(niche_topics), "niche topic")}.')
        else:
            reasons.append(f'Matches {len(niche)} of {plural(len(niche_topics), "niche topic")}: {quote_list(niche, 5)}.')
            if brand:
                reasons.append(f'Also matches {plural(len(brand), "brand topic")}: {quote_list(brand, 5)}.')
            strong = bool(brand) or 2 * len(niche) >= len(niche_topics)
            if age is None:
                status = 'needs_evidence'
                reasons.append('A niche topic matches, but no usable last_post_at was supplied, so recent activity is unconfirmed.')
            elif age > STALE_AFTER_DAYS:
                status = 'possible_fit'
                reasons.append(f'The last post was {age} days before as_of, more than {STALE_AFTER_DAYS}.')
            elif strong:
                status = 'strong_fit'
                reasons.append(f'Last post {age} days before as_of.')
            else:
                status = 'possible_fit'
                reasons.append(f'Matches fewer than half of the niche topics and no brand topic. Last post {age} days before as_of.')

        entry: dict[str, Any] = {'handle': creator['handle']}
        if creator['name'] is not None:
            entry['name'] = creator['name']
        entry.update({'status': status, 'niche_matches': niche, 'brand_matches': brand, 'age_days': age,
                      'missing_evidence': missing, 'reasons': reasons})
        if creator['followers'] is not None:
            entry['followers'] = creator['followers']
        if creator['audience_location'] is not None:
            entry['audience_location'] = creator['audience_location']
        assessed.append(entry)

    assessed.sort(key=lambda entry: (STATUS_ORDER[entry['status']], -len(entry['niche_matches']), -len(entry['brand_matches']),
                                     entry['handle'].casefold(), entry['handle']))
    counts = {'creators': len(assessed), **{status: sum(1 for entry in assessed if entry['status'] == status) for status in STATUS_ORDER}}
    return {
        'account_id': account_id,
        'as_of': as_of_text,
        'basis': f'Supplied creator batch only, as of {as_of_text}. No creator was looked up or contacted; missing evidence is reported, not guessed.',
        'policy': {**POLICY, 'required_evidence': list(POLICY['required_evidence']), 'reported_evidence': list(POLICY['reported_evidence'])},
        'niche_topics': niche_topics,
        'brand_topics': brand_topics,
        'counts': counts,
        'creators': assessed,
    }
