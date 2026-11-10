# HQ Social reference analyzers

Eight analyzers, one per HQ workbench. Each is `social_service/tools/<module>.py` exporting
`run(data: dict, *, now: datetime) -> dict`. The registry in `__init__.py` (`CATALOG`, `SAMPLES`, `MODULES`,
`execute`) maps a tool id to its module; it is owned by the service, not by this document.

They are HQ-authored reference implementations written from HQ's own input builders
(`modules/social/workbench/inputs.ts`), summarizers (`results.ts`) and the service spec
(`spec.hq-social-backend#iface.service.001`). They are not ports of any native tool, and no private source,
data or fixtures were used. Every example here is fictional (`example.invalid`).

## Contract common to all eight

- **Pure and deterministic.** Standard library only (`re`, `math`, `datetime`, `typing`). No file, network,
  subprocess, environment or clock access. `now` is accepted and unused: every date a result needs comes from the
  input's `as_of`. The same input always gives an identical result, with stable ordering.
- **Invalid input raises `ValueError`** with a short, specific message; the worker shows it as the run's error.
  Nothing else escapes. Lengths are counted in code points. Lone surrogates are refused.
- **Bounded.** Inputs are limited in list length, string length and nesting (16 levels, checked iteratively before
  anything else). Numbers must be finite. Results hold at most 300 entries in any list and stay under about 560 KB
  for inputs at every bound (the worker cap is 1,500,000 bytes).
