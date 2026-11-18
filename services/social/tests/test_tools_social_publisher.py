"""Channel preview: offline text checks against five illustrative channel profiles."""

from __future__ import annotations

import copy
import re
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, social_publisher

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
QUALIFICATION = 'Offline text preparation only. Account access and media are unverified; no consent or posting occurs.'
PLATFORMS = ['x', 'linkedin', 'instagram', 'tiktok', 'facebook']
LIMITS = {'x': 280, 'linkedin': 3_000, 'instagram': 2_200, 'tiktok': 2_200, 'facebook': 63_206}


def run(caption: object = None, **extra: object) -> dict:
    data: dict = {} if caption is None else {'caption': caption}
    data.update(extra)
    return social_publisher.run(data, now=NOW)


def findings(result: dict, platform: str) -> dict[str, str]:
    channel = next(channel for channel in result['channels'] if channel['platform'] == platform)
    return {finding['rule_id']: finding['status'] for finding in channel['findings']}


class SampleTests(unittest.TestCase):
    def test_sample_checks_five_channels_in_order(self) -> None:
        result = social_publisher.run(copy.deepcopy(SAMPLES['social-publisher']), now=NOW)
        self.assertEqual(result['qualification'], QUALIFICATION)
        self.assertEqual([channel['platform'] for channel in result['channels']], PLATFORMS)
        self.assertEqual(result['channels_checked'], 5)
        self.assertEqual(result['caption_fits'], 5)
        self.assertEqual(result['caption_characters'], len(SAMPLES['social-publisher']['caption']))

    def test_every_channel_has_the_documented_shape(self) -> None:
        result = social_publisher.run(copy.deepcopy(SAMPLES['social-publisher']), now=NOW)
        for channel in result['channels']:
            platform = channel['platform']
            with self.subTest(platform=platform):
                self.assertEqual(set(channel), {'platform', 'caption', 'capability', 'findings'})
                self.assertEqual(set(channel['capability']), {'text_only_supported', 'media_required', 'illustrative_limit'})
                self.assertEqual(channel['capability']['illustrative_limit'], LIMITS[platform])
                for finding in channel['findings']:
                    self.assertEqual(set(finding), {'rule_id', 'status', 'detail'})
                    self.assertIn(finding['status'], ('pass', 'fail'))
                    self.assertTrue(finding['rule_id'].startswith(platform + '.'))
                    self.assertIsInstance(finding['detail'], str)

    def test_rules_per_platform(self) -> None:
        result = social_publisher.run(copy.deepcopy(SAMPLES['social-publisher']), now=NOW)
        self.assertEqual(findings(result, 'x'), {'x.caption': 'pass', 'x.owner_scope': 'fail'})
        self.assertEqual(findings(result, 'linkedin'), {'linkedin.caption': 'pass', 'linkedin.owner_scope': 'fail'})
        self.assertEqual(findings(result, 'instagram'), {'instagram.caption': 'pass', 'instagram.format': 'fail', 'instagram.owner_scope': 'fail'})
        self.assertEqual(findings(result, 'tiktok'), {'tiktok.caption': 'pass', 'tiktok.format': 'fail', 'tiktok.owner_scope': 'fail'})
        self.assertEqual(findings(result, 'facebook'), {'facebook.caption': 'pass', 'facebook.owner_scope': 'fail'})

    def test_capabilities(self) -> None:
        result = social_publisher.run(copy.deepcopy(SAMPLES['social-publisher']), now=NOW)
        needs_media = {channel['platform']: channel['capability']['media_required'] for channel in result['channels']}
        self.assertEqual(needs_media, {'x': False, 'linkedin': False, 'instagram': True, 'tiktok': True, 'facebook': False})
        text_only = {channel['platform']: channel['capability']['text_only_supported'] for channel in result['channels']}
        self.assertEqual(text_only, {'x': True, 'linkedin': True, 'instagram': False, 'tiktok': False, 'facebook': True})

    def test_deterministic(self) -> None:
        self.assertEqual(run('Same text.'), run('Same text.'))

    def test_format_text_is_accepted(self) -> None:
        self.assertEqual(run('Some text.', format='text'), run('Some text.'))


