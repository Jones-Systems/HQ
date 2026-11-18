"""Writing studio: a deterministic local composer for a post, a thread or an article.

It only rearranges the text it is given. It adds no claims, no voice and no personalization.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from ._common import check_input, optional_text, short_text

POST_LIMIT = 280
NOTES_MAX = 20_000
FORMATS = ('short_post', 'thread', 'article')
HEADING_MAX = 120
MAX_BLOCKS = 300
PARAGRAPH_SENTENCES = 3
DEFAULT_AUDIENCE = 'Readers'
DEFAULT_INTENT = 'Explain supplied material'

BASIS = 'Supplied text only. A local deterministic composer rearranges your notes; it adds no claims or voice, and nothing is sent anywhere.'

# A period after these is not read as the end of a sentence.
_ABBREVIATIONS = frozenset({'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp',
                            'no', 'e.g', 'i.e', 'approx', 'est', 'fig'})
_BOUNDARY = re.compile(r'([.!?…]+)(["\'”’)\]]*)(?:\s+|$)')


def split_sentences(text: str) -> list[str]:
    """Sentences of whitespace-normalized text, split after . ! ? or an ellipsis.

    A single period is not a boundary when a lowercase letter follows, or after a common abbreviation or a
    one-letter initial.
    """
    text = ' '.join(text.split())
    sentences: list[str] = []
    start = 0
    for match in _BOUNDARY.finditer(text):
        end = match.end()
        if match.group(1) == '.':
            following = text[end:end + 1]
            word = text[:match.start()].rsplit(' ', 1)[-1].lower().lstrip('("\'“‘[')
            if following.islower() or word in _ABBREVIATIONS or (len(word) == 1 and word.isalpha()):
                continue
        sentence = text[start:end].strip()
        if sentence:
            sentences.append(sentence)
        start = end
    tail = text[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def _chunks(text: str, width: int) -> list[str]:
    """``text`` cut at word boundaries into pieces of at most ``width`` characters. A single longer word is cut hard."""
    pieces: list[str] = []
    current = ''
    for word in text.split(' '):
        while len(word) > width:
            if current:
                pieces.append(current)
                current = ''
            pieces.append(word[:width])
            word = word[width:]
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += ' ' + word
        else:
            pieces.append(current)
            current = word
    if current:
        pieces.append(current)
    return pieces


def _shorten(text: str, limit: int) -> str:
    """At most ``limit`` characters, cut at a word boundary with an ellipsis."""
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    space = cut.rfind(' ')
    if space > 0:
        cut = cut[:space]
    return cut.rstrip(' ,;:-–—') + '…'


def _pack(sentences: list[str], width: int) -> tuple[list[str], bool]:
    """Sentences joined greedily into posts of at most ``width`` characters; a longer sentence is cut at word boundaries."""
    units: list[str] = []
    cut = False
    for sentence in sentences:
        if len(sentence) <= width:
            units.append(sentence)
        else:
            units.extend(_chunks(sentence, width))
            cut = True
    posts: list[str] = []
    current = ''
    for unit in units:
        if not current:
            current = unit
        elif len(current) + 1 + len(unit) <= width:
            current += ' ' + unit
        else:
            posts.append(current)
            current = unit
    if current:
        posts.append(current)
    return posts, cut


def _short_post(sentences: list[str], review: list[str]) -> list[dict[str, str]]:
    kept: list[str] = []
    for sentence in sentences:
        if len(' '.join(kept + [sentence])) <= POST_LIMIT:
            kept.append(sentence)
        else:
            break
    if kept:
        text = ' '.join(kept)
        if len(kept) < len(sentences):
            review.append(f'The notes were longer than one post: kept {len(kept)} of {len(sentences)} sentences. Review what was left out.')
    else:
        text = _shorten(sentences[0], POST_LIMIT)
        left_out = ' The rest of the notes are not in the post.' if len(sentences) > 1 else ''
        review.append(f'The first sentence is longer than {POST_LIMIT} characters, so it was shortened at a word boundary.{left_out} Review what was left out.')
    return [{'kind': 'post', 'text': text}]


def _thread(sentences: list[str], review: list[str]) -> list[dict[str, str]]:
    digits = 1
    while True:
        width = POST_LIMIT - (2 * digits + 2)  # room for "NN/NN "
        posts, cut = _pack(sentences, width)
        if len(str(len(posts))) <= digits:
            break
        digits = len(str(len(posts)))
    if cut:
        review.append('A sentence longer than one post was split at a word boundary. Review where the thread breaks.')
    if len(posts) == 1:
        review.append('The notes fit one post. The short post format may suit them better.')
    total = len(posts)
    return [{'kind': 'post', 'text': f'{index}/{total} {post}'} for index, post in enumerate(posts, start=1)]


def _paragraphs(sentences: list[str]) -> list[str]:
    """One paragraph, or paragraphs of three sentences when a source paragraph runs long."""
    if len(sentences) <= PARAGRAPH_SENTENCES + 1:
        return [' '.join(sentences)] if sentences else []
    return [' '.join(sentences[start:start + PARAGRAPH_SENTENCES]) for start in range(0, len(sentences), PARAGRAPH_SENTENCES)]


def _article(notes: str, review: list[str]) -> list[dict[str, str]]:
    paragraphs = [' '.join(part.split()) for part in re.split(r'\n\s*\n', notes)]
    paragraphs = [part for part in paragraphs if part]
    first = split_sentences(paragraphs[0])
    heading_source = first[0]
    heading = heading_source[:-1] if heading_source.endswith('.') and len(heading_source) > 1 else heading_source
    sentence_groups = [first[1:]] + [split_sentences(part) for part in paragraphs[1:]]
    if len(heading) > HEADING_MAX:
        heading = _shorten(heading, HEADING_MAX)
        sentence_groups[0] = first  # keep the whole first sentence in the body when the heading is shortened
        review.append(f'The first sentence is longer than {HEADING_MAX} characters, so the heading is shortened and the full sentence stays in the body.')
    blocks = [{'kind': 'heading', 'text': heading}]
    for sentences in sentence_groups:
        blocks.extend({'kind': 'paragraph', 'text': text} for text in _paragraphs(sentences))
    if len(blocks) == 1:
        review.append('The notes held a single sentence, so the article is a heading only.')
    body = blocks[1:]
    if len(body) > MAX_BLOCKS - 1:
        size = -(-len(body) // (MAX_BLOCKS - 1))
        joined = [{'kind': 'paragraph', 'text': ' '.join(block['text'] for block in body[start:start + size])} for start in range(0, len(body), size)]
        review.append(f'The notes held {len(body)} paragraphs, so neighbouring paragraphs were joined into {len(joined)}.')
        blocks = [blocks[0], *joined]
    return blocks


def run(data: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    check_input(data)
    notes_value = data.get('notes')
    notes = short_text(notes_value, 'notes', NOTES_MAX, strip=False)
    format_value = data.get('format')
    format_ = 'short_post' if format_value is None else format_value
    if format_ not in FORMATS:
        raise ValueError('format must be short_post, thread or article')
    audience = optional_text(data.get('audience'), 'audience', 200) or DEFAULT_AUDIENCE
    intent = optional_text(data.get('intent'), 'intent', 300) or DEFAULT_INTENT

    sentences = split_sentences(notes)
    review = ['Unreviewed local draft. Check every claim, name and first-person statement before use.',
              'Audience and intent are recorded for your review; they do not change the wording.']
    if format_ == 'short_post':
        blocks = _short_post(sentences, review)
    elif format_ == 'thread':
        blocks = _thread(sentences, review)
    else:
        blocks = _article(notes, review)

    longest = max(len(block['text']) for block in blocks)
    return {
        'basis': BASIS,
        'format': format_,
        'audience': audience,
        'intent': intent,
        'content': {'blocks': blocks},
        'checks': {
            'input_characters': len(notes),
            'input_sentences': len(sentences),
            'blocks': len(blocks),
            'output_characters': sum(len(block['text']) for block in blocks),
            'longest_block_characters': longest,
            'post_limit': POST_LIMIT if format_ != 'article' else None,
            'within_post_limit': longest <= POST_LIMIT if format_ != 'article' else None,
        },
        'review_notes': review,
    }
