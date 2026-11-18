# Unicode full-fold table provenance

The generated `unicode-full-fold.ts` is derived only from public official Unicode
15.1.0 data (© 2023 Unicode®, Inc.). The independently authored generator selects
CaseFolding.txt statuses **C and F**, excludes S and T, and sorts by scalar value.
The consumer substitutes each input scalar once, leaves unlisted scalars unchanged,
and concatenates without normalizing the folded output.

- Official repository revision: `578f6c0516f5f268292ebda50b51848407a06478`.
- Revision resolved through the [GitHub primary API](https://api.github.com/repos/unicode-org/unicodetools/commits/578f6c0516f5f268292ebda50b51848407a06478).
- [Immutable input](https://raw.githubusercontent.com/unicode-org/unicodetools/578f6c0516f5f268292ebda50b51848407a06478/unicodetools/data/ucd/15.1.0/CaseFolding.txt).
- Input SHA256: `4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf`.
- Generated mapping count: 1,530.
- License: Unicode-3.0; complete notice preserved in `unicode-LICENSE.txt` from the
  [same revision's LICENSE](https://raw.githubusercontent.com/unicode-org/unicodetools/578f6c0516f5f268292ebda50b51848407a06478/LICENSE).

Regenerate from the repository root with a separately obtained copy of that exact
input (the generator verifies its SHA256 before writing):

```text
node apps/desktop/electron/sources/generations/generate-unicode-full-fold.mjs /path/to/CaseFolding.txt
```

The generator also accepts `-` for stdin. It has no network or package dependencies,
and is not invoked by application or test execution. The upstream data file is not
vendored. `paths.test.ts` contains independently authored behavior vectors.

The compatibility target is the Python 3.13.5 / UCD 15.1.0 producer. This source
change alone does not qualify parity with that producer, Node 24.19.0, or the actual
Electron runtime, and makes no compatibility claim for all Python >=3.13 versions.
Existing well-formed-string and path-limit handling, NFC **input** validation,
and route encoding are retained. Category-C rejection now uses the independently
pinned Unicode 15.1.0 ranges documented in `unicode-category-c.provenance.md`.
`String.normalize('NFC')` still uses runtime Unicode data and requires separate
qualification; no pinned normalization table is introduced.
There is no new v1 wire field.
