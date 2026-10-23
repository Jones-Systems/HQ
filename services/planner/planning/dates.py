"""Typed planning dates.

A planning date is never an invented day. Each entry carries an explicit kind
(target, deadline, start, event) and precision (day, week, month, quarter,
year). Only day-precision entries may carry a wall-clock time, and a timed
entry must name an IANA time zone so the stored wall time keeps its meaning.
Derived UTC instants are computed on read and are never accepted as input.
"""

from __future__ import annotations

import datetime as _dt
import re
import secrets
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

DATE_KINDS = ("target", "deadline", "start", "event")
PRECISIONS = ("day", "week", "month", "quarter", "year")
MAX_DATE_NOTE = 120
MIN_YEAR = 1900
MAX_YEAR = 2200

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")
_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
_QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$")
_YEAR_RE = re.compile(r"^(\d{4})$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class DateError(ValueError):
    """A single invalid date entry; ``field`` names the offending key."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


def new_id() -> str:
    return secrets.token_hex(8)


@lru_cache(maxsize=1)
def _zones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_valid_timezone(name: object) -> bool:
    if not isinstance(name, str) or not name or len(name) > 64:
        return False
    if name not in _zones():
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _check_year(year: int, field: str = "value") -> None:
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise DateError(field, f"Year must be between {MIN_YEAR} and {MAX_YEAR}.")


def period_bounds(precision: str, value: str) -> tuple[_dt.date, _dt.date]:
    """Return the inclusive first and last calendar day the value covers."""
    if precision == "day":
        m = _DAY_RE.match(value)
        if not m:
            raise DateError("value", "Use a day like 2026-11-14.")
        year = int(m.group(1))
        _check_year(year)
        try:
            day = _dt.date(year, int(m.group(2)), int(m.group(3)))
        except ValueError:
            raise DateError("value", "That calendar day does not exist.") from None
        return day, day
    if precision == "week":
        m = _WEEK_RE.match(value)
        if not m:
            raise DateError("value", "Use an ISO week like 2026-W46.")
        year = int(m.group(1))
        _check_year(year)
        try:
            first = _dt.date.fromisocalendar(year, int(m.group(2)), 1)
        except ValueError:
            raise DateError("value", "That ISO week does not exist.") from None
        return first, first + _dt.timedelta(days=6)
    if precision == "month":
        m = _MONTH_RE.match(value)
        if not m:
            raise DateError("value", "Use a month like 2026-11.")
        year, month = int(m.group(1)), int(m.group(2))
        _check_year(year)
        if not 1 <= month <= 12:
            raise DateError("value", "Month must be 01 to 12.")
        first = _dt.date(year, month, 1)
        nxt = _dt.date(year + (month == 12), month % 12 + 1, 1)
        return first, nxt - _dt.timedelta(days=1)
    if precision == "quarter":
        m = _QUARTER_RE.match(value)
        if not m:
            raise DateError("value", "Use a quarter like 2027-Q2.")
        year, quarter = int(m.group(1)), int(m.group(2))
        _check_year(year)
        first = _dt.date(year, 3 * quarter - 2, 1)
        end_month = 3 * quarter
        nxt = _dt.date(year + (end_month == 12), end_month % 12 + 1, 1)
        return first, nxt - _dt.timedelta(days=1)
    if precision == "year":
        m = _YEAR_RE.match(value)
        if not m:
            raise DateError("value", "Use a year like 2027.")
        year = int(m.group(1))
        _check_year(year)
        return _dt.date(year, 1, 1), _dt.date(year, 12, 31)
    raise DateError("precision", "Unknown precision.")


def _local_to_utc(day: _dt.date, hhmm: str, tz_name: str, field: str) -> _dt.datetime:
    hour, minute = (int(part) for part in hhmm.split(":"))
    zone = ZoneInfo(tz_name)
    local = _dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)
    as_utc = local.astimezone(_dt.timezone.utc)
    # A wall time inside a daylight-saving gap does not exist; round-tripping
    # through UTC exposes it by landing on a different wall-clock time.
    back = as_utc.astimezone(zone)
    if (back.hour, back.minute, back.date()) != (hour, minute, day):
        raise DateError(field, f"{hhmm} does not exist on {day.isoformat()} in {tz_name} (clock change).")
    return as_utc


def normalize_date(raw: object, index: int = 0) -> dict:
    """Validate one owner-supplied date entry and return its canonical form."""
    if not isinstance(raw, dict):
        raise DateError("dates", f"Date {index + 1} must be an object.")
    allowed = {"id", "kind", "precision", "value", "time", "end_time", "tz", "note",
               "instant", "end_instant", "tz_abbr"}
    unknown = set(raw) - allowed
    if unknown:
        raise DateError("dates", f"Date {index + 1} has unknown field(s): {', '.join(sorted(unknown))}.")

    entry_id = raw.get("id")
    if entry_id in (None, ""):
        entry_id = new_id()
    elif not isinstance(entry_id, str) or not _ID_RE.match(entry_id):
        raise DateError("id", "Date id is malformed.")

    kind = raw.get("kind")
    if kind not in DATE_KINDS:
        raise DateError("kind", "Choose target, deadline, start or event.")
    precision = raw.get("precision")
    if precision not in PRECISIONS:
        raise DateError("precision", "Choose day, week, month, quarter or year.")
    value = raw.get("value")
    if not isinstance(value, str):
        raise DateError("value", "A date value is required.")
    value = value.strip()
    start, _end = period_bounds(precision, value)

    time = raw.get("time") or None
    end_time = raw.get("end_time") or None
    tz = raw.get("tz") or None
    if time is not None:
        if precision != "day":
            raise DateError("time", "Only a specific day can have a time.")
        if not isinstance(time, str) or not _TIME_RE.match(time):
            raise DateError("time", "Use a 24-hour time like 14:30.")
        if not is_valid_timezone(tz):
            raise DateError("tz", "A timed date needs a valid time zone, such as America/New_York.")
        _local_to_utc(start, time, tz, "time")
        if end_time is not None:
            if not isinstance(end_time, str) or not _TIME_RE.match(end_time):
                raise DateError("end_time", "Use a 24-hour end time like 15:30.")
            if end_time <= time:
                raise DateError("end_time", "End time must be after the start time on the same day.")
            _local_to_utc(start, end_time, tz, "end_time")
    else:
        if end_time is not None:
            raise DateError("end_time", "An end time needs a start time.")
        if tz is not None:
            # A zone without a time carries no meaning for a calendar date.
            tz = None

    note = raw.get("note") or ""
    if not isinstance(note, str):
        raise DateError("note", "Date note must be text.")
    note = note.strip()
    if len(note) > MAX_DATE_NOTE:
        raise DateError("note", f"Date note is limited to {MAX_DATE_NOTE} characters.")
    if any(ord(ch) < 32 for ch in note):
        raise DateError("note", "Date note must be a single line.")

    return {
        "id": entry_id,
        "kind": kind,
        "precision": precision,
        "value": value,
        "time": time,
        "end_time": end_time,
        "tz": tz,
        "note": note,
    }


def with_derived(entry: dict) -> dict:
    """Return a copy with read-only derived instant fields for timed entries."""
    out = dict(entry)
    if entry.get("time") and entry.get("tz"):
        day, _ = period_bounds("day", entry["value"])
        start = _local_to_utc(day, entry["time"], entry["tz"], "time")
        out["instant"] = start.strftime("%Y-%m-%dT%H:%M:%SZ")
        out["tz_abbr"] = start.astimezone(ZoneInfo(entry["tz"])).tzname()
        if entry.get("end_time"):
            end = _local_to_utc(day, entry["end_time"], entry["tz"], "end_time")
            out["end_instant"] = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


def describe(entry: dict) -> str:
    """Human-readable single-line summary used in Markdown export and history."""
    precision, value = entry["precision"], entry["value"]
    if precision == "day":
        start, _ = period_bounds("day", value)
        text = start.strftime("%a %b %d %Y").replace(" 0", " ")
        if entry.get("time"):
            text += f" {entry['time']}"
            if entry.get("end_time"):
                text += f"–{entry['end_time']}"
            text += f" ({entry['tz']})"
    elif precision == "week":
        start, _ = period_bounds("week", value)
        text = f"week of {start.isoformat()} ({value})"
    elif precision == "month":
        start, _ = period_bounds("month", value)
        text = start.strftime("%B %Y")
    elif precision == "quarter":
        year, quarter = value.split("-")
        text = f"{quarter} {year}"
    else:
        text = value
    return f"{entry['kind']}: {text}"