class CaptionLimitTests(unittest.TestCase):
    def test_each_limit_passes_at_the_limit_and_fails_one_over(self) -> None:
        for platform, limit in (('x', 280), ('linkedin', 3_000), ('instagram', 2_200), ('tiktok', 2_200)):
            with self.subTest(platform=platform):
                self.assertEqual(findings(run('a' * limit), platform)[f'{platform}.caption'], 'pass')
                self.assertEqual(findings(run('a' * (limit + 1)), platform)[f'{platform}.caption'], 'fail')

    def test_facebook_never_fails_within_the_caption_ceiling(self) -> None:
        self.assertEqual(findings(run('a' * 30_000), 'facebook')['facebook.caption'], 'pass')

    def test_limits_are_counted_in_code_points_not_bytes(self) -> None:
        self.assertEqual(findings(run('\U0001F600' * 280), 'x')['x.caption'], 'pass')
        self.assertEqual(findings(run('\U0001F600' * 281), 'x')['x.caption'], 'fail')

    def test_details_say_the_limits_are_illustrative(self) -> None:
        result = run('a' * 300)
        details = {finding['rule_id']: finding['detail'] for channel in result['channels'] for finding in channel['findings']}
        self.assertEqual(details['x.caption'], 'Caption is 300 characters, 20 over the illustrative limit of 280.')
        self.assertEqual(details['linkedin.caption'], 'Caption is 300 characters; the illustrative limit is 3,000.')
        self.assertIn('illustrative', result['basis'])

    def test_caption_descriptor_reports_remaining_room(self) -> None:
        channels = {channel['platform']: channel['caption'] for channel in run('a' * 300)['channels']}
        self.assertEqual(channels['x'], {'characters': 300, 'illustrative_limit': 280, 'remaining': -20, 'fits': False})
        self.assertEqual(channels['linkedin'], {'characters': 300, 'illustrative_limit': 3_000, 'remaining': 2_700, 'fits': True})

    def test_owner_scope_always_fails_and_whitespace_is_kept(self) -> None:
        result = run('  padded caption \n')
        self.assertEqual(result['caption_characters'], len('  padded caption \n'))
        for platform in PLATFORMS:
            self.assertEqual(findings(result, platform)[f'{platform}.owner_scope'], 'fail')

    def test_the_wording_never_claims_an_effect(self) -> None:
        text = repr(run('a' * 300)).casefold()
        self.assertIsNone(re.search(r'\b(published|posted|scheduled|connected|live)\b', text))


class InvalidInputTests(unittest.TestCase):
    def test_format_other_than_text_is_refused(self) -> None:
        for value in ('video', 'image', 'Text', '', 5, ['text'], {'a': 1}, True):
            with self.subTest(value=value), self.assertRaises(ValueError) as caught:
                run('A caption.', format=value)
            self.assertEqual(str(caught.exception), 'This workbench accepts text only; media checks are not available in HQ')

    def test_caption(self) -> None:
        with self.assertRaisesRegex(ValueError, '^caption must be text$'):
            social_publisher.run({}, now=NOW)
        with self.assertRaisesRegex(ValueError, '^caption must be text$'):
            run(12)
        with self.assertRaisesRegex(ValueError, '^caption cannot be blank$'):
            run('  \n ')
        with self.assertRaisesRegex(ValueError, '^caption must be at most 30,000 characters$'):
            run('a' * 30_001)
        with self.assertRaisesRegex(ValueError, '^caption contains characters that cannot be stored$'):
            run('bad \udfff')

    def test_caption_ceiling_counts_code_points(self) -> None:
        self.assertEqual(run('\U0001F600' * 30_000)['caption_characters'], 30_000)
        with self.assertRaisesRegex(ValueError, '^caption must be at most 30,000 characters$'):
            run('\U0001F600' * 30_001)


if __name__ == '__main__':
    unittest.main()
