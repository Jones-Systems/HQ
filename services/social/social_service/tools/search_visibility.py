"""Search visibility: analyze answer-search observations you supply.

Every figure is counted from the supplied answers and inventory. No search engine is queried, and an
answer's cited URLs and text are taken exactly as supplied.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import (any_text, check_input, contains_term, fold, need_list, need_object, normalize_url, optional_text,
                      ratio, short_text, url_list)

QUERIES_MAX = 200
ENTITIES_MAX = 100
INVENTORY_MAX = 2_000
ANSWERS_MAX = 5_000
CITED_MAX = 50
ENGINES_MAX = 30
ENGINE_MAX = 60
ENGINES_PER_QUERY_LISTED = 5
CITATIONS_LISTED = 150
UNCITED_LISTED = 100
BASIS = 'Supplied answer observations only. No search engine was queried; counts describe the supplied answers and inventory.'


def _panel(raw: Any) -> tuple[str, list[str]]:
    panel = need_object(raw, 'panel must be an object with a name and queries')
    name = short_text(panel.get('name'), 'panel name', 200)
    queries: list[str] = []
    seen: set[str] = set()
    for index, query in enumerate(need_list(panel.get('queries'), 'panel queries', 1, QUERIES_MAX, 'queries')):
        text = short_text(query, f'panel query {index + 1}', 300)
        if fold(text) not in seen:
            seen.add(fold(text))
            queries.append(text)
    return name, queries


def _entities(raw: Any) -> list[dict[str, str]]:
    entities: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, entry in enumerate(need_list(raw, 'entities', 0, ENTITIES_MAX, 'entities with a name and kind')):
        entity = need_object(entry, f'entity {index + 1} must be an object with a name and kind')
        name = short_text(entity.get('name'), f'entity {index + 1}: name', 200)
        kind = optional_text(entity.get('kind'), f'entity {index + 1}: kind', 50) or 'entity'
        if fold(name) not in seen:
            seen.add(fold(name))
            entities.append({'name': name, 'kind': kind})
    return entities


def _inventory(raw: Any) -> dict[str, str | None]:
    inventory: dict[str, str | None] = {}
    for index, entry in enumerate(need_list(raw, 'inventory', 0, INVENTORY_MAX, 'pages with a url and title')):
        page = need_object(entry, f'inventory page {index + 1} must be an object with a url and title')
        url = normalize_url(page.get('url'))
        if url is None:
            raise ValueError(f'inventory page {index + 1}: url must be an http or https URL')
        title = optional_text(page.get('title'), f'inventory page {index + 1}: title', 200)
        inventory.setdefault(url, title)
    return inventory


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    panel_name, queries = _panel(data.get('panel'))
    entities = _entities(data.get('entities'))
    inventory = _inventory(data.get('inventory'))
    raw_answers = need_list(data.get('answers'), 'answers', 1, ANSWERS_MAX, 'answer observations')

    normalized: dict[str, str | None] = {}
    by_query = {fold(query): {'query': query, 'answers': 0, 'engines': {}, 'cited_inventory': 0} for query in queries}
    engines: dict[str, dict[str, Any]] = {}
    citations: dict[str, int] = {}
    mentions = {fold(entity['name']): {'answers': 0, 'queries': set()} for entity in entities}
    outside = 0
    without_text = 0
    for index, entry in enumerate(raw_answers):
        label = f'answer {index + 1}'
        answer = need_object(entry, f'{label} must be an object with a query, engine and cited URLs')
        query = short_text(answer.get('query'), f'{label}: query', 300)
        engine = short_text(answer.get('engine'), f'{label}: engine', ENGINE_MAX)
        cited = list(dict.fromkeys(url_list([] if answer.get('cited') is None else answer['cited'], f'{label}: cited', CITED_MAX, normalized)))
        text = None if answer.get('text') is None else any_text(answer['text'], f'{label}: text', 20_000)
        slot = by_query.get(fold(query))
        if slot is None:
            outside += 1
            continue
        engine_slot = engines.setdefault(fold(engine), {'engine': engine, 'answers': 0, 'answers_with_citations': 0})
        if len(engines) > ENGINES_MAX:
            raise ValueError(f'answers may name at most {ENGINES_MAX} different engines')
        engine_slot['answers'] += 1
        engine_slot['answers_with_citations'] += 1 if cited else 0
        slot['answers'] += 1
        slot['engines'][fold(engine)] = engine
        if any(url in inventory for url in cited):
            slot['cited_inventory'] += 1
        for url in cited:
            citations[url] = citations.get(url, 0) + 1
        if text is None or not text.strip():
            without_text += 1
        else:
            folded = fold(text)
            for key, slot_mentions in mentions.items():
                if contains_term(folded, key):
                    slot_mentions['answers'] += 1
                    slot_mentions['queries'].add(fold(query))

    covered = sum(1 for slot in by_query.values() if slot['cited_inventory'] > 0)
    listed = sorted(citations.items(), key=lambda pair: (-pair[1], pair[0]))
    citation_rows = []
    for url, count in listed[:CITATIONS_LISTED]:
        row: dict[str, Any] = {'url': url, 'count': count, 'in_inventory': url in inventory}
        if inventory.get(url):
            row['title'] = inventory[url]
        citation_rows.append(row)
    uncited = sorted(url for url in inventory if url not in citations)

    return {
        'basis': BASIS,
        'panel': panel_name,
        'queries': len(queries),
        'answers': len(raw_answers),
        'answers_in_panel': len(raw_answers) - outside,
        'answers_outside_panel': outside,
        'answers_without_text': without_text,
        'engines': sorted(engines.values(), key=lambda row: (row['engine'].casefold(), row['engine'])),
        'citations': citation_rows,
        'citations_total': sum(citations.values()),
        'citations_unique': len(citations),
        'citations_omitted': max(0, len(listed) - CITATIONS_LISTED),
        'coverage': {'queries_with_inventory_citation': covered, 'queries': len(queries), 'ratio': ratio(covered, len(queries))},
        'queries_covered': covered,
        'coverage_ratio': ratio(covered, len(queries)),
        'query_coverage': [
            {'query': slot['query'], 'answers': slot['answers'],
             'engine_count': len(slot['engines']),
             'engines': sorted(slot['engines'].values(), key=lambda name: (name.casefold(), name))[:ENGINES_PER_QUERY_LISTED],
             'inventory_cited_answers': slot['cited_inventory'], 'covered': slot['cited_inventory'] > 0}
            for slot in by_query.values()],
        'entity_mentions': sorted(
            ({'name': entity['name'], 'kind': entity['kind'],
              'answers_mentioning': mentions[fold(entity['name'])]['answers'],
              'queries_mentioning': len(mentions[fold(entity['name'])]['queries'])} for entity in entities),
            key=lambda row: (-row['answers_mentioning'], row['name'].casefold(), row['name'])),
        'inventory_urls': len(inventory),
        'inventory_cited': len(inventory) - len(uncited),
        'uncited_inventory': [{'url': url, **({'title': inventory[url]} if inventory[url] else {})} for url in uncited[:UNCITED_LISTED]],
        'uncited_inventory_omitted': max(0, len(uncited) - UNCITED_LISTED),
    }
