"""Authoritative validation for planning items, settings and imports.

The browser mirrors these rules for friendly feedback, but only this module
decides what the store accepts.
"""

from __future__ import annotations

import datetime as _dt
import re
from urllib.parse import urlsplit

from .dates import DateError, is_valid_timezone, new_id, normalize_date

STATUSES = ("inbox", "considering", "next", "active", "on_hold", "done", "dropped")
KINDS = ("project", "idea", "goal", "chore")
MOTIVATIONS = ("need", "want", "exploring")
HORIZONS = ("now", "soon", "later", "someday")
PRIORITIES = ("high", "normal", "low")
REFERENCE_KINDS = ("url", "doc", "repo", "pr", "project", "workstream", "other")

MAX_TITLE = 200
MAX_NOTES = 20_000
MAX_AREA = 40
MAX_STEPS = 100
MAX_STEP_TEXT = 300
MAX_REFS = 30
MAX_REF_LABEL = 200
MAX_REF_URL = 2_000
MAX_DATES = 20

EDITABLE_FIELDS = (
    "title", "kind", "status", "motivation", "horizon", "priority", "area",
    "notes", "next_steps", "references", "dates",
)

DEFAULT_SETTINGS = {
    "default_tz": "America/New_York",
    "week_start": "sun",
    "stale_days": 21,
}

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
_ISO_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


class ValidationError(ValueError):
    """Aggregated field errors; ``errors`` is a list of {field, message}."""

    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in errors))
        self.errors = errors


def _single_line(value: object, field: str, limit: int, errors: list, *, required: bool = False):
    if value is None:
        if required:
            errors.append({"field": field, "message": "Required."})
        return None
    if not isinstance(value, str):
        errors.append({"field": field, "message": "Must be text."})
        return None
    text = " ".join(value.split())
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        errors.append({"field": field, "message": "Contains unsupported control characters."})
        return None
    if required and not text:
        errors.append({"field": field, "message": "Required."})
        return None
    if len(text) > limit:
        errors.append({"field": field, "message": f"Limited to {limit} characters."})
        return None
    return text


def _multiline(value: object, field: str, limit: int, errors: list) -> str | None:
    if value is None:
        return ""
    if not isinstance(value, str):
        errors.append({"field": field, "message": "Must be text."})
        return None
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) > limit:
        errors.append({"field": field, "message": f"Limited to {limit} characters."})
        return None
    if any(ord(ch) < 32 and ch not in "\n\t" for ch in text):
        errors.append({"field": field, "message": "Contains unsupported control characters."})
        return None
    return text


def _enum(value: object, field: str, options: tuple, errors: list, *, nullable: bool):
    if value is None or value == "":
        if nullable:
            return None
        errors.append({"field": field, "message": "Required."})
        return None
    if value not in options:
        errors.append({"field": field, "message": f"Choose one of: {', '.join(options)}."})
        return None
    return value


def _entry_id(raw: dict) -> str | None:
    entry_id = raw.get("id")
    if entry_id in (None, ""):
        return new_id()
    if isinstance(entry_id, str) and _ID_RE.match(entry_id):
        return entry_id
    return None


def _steps(value: object, errors: list) -> list | None:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({"field": "next_steps", "message": "Must be a list."})
        return None
    if len(value) > MAX_STEPS:
        errors.append({"field": "next_steps", "message": f"Limited to {MAX_STEPS} steps."})
        return None
    out, seen = [], set()
    for i, raw in enumerate(value):
        if not isinstance(raw, dict) or set(raw) - {"id", "text", "done"}:
            errors.append({"field": "next_steps", "message": f"Step {i + 1} is malformed."})
            return None
        step_id = _entry_id(raw)
        text = _single_line(raw.get("text"), "next_steps", MAX_STEP_TEXT, errors, required=True)
        done = raw.get("done", False)
        if text is None:
            return None
        if step_id is None or step_id in seen or not isinstance(done, bool):
            errors.append({"field": "next_steps", "message": f"Step {i + 1} is malformed."})
            return None
        seen.add(step_id)
        out.append({"id": step_id, "text": text, "done": done})
    return out


def _safe_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.netloc) and not any(
        ord(ch) < 33 for ch in url
    )


def _references(value: object, errors: list) -> list | None:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({"field": "references", "message": "Must be a list."})
        return None
    if len(value) > MAX_REFS:
        errors.append({"field": "references", "message": f"Limited to {MAX_REFS} references."})
        return None
    out, seen = [], set()
    for i, raw in enumerate(value):
        if not isinstance(raw, dict) or set(raw) - {"id", "kind", "label", "url"}:
            errors.append({"field": "references", "message": f"Reference {i + 1} is malformed."})
            return None
        ref_id = _entry_id(raw)
        kind = raw.get("kind") or "url"
        if kind not in REFERENCE_KINDS:
            errors.append({"field": "references", "message": f"Reference {i + 1} has an unknown kind."})
            return None
        raw_label = raw.get("label")
        label = "" if raw_label is None else _single_line(raw_label, "references", MAX_REF_LABEL, errors)
        if label is None:
            return None
        url = raw.get("url") or ""
        if not isinstance(url, str) or len(url) > MAX_REF_URL:
            errors.append({"field": "references", "message": f"Reference {i + 1} link is too long or invalid."})
            return None
        url = url.strip()
        if url and not _safe_url(url):
            errors.append({"field": "references",
                           "message": f"Reference {i + 1} link must be an http(s) address."})
            return None
        if not label and not url:
            errors.append({"field": "references", "message": f"Reference {i + 1} needs a label or link."})
            return None
        if ref_id is None or ref_id in seen:
            errors.append({"field": "references", "message": f"Reference {i + 1} is malformed."})
            return None
        seen.add(ref_id)
        out.append({"id": ref_id, "kind": kind, "label": label or url, "url": url})
    return out


