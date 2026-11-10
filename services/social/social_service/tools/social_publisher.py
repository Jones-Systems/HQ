"""Channel preview: offline text checks against five illustrative channel profiles.

Nothing here reaches a network, an account or a platform. The character limits are illustrative profile
values, not any platform's current rule, and account ownership and access are never supplied.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._common import check_input, fmt, short_text

CAPTION_MAX = 30_000
QUALIFICATION = 'Offline text preparation only. Account access and media are unverified; no consent or posting occurs.'
BASIS = 'Supplied text only. Character limits are illustrative profile values, not any platform\'s current rule.'
TEXT_ONLY_MESSAGE = 'This workbench accepts text only; media checks are not available in HQ'

# platform, illustrative character limit, whether the profile needs media
_PROFILES: tuple[tuple[str, int, bool], ...] = (
    ('x', 280, False),
    ('linkedin', 3_000, False),
    ('instagram', 2_200, True),
    ('tiktok', 2_200, True),
    ('facebook', 63_206, False),
)


def _channel(platform: str, limit: int, needs_media: bool, caption: str) -> dict[str, Any]:
    characters = len(caption)
    fits = characters <= limit
    findings = [{
        'rule_id': f'{platform}.caption',
        'status': 'pass' if fits else 'fail',
        'detail': (f'Caption is {fmt(characters)} characters; the illustrative limit is {fmt(limit)}.' if fits
                   else f'Caption is {fmt(characters)} characters, {fmt(characters - limit)} over the illustrative limit of {fmt(limit)}.'),
    }]
    if needs_media:
        findings.append({
            'rule_id': f'{platform}.format',
            'status': 'fail',
            'detail': 'This channel profile needs media, and text-only content is not supported. Media checks are not available in HQ.',
        })
    findings.append({
        'rule_id': f'{platform}.owner_scope',
        'status': 'fail',
        'detail': 'Account ownership and access were not supplied, so this channel cannot be checked.',
    })
    return {
        'platform': platform,
        'caption': {'characters': characters, 'illustrative_limit': limit, 'remaining': limit - characters, 'fits': fits},
        'capability': {'text_only_supported': not needs_media, 'media_required': needs_media, 'illustrative_limit': limit},
        'findings': findings,
    }


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    format_value = data.get('format')
    if format_value is not None and format_value != 'text':
        raise ValueError(TEXT_ONLY_MESSAGE)
    caption = short_text(data.get('caption'), 'caption', CAPTION_MAX, strip=False)
    channels = [_channel(platform, limit, needs_media, caption) for platform, limit, needs_media in _PROFILES]
    passing = sum(1 for channel in channels if channel['caption']['fits'])
    return {
        'qualification': QUALIFICATION,
        'basis': BASIS,
        'caption_characters': len(caption),
        'channels_checked': len(channels),
        'caption_fits': passing,
        'channels': channels,
    }
