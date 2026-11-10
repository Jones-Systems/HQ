"""Reddit opportunities: rank conversations in a corpus you supply against a product profile.

The score is an explained heuristic over question form, profile-term relevance and recency. Nothing is
fetched from Reddit, and a high score is a prompt for human reading, not a prediction.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import (any_text, check_input, contains_term, days_between, fold, need_list, need_object, optional_text,
                      parse_datetime, quote_list, short_text, text_list, whole_number)

POSTS_MAX = 5_000
OPPORTUNITIES_LISTED = 200
WEIGHTS = {'question_form': 0.35, 'profile_relevance': 0.45, 'recency': 0.20}
RECENCY_DAYS = 30

# An illustrative, fictional product profile. It is used only when no profile is supplied.
DEFAULT_PROFILE = {
    'name': 'example-tea-shop',
    'terms': ['tea', 'oolong', 'green tea', 'black tea', 'matcha', 'steep', 'steeping', 'brewing', 'loose leaf',
              'teapot', 'gongfu', 'cupping', 'kettle'],
}
_QUESTION_WORDS = frozenset({'who', 'what', 'which', 'when', 'where', 'why', 'how', 'can', 'could', 'should', 'would',
                             'is', 'are', 'do', 'does', 'did', 'any', 'anyone', 'has', 'have', 'will'})
_REQUEST_PHRASES = ('recommend', 'recommendations', 'looking for', 'suggestions', 'advice', 'help', 'tips')


def _profile(raw: Any) -> tuple[str, list[str], str]:
    if raw is None:
        return DEFAULT_PROFILE['name'], list(DEFAULT_PROFILE['terms']), 'illustrative profile'
    profile = need_object(raw, 'profile must be an object with a name and terms')
    name = short_text(profile.get('name'), 'profile name', 100)
    terms = text_list(profile.get('terms'), 'profile terms', 1, 50, 100, 'terms', total_high=1_000)
    return name, terms, 'supplied profile'


def _post(raw: Any, index: int) -> dict[str, Any]:
    label = f'post {index + 1}'
    post = need_object(raw, f'{label} must be an object with an id and title')
    created = post.get('created_at')
    result: dict[str, Any] = {
        'id': short_text(post.get('id'), f'{label}: id', 100),
        'title': short_text(post.get('title'), f'{label}: title', 300),
        'body': '' if post.get('body') is None else any_text(post['body'], f'{label}: body', 20_000),
        'subreddit': optional_text(post.get('subreddit'), f'{label}: subreddit', 100),
        'created': None if created is None else parse_datetime(created, f'{label}: created_at'),
        'created_at': created,
        'score': None if post.get('score') is None else whole_number(post['score'], f'{label}: score', low=-1_000_000_000, high=1_000_000_000),
        'comments': None if post.get('comments') is None else whole_number(post['comments'], f'{label}: comments', high=1_000_000_000),
    }
    return result


def _question(title: str, body: str) -> tuple[float, str]:
    folded = fold(title)
    words = folded.split(' ')
    if '?' in title:
        return 1.0, 'title is phrased as a question'
    if words and words[0] in _QUESTION_WORDS:
        return 0.6, f'title opens with the question word "{words[0]}"'
    for phrase in _REQUEST_PHRASES:
        if contains_term(folded, phrase):
            return 0.6, f'title asks for help or recommendations ("{phrase}")'
    if '?' in body:
        return 0.3, 'the body contains a question'
    return 0.0, 'no question form in the title or body'


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    bundle = need_object(data.get('bundle'), 'bundle must be an object with a corpus and posts')
    corpus = short_text(bundle.get('corpus'), 'bundle corpus', 200)
    posts = [_post(raw, index) for index, raw in enumerate(need_list(bundle.get('posts'), 'bundle posts', 1, POSTS_MAX, 'posts'))]
    as_of_text = data.get('as_of')
    as_of = parse_datetime(as_of_text, 'as_of')
    profile_name, terms, profile_kind = _profile(data.get('profile'))
    seen: set[str] = set()
    for post in posts:
        if post['id'] in seen:
            raise ValueError(f'post id "{post["id"]}" is used more than once')
        seen.add(post['id'])

    folded_terms = [fold(term) for term in terms]
    scored = []
    for post in posts:
        title_hits = [term for term, key in zip(terms, folded_terms) if contains_term(fold(post['title']), key)]
        body_folded = fold(post['body'])
        body_hits = [term for term, key in zip(terms, folded_terms) if term not in title_hits and contains_term(body_folded, key)]
        if not title_hits and not body_hits:
            continue
        question, question_reason = _question(post['title'], post['body'])
        relevance = min(1.0, (2 * len(title_hits) + len(body_hits)) / 4)
        recency = 0.0
        age = None
        if post['created'] is None:
            recency_reason = 'no created_at was supplied, so recency is not scored'
        elif post['created'] > as_of:
            recency_reason = 'created_at is after as_of, so recency is not scored'
        else:
            age = days_between(as_of, post['created'])
            recency = max(0.0, 1 - age / RECENCY_DAYS)
            recency_reason = f'created {age} days before as_of (credit falls evenly to none at {RECENCY_DAYS} days)'
        parts = (WEIGHTS['question_form'] * question, WEIGHTS['profile_relevance'] * relevance, WEIGHTS['recency'] * recency)
        relevance_reason = '; '.join(filter(None, (
            f'title mentions {quote_list(title_hits, 5)}' if title_hits else '',
            f'body mentions {quote_list(body_hits, 5)}' if body_hits else '')))
        opportunity: dict[str, Any] = {
            'id': post['id'],
            'title': post['title'],
            'score': round(sum(parts), 3),
            'reasons': [
                f'Question form: {question_reason} (+{parts[0]:.2f}).',
                f'Profile relevance: {relevance_reason} (+{parts[1]:.2f}).',
                f'Recency: {recency_reason} (+{parts[2]:.2f}).',
            ],
            'matched_terms': title_hits + body_hits,
        }
        if post['subreddit'] is not None:
            opportunity['subreddit'] = post['subreddit']
        if post['created_at'] is not None:
            opportunity['created_at'] = post['created_at']
        if age is not None:
            opportunity['age_days'] = age
        if post['score'] is not None or post['comments'] is not None:
            opportunity['engagement'] = {key: post[key] for key in ('score', 'comments') if post[key] is not None}
        scored.append(opportunity)
    scored.sort(key=lambda item: (-item['score'], item['id']))

    return {
        'basis': f'Supplied corpus only, as of {as_of_text}. No Reddit access. Scores explain fit to the stated profile; they do not predict outcomes.',
        'as_of': as_of_text,
        'profile': f'{profile_name} ({profile_kind}; rankings apply to that profile)',
        'profile_terms': terms,
        'import': {'corpus': corpus, 'posts': len(posts)},
        'opportunities_found': len(scored),
        'analysis': {
            'considered': len(posts),
            'relevant': len(scored),
            'not_relevant': len(posts) - len(scored),
            'weights': dict(WEIGHTS),
            'opportunities': scored[:OPPORTUNITIES_LISTED],
            'omitted': max(0, len(scored) - OPPORTUNITIES_LISTED),
        },
    }