def _dates(value: object, errors: list) -> list | None:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({"field": "dates", "message": "Must be a list."})
        return None
    if len(value) > MAX_DATES:
        errors.append({"field": "dates", "message": f"Limited to {MAX_DATES} dates."})
        return None
    out, seen = [], set()
    for i, raw in enumerate(value):
        try:
            entry = normalize_date(raw, i)
        except DateError as exc:
            errors.append({"field": f"dates.{exc.field}", "message": exc.message})
            return None
        if entry["id"] in seen:
            errors.append({"field": "dates", "message": "Duplicate date id."})
            return None
        seen.add(entry["id"])
        out.append(entry)
    return out


def normalize_fields(raw: object, *, creating: bool) -> dict:
    """Validate a create body or a patch. Only supplied keys are returned for patches."""
    if not isinstance(raw, dict):
        raise ValidationError([{"field": "body", "message": "Expected an object of fields."}])
    errors: list[dict] = []
    unknown = set(raw) - set(EDITABLE_FIELDS)
    if unknown:
        errors.append({"field": "body", "message": f"Unknown field(s): {', '.join(sorted(unknown))}."})
    if not creating and not raw:
        errors.append({"field": "body", "message": "Nothing to change."})

    out: dict = {}

    def has(key: str) -> bool:
        return creating or key in raw

    if has("title"):
        out["title"] = _single_line(raw.get("title"), "title", MAX_TITLE, errors, required=True)
    if has("kind"):
        out["kind"] = _enum(raw.get("kind", "idea") if creating else raw.get("kind"),
                            "kind", KINDS, errors, nullable=False)
    if has("status"):
        out["status"] = _enum(raw.get("status", "inbox") if creating else raw.get("status"),
                              "status", STATUSES, errors, nullable=False)
    if has("motivation"):
        out["motivation"] = _enum(raw.get("motivation"), "motivation", MOTIVATIONS, errors, nullable=True)
    if has("horizon"):
        out["horizon"] = _enum(raw.get("horizon"), "horizon", HORIZONS, errors, nullable=True)
    if has("priority"):
        out["priority"] = _enum(raw.get("priority"), "priority", PRIORITIES, errors, nullable=True)
    if has("area"):
        area = _single_line(raw.get("area"), "area", MAX_AREA, errors)
        out["area"] = area or None
    if has("notes"):
        out["notes"] = _multiline(raw.get("notes"), "notes", MAX_NOTES, errors)
    if has("next_steps"):
        out["next_steps"] = _steps(raw.get("next_steps"), errors)
    if has("references"):
        out["references"] = _references(raw.get("references"), errors)
    if has("dates"):
        out["dates"] = _dates(raw.get("dates"), errors)

    if errors:
        raise ValidationError(errors)
    return out


def normalize_batch(raw: object) -> tuple[list[dict], bool]:
    if not isinstance(raw, dict):
        raise ValidationError([{"field": "body", "message": "Expected an object."}])
    errors = []
    if set(raw) - {"items", "dry_run"}:
        errors.append({"field": "body", "message": "Only items and dry_run are accepted."})
    dry_run = raw.get("dry_run", False)
    if not isinstance(dry_run, bool):
        errors.append({"field": "dry_run", "message": "Must be a boolean."})
    items = raw.get("items")
    values = []
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        errors.append({"field": "items", "message": "Provide 1 to 50 items."})
    else:
        for index, item in enumerate(items):
            try:
                values.append(normalize_fields(item, creating=True))
            except ValidationError as exc:
                errors.extend({"field": f"items[{index}].{e['field']}", "message": e["message"]}
                              for e in exc.errors)
    if errors:
        raise ValidationError(errors)
    return values, dry_run


def normalize_settings(raw: object, current: dict) -> dict:
    if not isinstance(raw, dict) or not raw:
        raise ValidationError([{"field": "settings", "message": "Expected settings to change."}])
    errors: list[dict] = []
    out = dict(current)
    for key, value in raw.items():
        if key == "default_tz":
            if is_valid_timezone(value):
                out[key] = value
            else:
                errors.append({"field": key, "message": "Unknown time zone."})
        elif key == "week_start":
            if value in ("sun", "mon"):
                out[key] = value
            else:
                errors.append({"field": key, "message": "Choose sun or mon."})
        elif key == "stale_days":
            if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 365:
                out[key] = value
            else:
                errors.append({"field": key, "message": "Use a whole number of days from 1 to 365."})
        else:
            errors.append({"field": key, "message": "Unknown setting."})
    if errors:
        raise ValidationError(errors)
    return out


def is_timestamp(value: object) -> bool:
    if not isinstance(value, str) or not _ISO_TS_RE.match(value):
        return False
    try:
        _dt.datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return False
    return True


def is_item_id(value: object) -> bool:
    return isinstance(value, str) and bool(_ID_RE.match(value))
