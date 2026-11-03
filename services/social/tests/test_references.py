"""HQ reference links: parity with ``parseReference`` and ``checkLinks``."""

import copy
import unittest

import support  # noqa: F401 - puts the service on sys.path

from social_service import references
from social_service.errors import ValidationError

BASE = {
    'version': 1, 'domain': 'work', 'projectId': 'project-1', 'kind': 'item', 'entityId': 'item-1',
    'title': 'Ship the launch checklist', 'returnDestination': {'domain': 'social', 'destination': 'library/draft-1'},
}


def reference(**changes):
    value = copy.deepcopy(BASE)
    for key, replacement in changes.items():
        if replacement is Ellipsis:
            value.pop(key, None)
        else:
            value[key] = replacement
    return value


def destination(text):
    return reference(returnDestination={'domain': 'social', 'destination': text})


class ParseReference(unittest.TestCase):
    def test_a_minimal_envelope_is_normalized_unchanged(self):
        self.assertEqual(references.parse_reference(BASE), BASE)

    def test_optional_provenance_is_preserved_in_order(self):
        value = reference(workspaceId='workspace-1', sourceRevision='rev-9')
        parsed = references.parse_reference(value)
        self.assertEqual(parsed['sourceRevision'], 'rev-9')
        self.assertEqual(parsed['workspaceId'], 'workspace-1')
        self.assertEqual(list(parsed)[-2:], ['sourceRevision', 'workspaceId'])

    def test_every_domain_is_accepted_and_others_are_not(self):
        for domain in references.DOMAIN_IDS:
            self.assertIsNotNone(references.parse_reference(reference(domain=domain)))
        for domain in ('Work', 'mail', '', None, 3, ['work']):
            self.assertIsNone(references.parse_reference(reference(domain=domain)), domain)

    def test_rejected_shapes(self):
        rejected = {
            'not an object': [], 'null': None, 'unknown key': {**BASE, 'extra': 1},
            'version 2': reference(version=2), 'version true': reference(version=True),
            'version float': reference(version=1.0), 'version text': reference(version='1'),
            'version missing': reference(version=Ellipsis),
            'empty project': reference(projectId=''), 'project number': reference(projectId=1),
            'kind missing': reference(kind=Ellipsis), 'entity missing': reference(entityId=Ellipsis),
            'title missing': reference(title=Ellipsis), 'return missing': reference(returnDestination=Ellipsis),
            'return array': reference(returnDestination=[]),
            'return extra key': reference(returnDestination={'domain': 'social', 'destination': 'a', 'x': 1}),
            'return domain': reference(returnDestination={'domain': 'mail', 'destination': 'a'}),
            'source null': reference(sourceRevision=None), 'source empty': reference(sourceRevision=''),
            'source too long': reference(sourceRevision='r' * 301),
            'workspace null': reference(workspaceId=None), 'workspace long': reference(workspaceId='w' * 161),
        }
        for name, value in rejected.items():
            self.assertIsNone(references.parse_reference(value), name)

    def test_text_matches_javascript_trim_and_control_rules(self):
        for bad in (' padded', 'padded ', 'a ', '﻿a', 'a ', 'a　', 'tab\there', 'new\nline',
                    'nul\x00', 'del\x7f', 'lone\ud800surrogate'):
            self.assertIsNone(references.parse_reference(reference(entityId=bad)), repr(bad))
        # Python's str.strip() trims these at the edges; JavaScript trim() does not, so they stay valid.
        for good in ('a\x85', '\x85a', 'a​', '​a'):
            self.assertIsNotNone(references.parse_reference(reference(entityId=good)), repr(good))
        # \x1c-\x1f are not JavaScript whitespace but are control characters.
        self.assertIsNone(references.parse_reference(reference(entityId='a\x1c')))

    def test_length_is_measured_in_utf16_units(self):
        self.assertIsNotNone(references.parse_reference(reference(title='x' * 300)))
        self.assertIsNone(references.parse_reference(reference(title='x' * 301)))
        self.assertIsNotNone(references.parse_reference(reference(title='😀' * 150)))  # 300 units
        self.assertIsNone(references.parse_reference(reference(title='😀' * 151)))  # 302 units
        self.assertIsNotNone(references.parse_reference(reference(projectId='p' * 160)))
        self.assertIsNone(references.parse_reference(reference(projectId='p' * 161)))

    def test_destinations_are_module_local_paths(self):
        for good in ('library/draft-1', 'path/with:colon', '/leading/slash', 'x' * 512):
            self.assertIsNotNone(references.parse_reference(destination(good)), good)
        for bad in ('https://example.invalid/x', 'javascript:alert(1)', 'mailto:a@b', 'a+b.c-d:x', '//host/x',
                    '\\\\host\\share', '/\\x', 'x' * 513, 'file:/x', 'K:x', 'ſ:x'):
            self.assertIsNone(references.parse_reference(destination(bad)), bad)


class CheckLinks(unittest.TestCase):
    def rejected(self, value):
        with self.assertRaises(ValidationError) as caught:
            references.check_links(value)
        return caught.exception.message

    def test_empty_and_normalized_lists(self):
        self.assertEqual(references.check_links([]), [])
        self.assertEqual(references.check_links([BASE]), [BASE])

    def test_list_rules_and_message(self):
        message = 'Links must be a list of 0–30 valid HQ references'
        for value in (None, {}, 'x', 3, [BASE, {'junk': 1}], [None]):
            self.assertEqual(self.rejected(value), message)
        many = [reference(entityId=f'item-{index}') for index in range(31)]
        self.assertEqual(self.rejected(many), message)
        self.assertEqual(len(references.check_links(many[:30])), 30)

    def test_a_target_can_be_linked_once(self):
        message = 'Each HQ reference can be linked once'
        self.assertEqual(self.rejected([BASE, reference(title='Same target, other title')]), message)
        self.assertEqual(self.rejected([BASE, reference(projectId='other-project', sourceRevision='r2')]), message)
        # Different domain, kind or entity is a different target.
        self.assertEqual(len(references.check_links([BASE, reference(domain='design'), reference(kind='board'),
                                                     reference(entityId='item-2')])), 4)

    def test_invalid_entries_are_reported_before_duplicates(self):
        message = 'Links must be a list of 0–30 valid HQ references'
        self.assertEqual(self.rejected([BASE, BASE, {'version': 3}]), message)


if __name__ == '__main__':
    unittest.main()
