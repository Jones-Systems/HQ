"""Authoritative validation for planning items, settings and imports.

The browser mirrors these rules for friendly feedback, but only this module
decides what the store accepts.
"""

from __future__ import annotations

import datetime as _dt
import ipaddress
import re
import unicodedata
from urllib.parse import unquote_to_bytes, urlsplit

from .dates import ID_RE, DateError, is_valid_timezone, new_id, normalize_date, shown_key, unsafe_text

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

_ISO_TS_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z\Z")


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
    if unsafe_text(text):
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
    if unsafe_text(text, "\n\t"):
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
    if isinstance(entry_id, str) and ID_RE.match(entry_id):
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


# Host checks follow the WHATWG URL host parser, so every accepted link also
# parses with the browser's new URL() instead of breaking the item's detail view.
_FORBIDDEN_HOST = frozenset("\t\n\r #%/:<>?@[\\]^|")
_IPV4_PART = {16: re.compile(r"[0-9A-Fa-f]*"), 8: re.compile(r"[0-7]*"), 10: re.compile(r"[0-9]+")}


def _ipv4_number(part: str) -> int | None:
    if part[:2] in ("0x", "0X"):
        digits, base = part[2:], 16
    elif len(part) > 1 and part[0] == "0":
        digits, base = part[1:], 8
    else:
        digits, base = part, 10
    if not _IPV4_PART[base].fullmatch(digits):
        return None
    return int(digits, base) if digits else 0


def _idn_label(label: str, *, decoded: bool) -> bool:
    # Browsers map and check international labels with UTS #46, which the
    # standard library does not implement. Accept only plain left-to-right
    # letters that it treats the same way; a decoded xn-- label must already be
    # in its mapped (case-folded NFKC) form.
    if not label or label.isascii():
        return False
    if decoded and unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", label).casefold()) != label:
        return False
    return all((ch.isascii() and (ch.isalnum() or ch == "-")) or (
        unicodedata.category(ch) in (("Ll",) if decoded else ("Ll", "Lu", "Lt"))
        and unicodedata.name(ch, "").startswith(("LATIN ", "GREEK ", "CYRILLIC "))) for ch in label)


def _ascii_host(host: str) -> bool:
    labels = host.split(".")
    if labels[-1] == "" and len(labels) > 1:
        labels.pop()
    last = labels[-1]
    if last and (last.isdigit() or _ipv4_number(last) is not None):
        # A host ending in a number must be a whole IPv4 address.
        numbers = [_ipv4_number(label) if label else None for label in labels]
        return (len(labels) <= 4 and None not in numbers and all(n <= 255 for n in numbers[:-1])
                and numbers[-1] < 256 ** (5 - len(labels)))
    for label in labels:
        if label.lower().startswith("xn--"):
            try:
                decoded = label[4:].lower().encode("ascii").decode("punycode")
            except (UnicodeError, ValueError):
                return False
            if not _idn_label(decoded, decoded=True):
                return False
    return True


def _valid_host(parts) -> bool:
    host = parts.hostname
    if not host:
        return False
    if "[" in parts.netloc.rpartition("@")[2]:
        try:
            ipaddress.IPv6Address(host)
        except ValueError:
            return False
        return "%" not in host
    try:
        host = unquote_to_bytes(host).decode("utf-8")
        if not host.isascii():
            if not all(label.isascii() or _idn_label(label, decoded=False) for label in host.split(".")):
                return False
            host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    if not host or unsafe_text(host) or _FORBIDDEN_HOST.intersection(host):
        return False
    return _ascii_host(host)


def _safe_url(url: str) -> bool:
    if " " in url or unsafe_text(url):
        return False
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018 - raises for a non-numeric or out-of-range port
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and _valid_host(parts)


# ReferenceEnvelope text follows ECMAScript trim and UTF-16 length, unlike
# Planner labels, which keep the existing Python whitespace/code-point rules.
_JS_SPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_HQ_DOMAINS = ("design", "social", "work")


def _hq_text(value: object, limit: int = 160) -> bool:
    return (isinstance(value, str) and bool(value) and value.strip(_JS_SPACE) == value
            and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 <= limit
            and not unsafe_text(value))


