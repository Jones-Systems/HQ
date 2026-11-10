"""Workbench registry: the tool catalog, fictional sample inputs and dispatch to one analyzer per tool.

Each analyzer module ``social_service.tools.<module>`` exports ``run(data, *, now) -> dict``. Analyzers
are HQ reference implementations, not the native Fieldnotes tools: pure, deterministic and offline
(standard library only, no file, network or process access). They raise ``ValueError`` with a
user-facing message for invalid input. Their outputs carry the fields HQ's result summaries read
(``modules/social/workbench/results.ts``); see spec.hq-social-backend#iface.service.001.
"""

from __future__ import annotations

import copy
import importlib
from datetime import datetime
from typing import Any

# Order and categories follow HQ's TOOL_IDS and TOOL_CATEGORIES (modules/social/core/port.ts).
CATALOG: tuple[dict[str, str], ...] = (
    {'id': 'tiktok-intelligence', 'name': 'TikTok signals', 'category': 'Discover', 'mark': 'TK',
     'description': 'Compare post snapshots you supply. No TikTok access or live discovery.'},
    {'id': 'x-intelligence', 'name': 'Signal inbox', 'category': 'Discover', 'mark': 'XI',
     'description': 'Sort feed items you supply into topics with traceable evidence. No live collection.'},
    {'id': 'x-studio', 'name': 'Writing studio', 'category': 'Create', 'mark': 'XS',
     'description': 'Turn your notes into a local first draft for a post, thread or article. Nothing is posted.'},
    {'id': 'seo-studio', 'name': 'SEO workbench', 'category': 'Create', 'mark': 'SE',
     'description': 'Check source-backed article packets for editorial readiness. No live search data.'},
    {'id': 'search-visibility', 'name': 'Search visibility', 'category': 'Measure', 'mark': 'SV',
     'description': 'Analyze answer-search observations you supply. No live queries.'},
    {'id': 'social-publisher', 'name': 'Channel preview', 'category': 'Plan', 'mark': 'CP',
     'description': 'Check text against channel profiles. It never publishes or schedules.'},
    {'id': 'reddit-opportunities', 'name': 'Reddit opportunities', 'category': 'Discover', 'mark': 'RE',
     'description': 'Find relevant conversations in a corpus you supply. No Reddit access.'},
    {'id': 'creator-relationships', 'name': 'Creator fit', 'category': 'Connect', 'mark': 'CR',
     'description': 'Rank creators you supply with explicit fit and missing-evidence reasons. No outreach.'},
)
TOOL_IDS: tuple[str, ...] = tuple(tool['id'] for tool in CATALOG)

MODULES: dict[str, str] = {
    'tiktok-intelligence': 'tiktok_intelligence',
    'x-intelligence': 'x_intelligence',
    'x-studio': 'x_studio',
    'seo-studio': 'seo_studio',
    'search-visibility': 'search_visibility',
    'social-publisher': 'social_publisher',
    'reddit-opportunities': 'reddit_opportunities',
    'creator-relationships': 'creator_relationships',
}

# Fictional sample inputs, identical to HQ's WORKBENCH_EXAMPLES (modules/social/workbench/fixtures/examples.ts).
SAMPLES: dict[str, dict[str, Any]] = {
    'x-studio': {
        'notes': 'Larkspur Tea Co. is hosting a free cupping hour on Saturday. Bring a mug and one question about steeping.',
        'format': 'short_post', 'audience': 'Local tea drinkers', 'intent': 'Invite people to taste and ask questions',
    },
    'social-publisher': {'caption': 'A fictional tea shop compares three steeping times. Which would you try first?', 'format': 'text'},
    'x-intelligence': {
        'topic': 'Neighborhood tea', 'terms': ['oolong', 'steeping'],
        'items': [
            {'id': 'fixture-item-1', 'title': 'A corner shop tries cold-brew oolong',
             'content_text': 'A fictional shop compared three steeping times. Customer preference is unknown.',
             'url': 'https://example.invalid/cold-brew'},
            {'id': 'fixture-item-2', 'title': 'Steeping questions at a market stall',
             'content_text': 'Visitors asked how long to steep green tea. No survey was run.'},
        ],
    },
    'tiktok-intelligence': {
        'niche': {'name': 'Fictional tea rituals', 'terms': ['oolong', 'gongfu']},
        'as_of': '2026-10-01T12:00:00Z',
        'batches': [
            {'manifest': {'batch_id': 'fixture-batch-1', 'observed_at': '2026-09-30T12:00:00Z', 'source': 'supplied snapshot'},
             'records': [{'post_id': 'fixture-post-1', 'views': 1200}, {'post_id': 'fixture-post-2', 'views': 860}]},
            {'manifest': {'batch_id': 'fixture-batch-2', 'observed_at': '2026-10-01T12:00:00Z', 'source': 'supplied snapshot'},
             'records': [{'post_id': 'fixture-post-1', 'views': 1500}]},
        ],
    },
    'seo-studio': {
        'config': {'site': 'example.invalid', 'language': 'en'},
        'packets': [{'slug': 'steeping-guide', 'title': 'A fictional steeping guide', 'sources': ['https://example.invalid/steeping']}],
        'as_of': '2026-10-01',
    },
    'search-visibility': {
        'panel': {'name': 'Fictional tea questions', 'queries': ['how long to steep oolong']},
        'entities': [{'name': 'Larkspur Tea Co.', 'kind': 'brand'}],
        'inventory': [{'url': 'https://example.invalid/steeping', 'title': 'Steeping guide'}],
        'answers': [{'query': 'how long to steep oolong', 'engine': 'fixture-engine', 'cited': ['https://example.invalid/steeping']}],
    },
    'reddit-opportunities': {
        'bundle': {'corpus': 'fixture-corpus', 'posts': [{'id': 'fixture-post-1', 'title': 'Which oolong for a beginner?'}]},
        'as_of': '2026-10-01T12:00:00Z',
    },
    'creator-relationships': {
        'batch': {'account_id': 'fixture-account', 'creators': [
            {'handle': 'fixture-creator-a', 'topics': ['tea']}, {'handle': 'fixture-creator-b', 'topics': ['cycling']}]},
        'niche_topics': ['tea', 'slow mornings'], 'brand_topics': ['tea'], 'as_of': '2026-10-01T12:00:00Z',
    },
}


def catalog() -> list[dict[str, str]]:
    """A fresh copy of the catalog for the workspace snapshot."""
    return [dict(tool) for tool in CATALOG]


def sample(tool: str) -> dict[str, Any]:
    """A fresh copy of the tool's fictional sample input; ``ValueError('Unknown tool')`` otherwise."""
    if tool not in SAMPLES:
        raise ValueError('Unknown tool')
    return copy.deepcopy(SAMPLES[tool])


def execute(tool: str, data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    """Run one analyzer on supplied input. Called only inside the network-denied worker process."""
    if tool not in MODULES:
        raise ValueError('Unknown tool')
    if not isinstance(data, dict):
        raise ValueError('Input must be a JSON object')
    module = importlib.import_module(f'{__name__}.{MODULES[tool]}')
    return module.run(data, now=now)
