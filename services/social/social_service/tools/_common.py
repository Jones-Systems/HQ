"""Shared validation and text helpers for the HQ reference analyzers.

Standard library only, and pure: no file, network, process, environment or clock access. Every helper
raises ``ValueError`` with a short, user-facing message, which the worker shows as the run's error.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

# Deepest nesting an input may have. The analyzers read at most five levels; deeper input is refused.
MAX_DEPTH = 16
MAX_URL = 1_000


def fmt(number: int) -> str:
    return f'{number:,}'


def count_range(low: int, high: int) -> str:
    return f'{fmt(low)}–{fmt(high)}'


# --- Whole-input shape --------------------------------------------------------------------------

def check_input(data: Any) -> None:
    """Refuse input that is not a plain, finite, shallow JSON object. Iterative, so depth cannot exhaust the stack."""
    if not isinstance(data, dict):
        raise ValueError('Input must be a JSON object')
    stack: list[tuple[Any, int]] = [(data, 1)]
    while stack:
        value, depth = stack.pop()
        if isinstance(value, dict):
            if depth > MAX_DEPTH:
                raise ValueError(f'Input is nested too deeply (limit {MAX_DEPTH} levels)')
            for key, item in value.items():
                if not isinstance(key, str):
                    raise ValueError('Input keys must be text')
                stack.append((item, depth + 1))
        elif isinstance(value, list):
            if depth > MAX_DEPTH:
                raise ValueError(f'Input is nested too deeply (limit {MAX_DEPTH} levels)')
            stack.extend((item, depth + 1) for item in value)
        elif isinstance(value, float):
            if not math.isfinite(value):
                raise ValueError('Input numbers must be finite')
        elif not (value is None or isinstance(value, (str, int, bool))):
            raise ValueError('Input must contain only plain JSON values')


# --- Field validators ---------------------------------------------------------------------------

def need_object(value: Any, message: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(message)
    return value


def need_list(value: Any, name: str, low: int, high: int, what: str) -> list[Any]:
    """A list of ``low``–``high`` entries, e.g. ``items must be a list of 1–5,000 feed items``."""
    if not isinstance(value, list) or not low <= len(value) <= high:
        size = count_range(low, high) if low else f'up to {fmt(high)}'
        raise ValueError(f'{name} must be a list of {size} {what}')
    return value


def _encodable(text: str) -> bool:
    try:
        text.encode('utf-8')
    except UnicodeEncodeError:
        return False
    return True


def any_text(value: Any, name: str, high: int) -> str:
    """Text of at most ``high`` code points. Blank is allowed."""
    if not isinstance(value, str):
        raise ValueError(f'{name} must be text')
    if len(value) > high:
        raise ValueError(f'{name} must be at most {fmt(high)} characters')
    if not _encodable(value):
        raise ValueError(f'{name} contains characters that cannot be stored')
    return value


def short_text(value: Any, name: str, high: int, *, strip: bool = True) -> str:
    """Required text, at most ``high`` code points, not blank. Stripped unless ``strip`` is false."""
    text = any_text(value, name, high)
    if not text.strip():
        raise ValueError(f'{name} cannot be blank')
    return text.strip() if strip else text


def optional_text(value: Any, name: str, high: int) -> str | None:
    """Optional text: ``None`` when absent, null or blank."""
    if value is None:
        return None
    text = any_text(value, name, high)
    return text.strip() or None


def text_list(value: Any, name: str, low: int, high: int, item_high: int, what: str, *, total_high: int | None = None) -> list[str]:
    """A list of non-blank strings, stripped and de-duplicated ignoring case (first spelling kept)."""
    entries = need_list(value, name, low, high, what)
    seen: set[str] = set()
    result: list[str] = []
    total = 0
    for index, entry in enumerate(entries):
        text = short_text(entry, f'{name} entry {index + 1}', item_high)
        total += len(text)
        key = fold(text)
        if key not in seen:
            seen.add(key)
            result.append(text)
    if total_high is not None and total > total_high:
        raise ValueError(f'{name} may hold at most {fmt(total_high)} characters in total')
    if len(result) < low:
        raise ValueError(f'{name} must be a list of {count_range(low, high)} {what}')
    return result


def whole_number(value: Any, name: str, *, low: int = 0, high: int = 1_000_000_000_000) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{name} must be a whole number from {fmt(low)} to {fmt(high)}')
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f'{name} must be a whole number from {fmt(low)} to {fmt(high)}')
        value = int(value)
    if not low <= value <= high:
        raise ValueError(f'{name} must be a whole number from {fmt(low)} to {fmt(high)}')
    return value


# --- Dates --------------------------------------------------------------------------------------

_DATETIME = re.compile(
    r'([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?(Z|[+-][0-9]{2}:[0-9]{2})')
_DATE = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})')


def parse_datetime(value: Any, name: str) -> datetime:
    """An ISO-8601 date-time with ``Z`` or an offset, as an aware UTC datetime. No local time zones are used."""
    message = f'{name} must be an ISO-8601 date and time with a zone, such as 2026-10-01T12:00:00Z'
    if not isinstance(value, str):
        raise ValueError(message)
    match = _DATETIME.fullmatch(value)
    if match is None:
        raise ValueError(message)
    year, month, day, hour, minute, second, fraction, zone = match.groups()
    if int(hour) > 23 or int(minute) > 59 or int(second or 0) > 59:
        raise ValueError(message)
    if zone == 'Z':
        offset = timedelta(0)
    else:
        if int(zone[1:3]) > 23 or int(zone[4:6]) > 59:
            raise ValueError(message)
        offset = timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6])) * (-1 if zone[0] == '-' else 1)
    microsecond = int((fraction or '0').ljust(6, '0')[:6])
    try:
        moment = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second or 0), microsecond,
                          tzinfo=timezone(offset))
        return moment.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError(message) from None


def parse_date(value: Any, name: str) -> date:
    message = f'{name} must be a date in YYYY-MM-DD form, such as 2026-10-01'
    if not isinstance(value, str):
        raise ValueError(message)
    match = _DATE.fullmatch(value)
    if match is None:
        raise ValueError(message)
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        raise ValueError(message) from None


def days_between(later: datetime, earlier: datetime) -> float:
    """Exact elapsed days between two aware datetimes, rounded to two places. UTC arithmetic: no DST."""
    return round((later - earlier).total_seconds() / 86_400, 2)


# --- URLs ---------------------------------------------------------------------------------------

_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_URL = re.compile(r'(https?)://(\[[0-9A-Fa-f:.]+\]|[^\s/?#@:\[\]]+)(?::([0-9]{1,5}))?([/?#][^\s]*)?', re.IGNORECASE)


def normalize_url(value: Any) -> str | None:
    """The comparison form of an http or https URL, or ``None`` when it is not one.

    The scheme and host are lower-cased, a default port and any fragment are dropped, an empty path becomes
    ``/`` and a trailing slash is removed from longer paths. Credentials in a URL are not accepted.
    """
    if not isinstance(value, str) or len(value) > MAX_URL or _CONTROL.search(value):
        return None
    match = _URL.fullmatch(value)
    if match is None:
        return None
    scheme, host, port, rest = match.groups()
    scheme = scheme.lower()
    if port is not None and not 0 < int(port) <= 65535:
        return None
    rest = rest or ''
    rest = rest.split('#', 1)[0]
    path, _, query = rest.partition('?')
    if path == '':
        path = '/'
    elif len(path) > 1:
        path = path.rstrip('/') or '/'
    default = '80' if scheme == 'http' else '443'
    authority = host.lower() + (f':{port}' if port is not None and port != default else '')
    return f'{scheme}://{authority}{path}' + (f'?{query}' if query else '')


def url_list(value: Any, name: str, high: int, cache: dict[str, str | None] | None = None) -> list[str]:
    """A list of up to ``high`` http or https URLs, in normalized form, in the order supplied.

    ``cache`` lets one run normalize each distinct URL once.
    """
    entries = need_list(value, name, 0, high, 'http or https URLs')
    result = []
    for index, entry in enumerate(entries):
        if cache is not None and isinstance(entry, str):
            if entry not in cache:
                cache[entry] = normalize_url(entry)
            url = cache[entry]
        else:
            url = normalize_url(entry)
        if url is None:
            raise ValueError(f'{name} entry {index + 1} must be an http or https URL of at most {fmt(MAX_URL)} characters')
        result.append(url)
    return result


# --- Text ---------------------------------------------------------------------------------------

def fold(text: str) -> str:
    """Case-folded text with every run of whitespace collapsed to one space."""
    return ' '.join(text.casefold().split())


def _is_word(ch: str) -> bool:
    return ch.isalnum() or ch == '_' or '̀' <= ch <= 'ͯ'


def contains_term(folded_text: str, folded_term: str) -> bool:
    """Whether ``folded_term`` occurs in ``folded_text`` as a whole word or phrase (both already folded)."""
    if not folded_term:
        return False
    check_before = _is_word(folded_term[0])
    check_after = _is_word(folded_term[-1])
    start = 0
    while True:
        index = folded_text.find(folded_term, start)
        if index < 0:
            return False
        end = index + len(folded_term)
        if ((not check_before or index == 0 or not _is_word(folded_text[index - 1]))
                and (not check_after or end == len(folded_text) or not _is_word(folded_text[end]))):
            return True
        start = index + 1


def matched_terms(folded_text: str, terms: list[str], folded_terms: list[str]) -> list[str]:
    """The terms (as supplied, in supplied order) that occur in the folded text."""
    return [term for term, key in zip(terms, folded_terms) if contains_term(folded_text, key)]


def quote_list(items: list[str], limit: int = 3) -> str:
    """``"a"``, ``"a" and "b"``, ``"a", "b" and "c"`` or ``"a", "b", "c" and 2 more``."""
    shown = [f'"{item}"' for item in items[:limit]]
    extra = len(items) - len(shown)
    if extra > 0:
        return ', '.join(shown) + f' and {extra} more'
    if len(shown) <= 1:
        return ''.join(shown)
    return ', '.join(shown[:-1]) + f' and {shown[-1]}'


def plural(count: int, one: str, many: str | None = None) -> str:
    return f'{count} {one if count == 1 else many or one + "s"}'


def ratio(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def sort_key(text: str) -> tuple[str, str]:
    return (text.casefold(), text)
