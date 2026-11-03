# Planner wire contract copies

These are byte-identical copies of the public, synthetic Planner wire contract. Work's live-adapter tests use them; nothing in production imports them.

- **Source:** `services/planner/contract/` in Jones-Systems/HQ.
- **Copied from:** commit `b3597e9` (the HQR-A4 captures branch, PR #85 head), through its foundation merge `ad5f695`. This re-pin replaces the earlier copy from `523104b`.
- **Identity check:** every file below has the same Git blob at `b3597e9` and in `services/planner/contract/` of this checkout. This was checked with `git rev-parse b3597e9:services/planner/contract/<file>` and `git hash-object` on each copy, and the copy was made with `cp`.
- **Changes from the earlier copy:** `SHA256SUMS` and `exchanges/15-batch-dry-run.json` changed, and `exchanges/28`-`42` were added. Every other file's Git blob and size equal the earlier pin (`523104b`, identical blobs at `67594ade`).
- **Not copied:** the generator, the vector builder, the README and any service code. There is no backend merge.
- **`SHA256SUMS`:** the upstream file, unchanged. It covers every other file here. Its own SHA-256 is `d755b558250b2255e836fbd6a9fff4b1f60db4e5da3e9ce80ee86795afe42fd8`.

`contract.test.ts` recomputes each file's SHA-256 and Git blob, and checks both against this table and `SHA256SUMS`. If `services/planner/contract/` is present in the checkout, the test also fails on any byte drift from it. When that directory is absent, the comparison is reported as `unavailable`, never as passed.

| File | Git blob | Bytes |
| --- | --- | --- |
| `SHA256SUMS` | `6a9218aa7bd40c2c249ee5eaefc30f2a1934795d` | 4211 |
| `reference-vectors.json` | `73d4da4b924c79f6b493b2af4ff2d54ca3691f23` | 55165 |
| `exchanges/01-version.json` | `cc1c659cba20735dfe6c533972e439446b1ab310` | 1216 |
| `exchanges/02-state-empty.json` | `b31a4782b1cc7a25bde24c1b27315d87ff2a79e0` | 1403 |
| `exchanges/03-create.json` | `0132bceee68ddccaf94f96a02d5a8f64772961e7` | 3295 |
| `exchanges/04-create-repeated.json` | `35b20d8dd52c9c24ed2bd806207c03c1bf2cca2b` | 3320 |
| `exchanges/05-id-reuse.json` | `be476c02306af344cde5c66ccce85da5d2cef738` | 1231 |
| `exchanges/06-get.json` | `3dc0e6fc359767326cd2861106bb3c13fd76b220` | 2600 |
| `exchanges/07-patch.json` | `f02d04961069e3840ab720723b73d7ff49641ea5` | 2859 |
| `exchanges/08-revision-conflict.json` | `9043b782c35bdc60f9c77faac6a17b51223ce1a9` | 2878 |
| `exchanges/09-order-conflict.json` | `aab7b1699194bc1f9fac8e3521b9c6e45ff42666` | 1280 |
| `exchanges/10-move.json` | `649fac11bfe0a42665c7d63523d1d7b75231ac63` | 2879 |
| `exchanges/11-archive.json` | `eccfdd742dfc04c81e38e0d447a43d30a5a321df` | 2847 |
| `exchanges/12-restore.json` | `78247961cd7667be62af1e4f5c168f4518b4a90b` | 2829 |
| `exchanges/13-reviewed.json` | `ee7f0b4b84e0be3aaa8a25eaf6d91e81961ff8ec` | 2852 |
| `exchanges/14-settings.json` | `f6505c9860142cc7344de297e549d4d03d4a3920` | 1274 |
| `exchanges/15-batch-dry-run.json` | `b8d734389dc64d99f047e79392b01793163058c9` | 1603 |
| `exchanges/16-batch.json` | `70899cb6f4d32568f76fa8885525a3df82ec2836` | 3303 |
| `exchanges/17-field-validation.json` | `e0d17d539b82f07fc66babe195216a2ae97b3b40` | 1663 |
| `exchanges/18-import-validation.json` | `a53e9a0f5213fc9f6d65fbfc82bc8bcd85a5308f` | 1237 |
| `exchanges/19-replay-retained.json` | `0f9aef3a7d92e93042c3450dff99026d0611278c` | 3708 |
| `exchanges/20-replay-not-applied.json` | `dfde420eff103425b894ff356c6c3b52e4b6ef4d` | 1867 |
| `exchanges/21-replay-apply.json` | `9684f88a41c1a29637158d3c5e1292108d359fb2` | 3683 |
| `exchanges/22-replay-apply-repeated.json` | `e8256b3a901655ade2307e0fa809857b5b4c33ee` | 3705 |
| `exchanges/23-replay-indeterminate.json` | `0ecacbb9982e9b59a4e2cfc66b220ea84e804147` | 1985 |
| `exchanges/24-history.json` | `b83c2817ce17858d75ff0086df3a5b69631ac545` | 2435 |
| `exchanges/25-state.json` | `692932876204457d4aae0898af6a432c1cd98c19` | 6654 |
| `exchanges/26-version.json` | `e6e0ae10bf8c0e3a62439af94afeb7de25e9ee39` | 1216 |
| `exchanges/27-export.json` | `f6dbcba516eebb0528a06e9d154e851c29d6cc9b` | 9221 |
| `exchanges/28-item-not-found.json` | `a8f4eb269bfe40d9fd8ed4002df0ba5298764294` | 1047 |
| `exchanges/29-mutation-not-found.json` | `2887f21ef0ce93eb584c5885abe9aa2168a192a6` | 1189 |
| `exchanges/30-reference-target-validation.json` | `8a2df2c67299bf48009e2bcab0655a0adb4432f9` | 1661 |
| `exchanges/31-settings-validation.json` | `d1bad6d6305aaf447b062cab7c3cdb8b924d84c7` | 1337 |
| `exchanges/32-missing-planning-header.json` | `5c52f98e17cb6d40506919af3e2058792e93493f` | 1198 |
| `exchanges/33-unsupported-media-type.json` | `2eb36ef1e34bd9fa6c2392627ab47204da9d0f53` | 1226 |
| `exchanges/34-bad-host.json` | `c664c68d75c20bbb1d48ee3da7e869248dabb213` | 1043 |
| `exchanges/35-body-too-large.json` | `aaa892defb1601cf5b49f7aa32924be3238640b1` | 1216 |
| `exchanges/36-replay-not-replayable.json` | `f775ce0fd27e90ca8f9f2039a431224af80a59a2` | 1914 |
| `exchanges/37-replay-unobserved-version.json` | `b48f63b9281c5630db77464c70769380925bbda2` | 1943 |
| `exchanges/38-replay-id-reuse.json` | `74446297d5bb2bc8d4865f2e5a3eec950c2da189` | 1349 |
| `exchanges/39-import-confirmation-required.json` | `d6a9b453c5622551dd5a33c14ed318442f17fe00` | 6004 |
| `exchanges/40-import-merge.json` | `3a12075a24e67621390a35eb2ce59926a0f99a91` | 6000 |
| `exchanges/41-examples.json` | `aad234ceb9a047fd7ecc9eba06ef1b90cfcf5503` | 1133 |
| `exchanges/42-examples-present.json` | `bde4d1b2dfdec1b92caacb6f6c1bfc6cc84ba6c1` | 1181 |
