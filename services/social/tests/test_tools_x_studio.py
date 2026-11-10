"""Writing studio: deterministic composition of supplied notes."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from social_service.tools import SAMPLES, x_studio

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def run(**overrides: object) -> dict:
    data = copy.deepcopy(SAMPLES['x-studio'])
    data.update(overrides)
    return x_studio.run(data, now=NOW)


def texts(result: dict) -> list[str]:
    return [block['text'] for block in result['content']['blocks']]


def sentence(index: int, length: int = 100) -> str:
    """A sentence of exactly ``length`` characters, unique per index."""
    stem = f'Sentence {index} says '
    body = ('word ' * length)[:length - len(stem) - 1].rstrip().ljust(length - len(stem) - 1, 'x')
    return f'{stem}{body}.'


class SampleTests(unittest.TestCase):
    def test_sample_composes_a_short_post_from_the_notes(self) -> None:
        result = x_studio.run(copy.deepcopy(SAMPLES['x-studio']), now=NOW)
        self.assertEqual(result['format'], 'short_post')
        self.assertEqual(result['audience'], 'Local tea drinkers')
        self.assertEqual(result['intent'], 'Invite people to taste and ask questions')
        self.assertEqual(result['content'], {'blocks': [{'kind': 'post', 'text': SAMPLES['x-studio']['notes']}]})
        self.assertEqual(result['checks']['input_sentences'], 2)
        self.assertEqual(result['checks']['output_characters'], len(SAMPLES['x-studio']['notes']))
        self.assertTrue(result['checks']['within_post_limit'])
        self.assertIn('Unreviewed local draft', result['review_notes'][0])
        self.assertTrue(result['basis'].startswith('Supplied text only.'))

    def test_deterministic(self) -> None:
        for format_ in ('short_post', 'thread', 'article'):
            with self.subTest(format=format_):
                self.assertEqual(run(format=format_), run(format=format_))

    def test_defaults_apply_to_missing_or_blank_values(self) -> None:
        result = x_studio.run({'notes': 'One thing to say.'}, now=NOW)
        self.assertEqual((result['format'], result['audience'], result['intent']), ('short_post', 'Readers', 'Explain supplied material'))
        blank = x_studio.run({'notes': 'One thing to say.', 'audience': '  ', 'intent': None, 'format': None}, now=NOW)
        self.assertEqual((blank['format'], blank['audience'], blank['intent']), ('short_post', 'Readers', 'Explain supplied material'))

    def test_unknown_top_level_keys_are_ignored(self) -> None:
        self.assertEqual(run(extra='kept by the form'), run())

    def test_audience_and_intent_do_not_change_the_wording(self) -> None:
        self.assertEqual(texts(run(audience='A', intent='B')), texts(run(audience='C', intent='D')))
        self.assertTrue(any('do not change the wording' in note for note in run()['review_notes']))


class SentenceSplitTests(unittest.TestCase):
    def test_boundaries_and_non_boundaries(self) -> None:
        cases = {
            'Larkspur Tea Co. is hosting a free hour. Bring a mug.': ['Larkspur Tea Co. is hosting a free hour.', 'Bring a mug.'],
            'Dr. Smith will talk. He starts at noon.': ['Dr. Smith will talk.', 'He starts at noon.'],
            'It costs 3.5 dollars. Fine.': ['It costs 3.5 dollars.', 'Fine.'],
            'See example.invalid for more. Thanks!': ['See example.invalid for more.', 'Thanks!'],
            'Is it ready? yes it is. Good!': ['Is it ready?', 'yes it is.', 'Good!'],
            'He said "go." Then left.': ['He said "go."', 'Then left.'],
            'Wait... what happened?': ['Wait...', 'what happened?'],
            'No terminator here': ['No terminator here'],
            'Line one.\n\nLine   two.': ['Line one.', 'Line two.'],
            'J. Smith wrote it. Done.': ['J. Smith wrote it.', 'Done.'],
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(x_studio.split_sentences(text), expected)


class ShortPostTests(unittest.TestCase):
    def test_long_notes_are_cut_at_a_sentence_boundary_with_a_review_note(self) -> None:
        notes = ' '.join(sentence(index) for index in range(6))
        result = run(notes=notes)
        (post,) = texts(result)
        self.assertLessEqual(len(post), 280)
        self.assertTrue(post.endswith('.'))
        self.assertTrue(notes.startswith(post))
        self.assertEqual(post, ' '.join(sentence(index) for index in range(2)))
        self.assertTrue(any('kept 2 of 6 sentences' in note for note in result['review_notes']))

    def test_exactly_280_characters_fit(self) -> None:
        exact = sentence(1, 280)
        self.assertEqual(len(exact), 280)
        result = run(notes=exact)
        self.assertEqual(texts(result), [exact])
        self.assertFalse(any('kept' in note for note in result['review_notes']))

    def test_two_sentences_that_overflow_by_one_keep_only_the_first(self) -> None:
        result = run(notes=sentence(1, 140) + ' ' + sentence(2, 140))  # 281 characters joined
        self.assertEqual(texts(result), [sentence(1, 140)])

    def test_one_overlong_sentence_is_shortened_at_a_word_boundary(self) -> None:
        notes = 'Steeping ' + 'oolong leaves slowly ' * 30 + 'matters.'
        result = run(notes=notes)
        (post,) = texts(result)
        self.assertLessEqual(len(post), 280)
        self.assertTrue(post.endswith('…'))
        self.assertTrue(notes.startswith(post[:-1].rstrip()))
        self.assertTrue(any('shortened at a word boundary' in note for note in result['review_notes']))

    def test_one_unbroken_word_is_cut_hard(self) -> None:
        (post,) = texts(run(notes='x' * 1_000))
        self.assertEqual(len(post), 280)
        self.assertTrue(post.endswith('…'))

    def test_length_is_counted_in_code_points(self) -> None:
        (post,) = texts(run(notes='\U0001F600' * 280))
        self.assertEqual(post, '\U0001F600' * 280)
        (cut,) = texts(run(notes='\U0001F600' * 281))
        self.assertEqual(len(cut), 280)


class ThreadTests(unittest.TestCase):
    def test_posts_are_numbered_and_within_the_limit(self) -> None:
        sentences = [sentence(index, 120) for index in range(5)]
        result = run(format='thread', notes=' '.join(sentences))
        posts = texts(result)
        self.assertEqual(len(posts), 3)  # two 120-character sentences fit per post
        for number, post in enumerate(posts, start=1):
            self.assertTrue(post.startswith(f'{number}/3 '))
            self.assertLessEqual(len(post), 280)
        self.assertEqual(' '.join(post.split(' ', 1)[1] for post in posts), ' '.join(sentences))
        self.assertEqual({block['kind'] for block in result['content']['blocks']}, {'post'})
        self.assertEqual(result['checks']['blocks'], 3)

    def test_two_digit_totals_reserve_room_for_the_wider_numbering(self) -> None:
        sentences = [sentence(index, 270) for index in range(12)]
        posts = texts(run(format='thread', notes=' '.join(sentences)))
        self.assertEqual(len(posts), 12)
        self.assertTrue(posts[0].startswith('1/12 '))
        self.assertTrue(posts[-1].startswith('12/12 '))
        self.assertEqual(' '.join(post.split(' ', 1)[1] for post in posts), ' '.join(sentences))

    def test_numbering_width_is_reserved_at_the_exact_boundary(self) -> None:
        # 276 characters fit beside "1/9 " but not beside "12/24 ", so the wider prefix must force a split.
        sentences = [sentence(index, 276) for index in range(12)]
        posts = texts(run(format='thread', notes=' '.join(sentences)))
        total = len(posts)
        self.assertGreater(total, 12)
        self.assertTrue(all(len(post) <= 280 for post in posts), [len(post) for post in posts])
        self.assertTrue(all(post.startswith(f'{number}/{total} ') for number, post in enumerate(posts, start=1)))
        self.assertEqual(' '.join(post.split(' ', 1)[1] for post in posts), ' '.join(sentences))
        single_digit = texts(run(format='thread', notes=sentence(1, 276) + ' ' + sentence(2, 276)))
        self.assertEqual([len(post) for post in single_digit], [276 + 4, 276 + 4])

    def test_a_sentence_longer_than_a_post_is_split_at_word_boundaries(self) -> None:
        words = [f'word{index}' for index in range(150)]
        notes = ' '.join(words) + '.'
        result = run(format='thread', notes=notes)
        posts = texts(result)
        self.assertGreaterEqual(len(posts), 3)
        self.assertTrue(all(len(post) <= 280 for post in posts))
        self.assertEqual(' '.join(post.split(' ', 1)[1] for post in posts), notes)
        self.assertTrue(any('split at a word boundary' in note for note in result['review_notes']))

    def test_a_single_unbroken_word_is_cut_hard_across_posts(self) -> None:
        posts = texts(run(format='thread', notes='y' * 600))
        self.assertTrue(all(len(post) <= 280 for post in posts))
        self.assertEqual(''.join(post.split(' ', 1)[1] for post in posts), 'y' * 600)

    def test_short_notes_become_one_numbered_post_with_a_hint(self) -> None:
        result = run(format='thread', notes='Just one thing.')
        self.assertEqual(texts(result), ['1/1 Just one thing.'])
        self.assertTrue(any('short post format' in note for note in result['review_notes']))

    def test_maximal_notes_stay_bounded(self) -> None:
        result = run(format='thread', notes=' '.join(sentence(index, 200) for index in range(99)))
        self.assertTrue(all(len(post) <= 280 for post in texts(result)))
        self.assertLess(len(texts(result)), 500)


class ArticleTests(unittest.TestCase):
    def test_heading_from_the_first_sentence_and_paragraph_blocks(self) -> None:
        result = run(format='article')
        self.assertEqual(result['content']['blocks'], [
            {'kind': 'heading', 'text': 'Larkspur Tea Co. is hosting a free cupping hour on Saturday'},
            {'kind': 'paragraph', 'text': 'Bring a mug and one question about steeping.'},
        ])
        self.assertIsNone(result['checks']['post_limit'])

    def test_blank_line_paragraphs_are_kept(self) -> None:
        result = run(format='article', notes='Title sentence. First body line.\n\nSecond paragraph here.\n\n\nThird one.')
        self.assertEqual(result['content']['blocks'], [
            {'kind': 'heading', 'text': 'Title sentence'},
            {'kind': 'paragraph', 'text': 'First body line.'},
            {'kind': 'paragraph', 'text': 'Second paragraph here.'},
            {'kind': 'paragraph', 'text': 'Third one.'},
        ])

    def test_a_long_run_of_sentences_is_grouped_into_paragraphs_of_three(self) -> None:
        result = run(format='article', notes=' '.join(f'Point {index} is made.' for index in range(1, 9)))
        blocks = result['content']['blocks']
        self.assertEqual(blocks[0], {'kind': 'heading', 'text': 'Point 1 is made'})
        self.assertEqual([block['text'] for block in blocks[1:]],
                         ['Point 2 is made. Point 3 is made. Point 4 is made.', 'Point 5 is made. Point 6 is made. Point 7 is made.', 'Point 8 is made.'])

    def test_a_bare_period_never_makes_an_empty_heading(self) -> None:
        heading = run(format='article', notes='. Then the real text follows.')['content']['blocks'][0]
        self.assertEqual(heading, {'kind': 'heading', 'text': '.'})

    def test_a_single_sentence_is_a_heading_only_with_a_note(self) -> None:
        result = run(format='article', notes='Only one sentence.')
        self.assertEqual(result['content']['blocks'], [{'kind': 'heading', 'text': 'Only one sentence'}])
        self.assertTrue(any('heading only' in note for note in result['review_notes']))

    def test_a_long_first_sentence_is_shortened_in_the_heading_but_kept_whole_in_the_body(self) -> None:
        first = 'Steeping ' + 'slowly ' * 40 + 'matters.'
        result = run(format='article', notes=first + ' Second.')
        heading, *body = result['content']['blocks']
        self.assertLessEqual(len(heading['text']), 120)
        self.assertTrue(heading['text'].endswith('…'))
        self.assertEqual(body[0]['text'], first + ' Second.')
        self.assertTrue(any('heading is shortened' in note for note in result['review_notes']))

    def test_thousands_of_tiny_paragraphs_are_joined_to_keep_the_block_count_bounded(self) -> None:
        notes = '\n\n'.join(f'p{index}.' for index in range(2_000))
        result = run(format='article', notes=notes)
        blocks = result['content']['blocks']
        self.assertEqual(blocks[0], {'kind': 'heading', 'text': 'p0'})
        self.assertLessEqual(len(blocks), 300)
        self.assertEqual(' '.join(block['text'] for block in blocks[1:]).split(), [f'p{index}.' for index in range(1, 2_000)])
        self.assertTrue(any('neighbouring paragraphs were joined' in note for note in result['review_notes']))

    def test_every_word_of_the_notes_is_kept(self) -> None:
        notes = 'Alpha beta. Gamma delta.\n\nEpsilon zeta. Eta theta iota.'
        text = ' '.join(texts(run(format='article', notes=notes))).replace('.', '')
        self.assertEqual(text.split(), notes.replace('.', '').split())


class InvalidInputTests(unittest.TestCase):
    def assertRejects(self, message: str, **overrides: object) -> None:
        with self.assertRaises(ValueError) as caught:
            run(**overrides)
        self.assertEqual(str(caught.exception), message)

    def test_notes(self) -> None:
        self.assertRejects('notes must be text', notes=None)
        self.assertRejects('notes must be text', notes=12)
        self.assertRejects('notes cannot be blank', notes='  \n\t ')
        self.assertRejects('notes cannot be blank', notes='')
        self.assertRejects('notes must be at most 20,000 characters', notes='a' * 20_001)
        self.assertRejects('notes contains characters that cannot be stored', notes='lone \ud800 surrogate')
        with self.assertRaisesRegex(ValueError, '^notes must be text$'):
            x_studio.run({}, now=NOW)

    def test_notes_at_the_limit_in_code_points_are_accepted(self) -> None:
        self.assertEqual(run(notes='\U0001F600' * 20_000)['checks']['input_characters'], 20_000)
        self.assertRejects('notes must be at most 20,000 characters', notes='\U0001F600' * 20_001)

    def test_format_audience_and_intent(self) -> None:
        self.assertRejects('format must be short_post, thread or article', format='carousel')
        self.assertRejects('format must be short_post, thread or article', format=3)
        self.assertRejects('audience must be text', audience=5)
        self.assertRejects('audience must be at most 200 characters', audience='a' * 201)
        self.assertRejects('intent must be text', intent=['x'])
        self.assertRejects('intent must be at most 300 characters', intent='a' * 301)

    def test_nesting_and_non_finite_numbers(self) -> None:
        deep: object = 'x'
        for _ in range(40):
            deep = [deep]
        self.assertRejects('Input is nested too deeply (limit 16 levels)', extra=deep)
        self.assertRejects('Input numbers must be finite', extra=float('nan'))


if __name__ == '__main__':
    unittest.main()