def _hq_target(value: object) -> dict | None:
    if not isinstance(value, dict) or set(value) - {
        "version", "domain", "projectId", "kind", "entityId", "title",
        "returnDestination", "sourceRevision", "workspaceId",
    }:
        return None
    destination = value.get("returnDestination")
    if (type(value.get("version")) not in (int, float) or value["version"] != 1
            or value.get("domain") not in _HQ_DOMAINS
            or not all(_hq_text(value.get(key)) for key in ("projectId", "kind", "entityId"))
            or not _hq_text(value.get("title"), 300)
            or not isinstance(destination, dict)
            or set(destination) - {"domain", "destination"}
            or destination.get("domain") not in _HQ_DOMAINS
            or not _hq_text(destination.get("destination"), 512)):
        return None
    route = destination["destination"]
    if re.match(r"^[a-z\u017f\u212a][a-z0-9\u017f\u212a+.-]*:|^[/\\]{2}", route, re.IGNORECASE | re.ASCII):
        return None
    if any(key in value and not _hq_text(value[key], limit)
           for key, limit in (("sourceRevision", 300), ("workspaceId", 160))):
        return None
    return {**value, "version": 1, "returnDestination": dict(destination)}


def _hq_reference(raw: dict, index: int, errors: list, targets: set) -> dict | None:
    malformed = {"field": "references", "message": f"Reference {index + 1} is malformed."}
    if set(raw) - {"id", "kind", "label", "target"}:
        errors.append(malformed)
        return None
    ref_id = _entry_id(raw)
    target = _hq_target(raw.get("target"))
    if target is None:
        errors.append({"field": "references", "message": f"Reference {index + 1} has an invalid HQ target."})
        return None
    label = "" if raw.get("label") is None else _single_line(raw["label"], "references", MAX_REF_LABEL, errors)
    if label is None:
        return None
    shown = label or target["title"]
    if len(shown) > MAX_REF_LABEL:
        errors.append({"field": "references", "message": f"Limited to {MAX_REF_LABEL} characters."})
        return None
    # Preserve Work's slash-joined identity semantics, including delimiter collisions.
    key = f"{target['domain']}/{target['kind']}/{target['entityId']}"
    if key in targets:
        errors.append({"field": "references", "message": f"Reference {index + 1} duplicates another HQ link."})
        return None
    if ref_id is None:
        errors.append(malformed)
        return None
    targets.add(key)
    return {"id": ref_id, "kind": "hq", "label": shown, "target": target}


def _references(value: object, errors: list) -> list | None:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({"field": "references", "message": "Must be a list."})
        return None
    if len(value) > MAX_REFS:
        errors.append({"field": "references", "message": f"Limited to {MAX_REFS} references."})
        return None
    out, seen, targets = [], set(), set()
    for i, raw in enumerate(value):
        if isinstance(raw, dict) and raw.get("kind") == "hq":
            ref = _hq_reference(raw, i, errors, targets)
            if ref is None:
                return None
            if ref["id"] in seen:
                errors.append({"field": "references", "message": f"Reference {i + 1} is malformed."})
                return None
            seen.add(ref["id"])
            out.append(ref)
            continue
        if not isinstance(raw, dict) or set(raw) - {"id", "kind", "label", "url"}:
            errors.append({"field": "references", "message": f"Reference {i + 1} is malformed."})
            return None
        ref_id = _entry_id(raw)
        kind = raw.get("kind")
        if kind in (None, ""):
            kind = "url"
        if kind not in REFERENCE_KINDS:
            errors.append({"field": "references", "message": f"Reference {i + 1} has an unknown kind."})
            return None
        raw_label = raw.get("label")
        label = "" if raw_label is None else _single_line(raw_label, "references", MAX_REF_LABEL, errors)
        if label is None:
            return None
        url = "" if raw.get("url") is None else raw["url"]
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
            field = "dates" if exc.field == "dates" else f"dates.{exc.field}"
            errors.append({"field": field, "message": exc.message})
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
        names = ", ".join(shown_key(name) for name in sorted(unknown))
        errors.append({"field": "body", "message": f"Unknown field(s): {names}."})
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
    return isinstance(value, str) and bool(ID_RE.match(value))