- **Unknown keys are ignored when harmless.** Extra top-level keys and extra keys inside nested documents (a JSON
  Feed item's `content_html`, a creator's `bio`, a TikTok record's `caption`) are neither read nor echoed. Only the
  keys named below are read.
- **Honest wording.** Every result carries a `basis` that says what it was computed from (supplied data, as of
  a date). Results never claim collection, live data, posting, account access, verified facts or personalization.
- **Dates** are ISO-8601 with `Z` or an offset (`2026-10-01T12:00:00Z`), except SEO's `as_of`
  (`YYYY-MM-DD`). Everything is converted to UTC and compared by instant, so elapsed days are exact and unaffected
  by daylight-saving changes. `age_days` and similar are floats rounded to two places.
- **URLs** are accepted only as `http` or `https` without credentials, at most 1,000 characters. For comparison
  the scheme and host are lower-cased, a default port and any fragment are dropped, an empty path becomes `/` and a
  trailing slash is removed.
- **Term matching** (Signal inbox, Reddit, Creator fit, entity mentions) is case-folded (`str.casefold`), collapses
  whitespace and matches whole words or phrases: `tea` matches `Tea, please` and `iced-tea` but not `teapot`.

## `x-studio` — Writing studio

Input: `notes` (required, 1–20,000 characters, not blank), `format` (`short_post` default, `thread`, `article`),
`audience` (default `Readers`, at most 200), `intent` (default `Explain supplied material`, at most 300). A blank
`audience`/`intent` takes the default. `audience` and `intent` are recorded and do not change the wording.

Result: `basis`, `format`, `audience`, `intent`, `content.blocks[] {kind, text}`, `checks`
(`input_characters`, `input_sentences`, `blocks`, `output_characters`, `longest_block_characters`, `post_limit`,
`within_post_limit`) and `review_notes[]`.

The composer only rearranges the supplied text. Sentences end at `.` `!` `?` or an ellipsis; a single period is not a
boundary before a lowercase letter, after a common abbreviation (`Co.`, `Dr.`, `e.g.`) or after a one-letter initial.

- `short_post`: one `post` block of at most 280 characters made of whole leading sentences. A first sentence that is
  too long is cut at a word boundary and ends with `…`. A review note says what was left out.
- `thread`: `post` blocks of at most 280 characters including the `1/3 ` prefix, packed from whole sentences. A
  sentence longer than a post is split at word boundaries (one very long word is cut hard).
- `article`: a `heading` block from the first sentence (trailing period removed, shortened to 120 characters when
  longer, in which case the full sentence stays in the body) and `paragraph` blocks. Blank-line paragraphs are kept;
  a paragraph of more than four sentences is split into groups of three.

## `social-publisher` — Channel preview

Input: `caption` (required text, 1–30,000 characters), `format` (absent or `text`). Any other `format` raises
`This workbench accepts text only; media checks are not available in HQ`.

Result: `qualification` (`Offline text preparation only. Account access and media are unverified; no consent or posting occurs.`),
`basis`, `caption_characters`, `channels_checked`, `caption_fits`, and `channels[]` in the order x, linkedin,
instagram, tiktok, facebook. Each channel is
`{platform, caption {characters, illustrative_limit, remaining, fits}, capability {text_only_supported, media_required, illustrative_limit}, findings[] {rule_id, status, detail}}`.

| Platform | Illustrative limit | Needs media |
| --- | --- | --- |
| x | 280 | no |
| linkedin | 3,000 | no |
| instagram | 2,200 | yes |
| tiktok | 2,200 | yes |
| facebook | 63,206 | no |

Findings, in order: `<platform>.caption` (`pass` or `fail` against the limit), `<platform>.format` (`fail`, instagram
and tiktok only), `<platform>.owner_scope` (always `fail`: ownership and access are never supplied). The limits are
illustrative profile values, not any platform's current rule, and the result says so.

## `x-intelligence` — Signal inbox

Input: `topic` (1–200), `terms` (1–50 non-blank strings, each at most 100, at most 600 in total; duplicates ignoring
case collapse), `items` (1–5,000 objects).

Item: `id` (1–100 characters, unique), `title` (optional, at most 200), `content_text` (optional, at most 20,000),
`url` (optional, `http`/`https`, at most 500; blank means absent). An item needs a `title` or `content_text`; HQ's
form sends title-only rows. Other JSON Feed keys are ignored.

Result: `basis`, `topic`, `terms`, `counts {items, matched, unmatched, evidence}`, `evidence[]`, `evidence_omitted`.
An evidence record is `{item_id, title, text, url?, matched_terms}`; `text` reads
`Matched "oolong" and "steeping" in supplied item fixture-item-1.` (more than three terms: `"a", "b", "c" and 2 more`).
A term matches when it appears as a whole word in the title or in the text. Evidence is ordered by number of
matched terms (most first), then input order, and lists at most 300 records; `counts.matched` is always complete and
`counts.evidence` is the number listed.

## `tiktok-intelligence` — TikTok signals

Input: `niche {name (1–200), terms? (up to 50)}`, `as_of` (date-time), `batches` (1–20).

Batch: `{manifest {batch_id (1–100, unique), observed_at, source? (at most 200)}, records [0–5,000 of {post_id (1–100), views?, likes?, comments?, shares?}]}`.
Metrics are whole numbers 0–1,000,000,000,000 (or `null`). A post appears at most once per batch.

A batch observed after `as_of` is left out as a whole: its batches and records are counted in
`batches_after_as_of` and `records_after_as_of` and used nowhere else. The remaining batches are ordered by
`observed_at` (then `batch_id`) and numbered from 1.

Result: `basis`, `niche`, `niche_terms`, `as_of`, `qualifications[]` (the first reads
`Supplied snapshots only, as of <as_of>. No TikTok access.`), `ranking_metric`, counts as top-level facts
(`batches_supplied`, `batches_used`, `batches_after_as_of`, `records_used`, `records_after_as_of`, `posts_observed`,
`posts_ranked`, `posts_omitted`), `batch_log[]`, `posts[]` and `ranking[]`.

- `posts[]`: `{post_id, observation_count, observations [{batch, <metric>...}], first {batch_id, observed_at, <metric>...}, last {...}, change {<metric>: last - first}, growth_percent, rank}`.
  `change` has a metric only when it was supplied at both ends and the post was seen in at least two batches.
- Growth ranks the change in `ranking_metric`: the first of views, likes, comments, shares that any post has a change
  for. Larger change first, then larger percent, then `post_id`. Posts without that change are listed after the
  ranked ones, by `post_id`, with `rank: null`. `growth_percent` is `null` when the first value is 0.
- `niche.terms` are recorded for context; posts are not filtered or scored by them.
- At most 200 posts are listed (`posts_omitted` counts the rest).

## `seo-studio` — SEO workbench

Input: `config {site (host name such as example.invalid), language (en, en-GB, ...)}`, `packets` (1–200),
`as_of` (`YYYY-MM-DD`).

Packet: `{slug (1–200), title (1–500), sources [up to 50 text values], body? (at most 100,000)}`. Rules, applied
per packet and reported as findings rather than errors:

- slug: lowercase letters, digits and single hyphens, at most 80 characters, unique across packets;
- title: 10–70 characters (illustrative);
- sources: at least 2 different `http`/`https` URLs (up to 3 invalid ones are named by position, then counted);
- body, when supplied: at least 300 words (illustrative), with `word_count` reported.

Result: `ok` (true only when every packet is `ready`), `basis`, `site`, `language`, `as_of`,
`summary {packets, ready, needs_attention, findings}`, `packets[] {slug, title, sources, word_count?, status, findings[]}`
in input order, and `rules[]` describing the checks. `sources` is the count of different valid URLs.

## `search-visibility` — Search visibility

Input: `panel {name, queries (1–200, each at most 300)}`, `entities [0–100 of {name, kind?}]`,
`inventory [0–2,000 of {url, title?}]`, `answers [1–5,000 of {query, engine (at most 60), cited? (up to 50 URLs), text? (at most 20,000)}]`.

Only answers whose `query` is in the panel (ignoring case and spacing) are analyzed; others are counted in
`answers_outside_panel`. At most 30 engines. A URL repeated inside one answer counts once.

Result: `basis`, `panel`, counts (`queries`, `answers`, `answers_in_panel`, `answers_outside_panel`,
`answers_without_text`, counted among the answers in the panel), `engines[] {engine, answers, answers_with_citations}`, `citations[] {url, count, in_inventory, title?}`
(by count, then URL; at most 150), `citations_total`, `citations_unique`, `citations_omitted`,
`coverage {queries_with_inventory_citation, queries, ratio}` (with `queries_covered` and `coverage_ratio` repeated as
plain facts for HQ's one-line summary), `query_coverage[]`, `entity_mentions[] {name, kind, answers_mentioning, queries_mentioning}`
(entity names matched as whole words in answer `text`; answers without text cannot mention anyone),
`inventory_urls`, `inventory_cited`, and `uncited_inventory[]` (at most 100, by URL).

## `reddit-opportunities` — Reddit opportunities

Input: `bundle {corpus (1–200), posts [1–5,000 of {id (unique), title (1–300), body? (at most 20,000), subreddit?, created_at?, score?, comments?}]}`,
`as_of` (date-time) and an optional `profile {name (1–100), terms (1–50)}`. Without a profile, the built-in fictional
`example-tea-shop` profile is used.

Score (0–1) = 0.35 × question form + 0.45 × profile relevance + 0.20 × recency:

- question form: 1.0 when the title has a `?`; 0.6 when it opens with a question word or asks for help or
  recommendations; 0.3 when only the body has a `?`; otherwise 0;
- profile relevance: `min(1, (2 × profile terms in the title + other profile terms in the body) / 4)`;
- recency: `max(0, 1 − age_days / 30)` against `as_of`; 0 when `created_at` is missing or after `as_of`.

Only posts that match at least one profile term are opportunities. `score` and `comments` are echoed as `engagement`
and are not scored.

Result: `basis`, `as_of`, `profile` (`example-tea-shop (illustrative profile; rankings apply to that profile)`, or
`<name> (supplied profile; rankings apply to that profile)`), `profile_terms`, `import {corpus, posts}`,
`opportunities_found`, and `analysis {considered, relevant, not_relevant, weights, opportunities [{id, title, score, reasons, matched_terms, subreddit?, created_at?, age_days?, engagement?}], omitted}`.
`reasons` has one line per component with its contribution. Ordered by score, then `id`; at most 200 listed.

## `creator-relationships` — Creator fit

Input: `batch {account_id (1–100), creators [1–200 of {handle (1–100, unique ignoring case), name?, topics (up to 50), followers?, last_post_at?, audience_location?}]}`,
`niche_topics` (1–50, each at most 80, at most 600 in total), `brand_topics` (optional, same limits), `as_of`.

A niche (or brand) topic matches when a creator topic equals it or contains it as a whole word (`iced tea` matches
`tea`). Status:

| Status | When |
| --- | --- |
| `strong_fit` | matches a niche topic and either a brand topic or at least half of the niche topics, with a last post at most 90 days before `as_of` |
| `possible_fit` | matches a niche topic, but not strongly, or the last post is more than 90 days old |
| `needs_evidence` | no topics supplied, or a niche topic matches but there is no usable `last_post_at` (missing, or after `as_of`) |
| `weak_fit` | topics supplied and none match a niche topic |

Result: `account_id`, `as_of`, `basis`, `policy` (the table above plus the evidence lists), `niche_topics`,
`brand_topics`, `counts` (per status), and `creators[] {handle, name?, status, niche_matches, brand_matches, age_days, missing_evidence, reasons, followers?, audience_location?}`.
`missing_evidence` maps `topics`, `last_post_at`, `followers` or `audience_location` to `not supplied` (or
`dated after as_of` for a `last_post_at` after `as_of`). Creators are sorted strong, possible, needs evidence, weak
(unconfirmed ranks above a known mismatch), then by more niche matches, more brand matches and handle.

## Tests

```sh
cd services/social
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests -p 'test_tools_*.py'
```

`test_tools_contract.py` runs every sample under an audit hook that forbids `open`, `socket.*`, process launch and
`os.exec*`, checks that analyzers import nothing but pure standard-library modules, builds inputs at every bound to
check JSON safety (`allow_nan=False`), size and list caps, and mutates every value of every sample to check that only
`ValueError` ever escapes.
