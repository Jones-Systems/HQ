"""Request validation: the save, brand and run rules of ``modules/social/core/validate.ts``.

The order of checks and every message match ``checkDraft``, ``checkBrandName`` and
``checkRunSubmission``: title, body, channel, date, archive, slot, brand, then ID and version, then links.
The service additionally rejects keys outside the contract's closed field lists.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import dataclass
from typing import Any

from . import references, timebox
from .errors import ValidationError
from .tools import TOOL_IDS

CHANNELS = ('General', 'X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit', 'Article')
LIMITS = {'title': 200, 'body': 50_000, 'brand_name': 80, 'id': 32}
DEFAULT_BRAND_ID = 'default'
DEFAULT_BRAND_NAME = 'My workspace'
MAX_BODY_BYTES = 2_000_000

MESSAGES = {
    'unknown_channel': 'Unknown channel',
    'planned_date': 'Use a YYYY-MM-DD planning date',
    'planned_date_text': 'Planning date must be text',
    'archived': 'Invalid archive state',
    'unknown_brand': 'Unknown brand',
    'version': 'Version required',
    'conflict': 'This draft changed in another window. Close and reopen it before saving.',
    'run_input': 'Choose a known tool and supply a JSON object',
    'input_too_deep': 'Input is nested too deeply',
    'example_flag': 'Example label must be boolean',
    'queue_full': 'Run queue is full. Wait for a run to finish.',
    'run_id': 'Invalid run ID',
    'unknown_tool': 'Unknown tool',
    'body_size': 'Input must be 1–2,000,000 bytes',
    'json_required': 'JSON required',
    'json_object': 'JSON object required',
    'transfer_encoding': 'Transfer encoding not supported',
    'interrupted': 'Service restarted before completion; run again explicitly.',
    'links_invalid': references.LINKS_INVALID,
    'link_repeated': references.LINK_REPEATED,
}

DRAFT_FIELDS = ('title', 'body', 'brand_id', 'channel', 'planned_date', 'archived',
                'id', 'version', 'planning_slot', 'links')
BRAND_FIELDS = ('name',)
RUN_FIELDS = ('tool', 'input', 'is_example')
_RUN_ID = re.compile('[0-9a-f]{32}')
_SAFE_INTEGER = 2 ** 53 - 1


class _Unset:
    """Marks a field that the request did not carry, which is different from an explicit null."""

    def __repr__(self) -> str:
        return 'UNSET'

    def __bool__(self) -> bool:
        return False


UNSET: Any = _Unset()


def text_message(label: str, maximum: int, empty: bool = False) -> str:
    return f"{label} must be text, {'0' if empty else '1'}–{maximum} characters"


def reject_unknown_fields(data: dict[str, Any], allowed: tuple[str, ...]) -> None:
    for key in data:
        if key not in allowed:
            raise ValidationError(f'Unknown field: {key}')


def _text(value: Any, label: str, maximum: int, *, empty: bool = False, keep: bool = False) -> str:
    """Length is in code points of the raw value. The stored text is stripped unless ``keep`` (the body)."""
    if (not isinstance(value, str) or len(value) > maximum or (not empty and value.strip() == '')
            or not references.is_encodable(value)):
        raise ValidationError(text_message(label, maximum, empty))
    return value if keep else value.strip()


def _planned_date(value: Any) -> str:
    if value:
        if not isinstance(value, str) or not timebox.is_planning_date(value):
            raise ValidationError(MESSAGES['planned_date'])
        return value
    if value != '':
        raise ValidationError(MESSAGES['planned_date_text'])
    return ''


def _archived(value: Any) -> int:
    if not (isinstance(value, bool) or (type(value) is int and value in (0, 1))):
        raise ValidationError(MESSAGES['archived'])
    return 1 if value else 0


@dataclass(frozen=True)
class DraftInput:
    title: str
    body: str
    brand_id: str
    channel: str
    planned_date: str
    archived: int
    #: UNSET (omitted), None (clear) or a canonical slot.
    slot: Any
    #: UNSET (omitted) or the normalized references; [] clears.
    links: Any
    #: (id, version) for an update.
    target: tuple[str, int] | None


def check_draft(data: dict[str, Any], *, brand_ids: Collection[str], timezones: bool = True) -> DraftInput:
    reject_unknown_fields(data, DRAFT_FIELDS)
    title = _text(data.get('title'), 'Title', LIMITS['title'])
    body = _text(data.get('body', ''), 'Body', LIMITS['body'], empty=True, keep=True)
    channel = data.get('channel', 'General')
    if not isinstance(channel, str) or channel not in CHANNELS:
        raise ValidationError(MESSAGES['unknown_channel'])
    planned = _planned_date(data.get('planned_date', ''))
    archived = _archived(data.get('archived', False))
    slot = timebox.check_slot(data['planning_slot'], planned, timezones=timezones) if 'planning_slot' in data else UNSET
    brand = data.get('brand_id', DEFAULT_BRAND_ID)
    if not isinstance(brand, str) or brand not in brand_ids:
        raise ValidationError(MESSAGES['unknown_brand'])
    target = None
    if data.get('id'):
        identifier = _text(data['id'], 'ID', LIMITS['id'])
        version = data.get('version')
        if type(version) is not int or abs(version) > _SAFE_INTEGER:
            raise ValidationError(MESSAGES['version'])
        target = (identifier, version)
    links = references.check_links(data['links']) if 'links' in data else UNSET
    return DraftInput(title=title, body=body, brand_id=brand, channel=channel, planned_date=planned,
                      archived=archived, slot=slot, links=links, target=target)


def check_brand(data: dict[str, Any]) -> str:
    reject_unknown_fields(data, BRAND_FIELDS)
    return _text(data.get('name'), 'Brand name', LIMITS['brand_name'])


@dataclass(frozen=True)
class RunInput:
    tool: str
    input: dict[str, Any]
    is_example: bool


def check_run(data: dict[str, Any]) -> RunInput:
    reject_unknown_fields(data, RUN_FIELDS)
    tool, supplied = data.get('tool'), data.get('input')
    if not isinstance(tool, str) or tool not in TOOL_IDS or not isinstance(supplied, dict):
        raise ValidationError(MESSAGES['run_input'])
    is_example = data.get('is_example', False)
    if not isinstance(is_example, bool):
        raise ValidationError(MESSAGES['example_flag'])
    return RunInput(tool=tool, input=supplied, is_example=is_example)


def check_run_id(value: Any) -> str:
    if not isinstance(value, str) or _RUN_ID.fullmatch(value) is None:
        raise ValidationError(MESSAGES['run_id'])
    return value


def check_tool(value: Any) -> str:
    if not isinstance(value, str) or value not in TOOL_IDS:
        raise ValidationError(MESSAGES['unknown_tool'])
    return value
