"""HQ reference links on a draft (``hq-references-v1``).

``parse_reference`` mirrors ``parseReference`` in ``packages/contracts/src/index.ts``: closed keys, text
limits measured in UTF-16 code units, JavaScript ``trim()`` equality, no control characters, and a
destination that is neither a scheme-prefixed URL nor a network-path reference. ``check_links`` adds the
list rules of ``checkLinks`` in ``modules/social/core/validate.ts`` and the single-link-per-target rule.
"""

from __future__ import annotations

import re
from typing import Any

from .errors import ValidationError

DOMAIN_IDS = ('design', 'social', 'work', 'wiki')
MAX_LINKS = 30
LINKS_INVALID = f'Links must be a list of 0–{MAX_LINKS} valid HQ references'
LINK_REPEATED = 'Each HQ reference can be linked once'

_REFERENCE_KEYS = ('version', 'domain', 'projectId', 'kind', 'entityId', 'title', 'returnDestination',
                   'sourceRevision', 'workspaceId')
_DESTINATION_KEYS = ('domain', 'destination')

# ECMAScript WhiteSpace and LineTerminator, which is what String.prototype.trim removes.
JS_WHITESPACE = ('\t\n\x0b\x0c\r \xa0 ' + ''.join(chr(code) for code in range(0x2000, 0x200B))
                 + '    　﻿')
_CONTROL = re.compile('[\x00-\x1f\x7f]')
# /^[a-z][a-z\d+.-]*:|^[/\\]{2}/iu, where /i with /u also folds U+017F and U+212A onto s and k.
_SCHEME_OR_NETWORK_PATH = re.compile('[A-Za-zſK][A-Za-z0-9+.ſK-]*:|[/\\\\]{2}')


def is_encodable(value: str) -> bool:
    """False for lone surrogates, which JSON escapes can carry but UTF-8 storage cannot."""
    try:
        value.encode('utf-8')
    except UnicodeEncodeError:
        return False
    return True


def utf16_length(value: str) -> int:
    return len(value.encode('utf-16-le', 'surrogatepass')) // 2


def _text(value: Any, maximum: int = 160) -> bool:
    return (isinstance(value, str) and value != '' and utf16_length(value) <= maximum
            and value.strip(JS_WHITESPACE) == value and _CONTROL.search(value) is None and is_encodable(value))


def _destination(value: Any) -> bool:
    return _text(value, 512) and _SCHEME_OR_NETWORK_PATH.match(value) is None


def _closed(value: dict, allowed: tuple[str, ...]) -> bool:
    return all(key in allowed for key in value)


def parse_reference(value: Any) -> dict[str, Any] | None:
    """The normalized envelope, or None when ``value`` is not a valid HQ reference."""
    if not isinstance(value, dict) or not _closed(value, _REFERENCE_KEYS):
        return None
    if type(value.get('version')) is not int or value['version'] != 1:
        return None
    if value.get('domain') not in DOMAIN_IDS or not isinstance(value.get('domain'), str):
        return None
    if not (_text(value.get('projectId')) and _text(value.get('kind')) and _text(value.get('entityId'))
            and _text(value.get('title'), 300)):
        return None
    destination = value.get('returnDestination')
    if (not isinstance(destination, dict) or not _closed(destination, _DESTINATION_KEYS)
            or not isinstance(destination.get('domain'), str) or destination['domain'] not in DOMAIN_IDS
            or not _destination(destination.get('destination'))):
        return None
    if 'sourceRevision' in value and not _text(value['sourceRevision'], 300):
        return None
    if 'workspaceId' in value and not _text(value['workspaceId']):
        return None
    reference: dict[str, Any] = {
        'version': 1, 'domain': value['domain'], 'projectId': value['projectId'], 'kind': value['kind'],
        'entityId': value['entityId'], 'title': value['title'],
        'returnDestination': {'domain': destination['domain'], 'destination': destination['destination']},
    }
    if 'sourceRevision' in value:
        reference['sourceRevision'] = value['sourceRevision']
    if 'workspaceId' in value:
        reference['workspaceId'] = value['workspaceId']
    return reference


def check_links(value: Any) -> list[dict[str, Any]]:
    """Validate a ``links`` list. Raises ValidationError; returns the normalized references."""
    if not isinstance(value, list) or len(value) > MAX_LINKS:
        raise ValidationError(LINKS_INVALID)
    parsed = [parse_reference(item) for item in value]
    if any(item is None for item in parsed):
        raise ValidationError(LINKS_INVALID)
    seen: set[tuple[str, str, str]] = set()
    for reference in parsed:
        assert reference is not None
        target = (reference['domain'], reference['kind'], reference['entityId'])
        if target in seen:
            raise ValidationError(LINK_REPEATED)
        seen.add(target)
    return parsed  # type: ignore[return-value]
