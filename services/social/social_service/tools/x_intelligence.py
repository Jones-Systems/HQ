"""Signal inbox: sort feed items you supply into a topic, with traceable evidence.

Whole-word, case-insensitive term matching over the supplied title and text. Nothing is fetched, and
a match is a statement about the supplied text only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import (check_input, fold, matched_terms, need_list, need_object, normalize_url, optional_text,
                      quote_list, short_text, text_list)

ITEMS_MAX = 5_000
TERMS_MAX = 50
TERM_MAX = 100
TERMS_TOTAL_MAX = 600
EVIDENCE_LISTED = 300
BASIS = 'Supplied feed items only. Terms are matched as whole words in the supplied title and text; nothing is fetched.'


def _item(raw: Any, index: int) -> dict[str, Any]:
    label = f'item {index + 1}'
    item = need_object(raw, f'{label} must be an object with an id and text')
    identifier = short_text(item.get('id'), f'{label}: id', 100)
    title = optional_text(item.get('title'), f'{label}: title', 200)
    content = optional_text(item.get('content_text'), f'{label}: content_text', 20_000)
    if title is None and content is None:
        raise ValueError(f'{label} needs a title or content_text')
    url = item.get('url')
    if isinstance(url, str) and not url.strip():
        url = None
    if url is not None and (normalize_url(url) is None or len(url) > 500):
        raise ValueError(f'{label}: url must be an http or https URL of at most 500 characters')
    return {'id': identifier, 'title': title, 'content': content, 'url': url}


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    topic = short_text(data.get('topic'), 'topic', 200)
    terms = text_list(data.get('terms'), 'terms', 1, TERMS_MAX, TERM_MAX, 'non-empty terms', total_high=TERMS_TOTAL_MAX)
    raw_items = need_list(data.get('items'), 'items', 1, ITEMS_MAX, 'feed items')
    items = [_item(raw, index) for index, raw in enumerate(raw_items)]
    seen: set[str] = set()
    for item in items:
        if item['id'] in seen:
            raise ValueError(f'item id "{item["id"]}" is used more than once')
        seen.add(item['id'])

    folded_terms = [fold(term) for term in terms]
    matches: list[tuple[int, dict[str, Any], list[str]]] = []
    for index, item in enumerate(items):
        found = set(matched_terms(fold(item['title'] or ''), terms, folded_terms))
        found.update(matched_terms(fold(item['content'] or ''), terms, folded_terms))
        hits = [term for term in terms if term in found]
        if hits:
            matches.append((index, item, hits))
    matches.sort(key=lambda entry: (-len(entry[2]), entry[0]))

    evidence = []
    for _, item, hits in matches[:EVIDENCE_LISTED]:
        record: dict[str, Any] = {
            'item_id': item['id'],
            'title': item['title'] or f'Item {item["id"]}',
            'text': f'Matched {quote_list(hits)} in supplied item {item["id"]}.',
        }
        if item['url'] is not None:
            record['url'] = item['url']
        record['matched_terms'] = hits
        evidence.append(record)

    return {
        'basis': BASIS,
        'topic': topic,
        'terms': terms,
        'counts': {
            'items': len(items),
            'matched': len(matches),
            'unmatched': len(items) - len(matches),
            'evidence': len(evidence),
        },
        'evidence': evidence,
        'evidence_omitted': len(matches) - len(evidence),
    }
