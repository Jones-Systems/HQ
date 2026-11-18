"""Editorial time slots (``hq-editorial-timebox-v1``).

Mirrors ``checkSlot`` and the helpers in ``modules/social/core/timebox.ts``: a slot is exactly
``{start: 'HH:MM', duration_minutes, timezone}`` on a 15-minute grid, it needs a planning date, and its
first and last minute must each be one real wall-clock instant a whole number of minutes apart, so a
daylight-saving gap or repeat is rejected. The shared cases in
``modules/social/core/test/fixtures/planning-slot-cases.json`` run against this module.
"""

from __future__ import annotations

import functools
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, available_timezones

from .errors import ValidationError

SLOT_MESSAGES = {
    'date': 'Planning time needs a planning date',
    'shape': 'Planning time must have start, duration_minutes and timezone',
    'start': 'Use an HH:MM start on a 15-minute boundary',
    'duration': 'Duration must be 15-minute steps ending by midnight',
    'zone': 'Unknown time zone',
    'dst': 'That time is skipped, repeated or crosses a daylight-saving change',
}
SLOT_KEYS = ('start', 'duration_minutes', 'timezone')
PROBE_ZONE = 'America/New_York'

_ZONE_NAME = re.compile('[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)*')
_START = re.compile('(?:[01][0-9]|2[0-3]):(?:00|15|30|45)')
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_EPOCH_ORDINAL = date(1970, 1, 1).toordinal()
_SAFE_INTEGER = 2 ** 53 - 1


@functools.lru_cache(maxsize=1)
def _zone_names() -> frozenset[str]:
    return frozenset(available_timezones())


def load_zone(name: Any) -> ZoneInfo | None:
    """The IANA zone for ``name``, or None. Names are syntax-checked before touching the file system."""
    if not isinstance(name, str) or len(name) > 64 or _ZONE_NAME.fullmatch(name) is None:
        return None
    if name not in _zone_names():
        return None
    try:
        return ZoneInfo(name)
    except (KeyError, ValueError, OSError):
        return None


def timezone_data_available() -> bool:
    """True when the host can resolve ``America/New_York``, the gate for ``hq-editorial-timebox-v1``."""
    return load_zone(PROBE_ZONE) is not None


def _utc(seconds: int) -> datetime | None:
    try:
        return _EPOCH + timedelta(seconds=seconds)
    except OverflowError:
        return None


def _local(seconds: int, zone: ZoneInfo) -> datetime | None:
    instant = _utc(seconds)
    if instant is None:
        return None
    try:
        return instant.astimezone(zone)
    except (OverflowError, ValueError, OSError):
        return None


def _wall_seconds(day: date, minute: int) -> int:
    return (day.toordinal() - _EPOCH_ORDINAL) * 86400 + minute * 60


def slot_instant(day: date, minute: int, zone: ZoneInfo) -> int | None:
    """The unique UTC second at which ``zone`` shows ``day`` at ``minute``, or None if there is not exactly one."""
    wall = _wall_seconds(day, minute)
    offsets: set[int] = set()
    for hours in range(-48, 49, 6):
        local = _local(wall + hours * 3600, zone)
        if local is not None:
            offsets.add(int(local.utcoffset().total_seconds()))  # type: ignore[union-attr]
    matches = []
    for offset in offsets:
        instant = wall - offset
        local = _local(instant, zone)
        if (local is not None and local.date() == day and local.hour * 60 + local.minute == minute
                and local.second == 0):
            matches.append(instant)
    return matches[0] if len(matches) == 1 else None


def is_planning_date(value: str) -> bool:
    """True when ``date.fromisoformat(value).isoformat() == value`` would hold."""
    if re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}', value) is None:
        return False
    try:
        date(int(value[:4]), int(value[5:7]), int(value[8:]))
    except ValueError:
        return False
    return True


def check_slot(value: Any, planned_date: str, *, timezones: bool = True) -> dict[str, Any] | None:
    """The canonical slot for a non-null ``value``; None for null. Raises ValidationError.

    With ``timezones`` false the host cannot resolve zones, so any non-null slot is an unknown time zone.
    """
    if value is None:
        return None
    if not timezones:
        raise ValidationError(SLOT_MESSAGES['zone'])
    if not planned_date:
        raise ValidationError(SLOT_MESSAGES['date'])
    if not isinstance(value, dict) or len(value) != 3 or not all(key in value for key in SLOT_KEYS):
        raise ValidationError(SLOT_MESSAGES['shape'])
    start_text = value['start']
    if not isinstance(start_text, str) or _START.fullmatch(start_text) is None:
        raise ValidationError(SLOT_MESSAGES['start'])
    start = int(start_text[:2]) * 60 + int(start_text[3:])
    duration = value['duration_minutes']
    if (type(duration) is not int or abs(duration) > _SAFE_INTEGER or duration < 15 or duration % 15 != 0
            or start + duration > 1440):
        raise ValidationError(SLOT_MESSAGES['duration'])
    zone = load_zone(value['timezone'])
    if zone is None:
        raise ValidationError(SLOT_MESSAGES['zone'])
    day = date(int(planned_date[:4]), int(planned_date[5:7]), int(planned_date[8:]))
    first = slot_instant(day, start, zone)
    last = slot_instant(day, start + duration - 1, zone)
    if first is None or last is None or last - first != (duration - 1) * 60:
        raise ValidationError(SLOT_MESSAGES['dst'])
    return {'start': start_text, 'duration_minutes': duration, 'timezone': value['timezone']}


def revalidate_stored(slot: dict[str, Any] | None, planned_date: str, previous_date: str, *,
                      timezones: bool = True) -> dict[str, Any] | None:
    """What an update that omits ``planning_slot`` keeps: the stored slot, or None once it no longer fits.

    Without zone data a changed date cannot be checked, so the slot is dropped; an unchanged date keeps it.
    """
    if slot is None:
        return None
    if not timezones:
        return slot if planned_date == previous_date else None
    try:
        return check_slot(slot, planned_date, timezones=True)
    except ValidationError:
        return None
