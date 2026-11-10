"""SEO workbench: editorial-readiness checks on article packets you supply.

The thresholds are illustrative editorial rules, not search-engine rules. No search data is read and no
approval or site change happens.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from ._common import (any_text, check_input, fmt, need_list, need_object, normalize_url, parse_date, plural,
                      short_text)

PACKETS_MAX = 200
SOURCES_MAX = 50
TITLE_RANGE = (10, 70)
SLUG_MAX = 80
MIN_SOURCES = 2
MIN_WORDS = 300
SOURCE_FINDINGS_LISTED = 3
BODY_MAX = 100_000

_HOST = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*')
_LANGUAGE = re.compile(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}')
_SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')

RULES = [
    f'Slug: lowercase letters, digits and single hyphens, at most {SLUG_MAX} characters, unique across packets.',
    f'Title: {TITLE_RANGE[0]}–{TITLE_RANGE[1]} characters (illustrative).',
    f'Sources: at least {MIN_SOURCES} different http or https URLs.',
    f'Body, when supplied: at least {MIN_WORDS} words (illustrative).',
]


def _config(raw: Any) -> tuple[str, str]:
    config = need_object(raw, 'config must be an object with a site and language')
    site = short_text(config.get('site'), 'config site', 253)
    if _HOST.fullmatch(site) is None:
        raise ValueError('config site must be a host name such as example.invalid')
    language = short_text(config.get('language'), 'config language', 35)
    if _LANGUAGE.fullmatch(language) is None:
        raise ValueError('config language must be a language code such as en or en-GB')
    return site, language


def _packet(raw: Any, index: int) -> dict[str, Any]:
    label = f'packet {index + 1}'
    packet = need_object(raw, f'{label} must be an object with a slug, title and sources')
    sources = need_list(packet.get('sources'), f'{label}: sources', 0, SOURCES_MAX, 'source URLs')
    for number, source in enumerate(sources, start=1):
        if not isinstance(source, str) or len(source) > 2_048:
            raise ValueError(f'{label}: source {number} must be text of at most 2,048 characters')
    body = packet.get('body')
    body = None if body is None else any_text(body, f'{label}: body', BODY_MAX)
    return {
        'slug': short_text(packet.get('slug'), f'{label}: slug', 200, strip=False),
        'title': short_text(packet.get('title'), f'{label}: title', 500, strip=False),
        'sources': sources,
        'body': body,
    }


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    site, language = _config(data.get('config'))
    packets = [_packet(raw, index) for index, raw in enumerate(need_list(data.get('packets'), 'packets', 1, PACKETS_MAX, 'article packets'))]
    as_of = parse_date(data.get('as_of'), 'as_of').isoformat()

    slug_count: dict[str, int] = {}
    for packet in packets:
        slug_count[packet['slug']] = slug_count.get(packet['slug'], 0) + 1

    results = []
    for packet in packets:
        findings: list[str] = []
        slug = packet['slug']
        if len(slug) > SLUG_MAX or _SLUG.fullmatch(slug) is None:
            findings.append(f'Slug must use lowercase letters, digits and single hyphens, at most {SLUG_MAX} characters.')
        if slug_count[slug] > 1:
            findings.append(f'Slug is used by {slug_count[slug]} packets; each packet needs its own.')
        title_length = len(packet['title'].strip())
        if not TITLE_RANGE[0] <= title_length <= TITLE_RANGE[1]:
            findings.append(f'Title is {plural(title_length, "character")}; the illustrative range is {TITLE_RANGE[0]}–{TITLE_RANGE[1]}.')
        valid = []
        invalid = []
        for number, source in enumerate(packet['sources'], start=1):
            url = normalize_url(source)
            if url is None:
                invalid.append(number)
            elif url not in valid:
                valid.append(url)
        findings.extend(f'Source {number} is not an http or https URL.' for number in invalid[:SOURCE_FINDINGS_LISTED])
        if len(invalid) > SOURCE_FINDINGS_LISTED:
            findings.append(f'{len(invalid) - SOURCE_FINDINGS_LISTED} more sources are not http or https URLs.')
        if len(valid) < MIN_SOURCES:
            findings.append(f'Needs at least {MIN_SOURCES} different http or https sources; found {len(valid)}.')
        entry: dict[str, Any] = {'slug': slug, 'title': packet['title'], 'sources': len(valid)}
        if packet['body'] is not None:
            words = len(packet['body'].split())
            entry['word_count'] = words
            if words < MIN_WORDS:
                findings.append(f'Body has {plural(words, "word")}; the illustrative minimum is {fmt(MIN_WORDS)}.')
        entry['status'] = 'needs_attention' if findings else 'ready'
        entry['findings'] = findings
        results.append(entry)

    ready = sum(1 for entry in results if entry['status'] == 'ready')
    return {
        'ok': ready == len(results),
        'basis': f'Supplied article packets only, as of {as_of}. No search data is read; editorial approval and site changes are separate.',
        'site': site,
        'language': language,
        'as_of': as_of,
        'summary': {
            'packets': len(results),
            'ready': ready,
            'needs_attention': len(results) - ready,
            'findings': sum(len(entry['findings']) for entry in results),
        },
        'packets': results,
        'rules': list(RULES),
    }
