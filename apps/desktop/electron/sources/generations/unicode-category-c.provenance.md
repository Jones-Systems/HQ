# Unicode category-C range provenance

`unicode-category-c.ts` derives only from public official Unicode 15.1.0 data
(© 2023 Unicode®, Inc.). Its independently authored offline generator selects the
explicit Cc, Cf, Cs, Co and Cn records in DerivedGeneralCategory.txt. It validates
all records, checks that they partition U+0000 through U+10FFFF without gaps or
overlap, then emits sorted inclusive ranges merged across adjacent selected records.
No UnicodeData First/Last expansion or inferred unassigned complement is used.
The runtime scans input code points and uses binary search over the pinned ranges;
category-C admission does not consult Node/ICU Unicode properties.

- Unicode version: **15.1.0**.
- Official repository revision: `578f6c0516f5f268292ebda50b51848407a06478`.
- [Immutable input](https://raw.githubusercontent.com/unicode-org/unicodetools/578f6c0516f5f268292ebda50b51848407a06478/unicodetools/data/ucd/15.1.0/extracted/DerivedGeneralCategory.txt).
- Input SHA256: `760720ac034f96b630a3055879a744e0907184e8aa811e89ba34583a7a487e85`.
- Generated output: **712 merged ranges**, covering **964,469 code points**:
  Cc 65, Cf 170, Cs 2,048, Co 137,468, Cn 824,718. The total includes surrogate
  code points; existing well-formed validation rejects lone surrogates first.
- License: Unicode-3.0; the complete copyright and permission notice remains in
  `unicode-LICENSE.txt`, from the [same revision's LICENSE](https://raw.githubusercontent.com/unicode-org/unicodetools/578f6c0516f5f268292ebda50b51848407a06478/LICENSE).

Regenerate from the repository root using a separately acquired copy of that exact
input. The generator verifies the pinned SHA256 before parsing or writing:

```text
node apps/desktop/electron/sources/generations/generate-unicode-category-c.mjs /path/to/DerivedGeneralCategory.txt
```

The generator has no network or package dependencies and is not invoked by
application or test execution. The upstream input is not vendored. Path tests use
independently authored regressions: U+088F and U+1C89 are explicitly Cn in the
15.1.0 input, alongside controls, formats, private-use and noncharacter examples.
Nearby assigned characters and ordinary paths remain admitted.

The compatibility target is the Python 3.13.5 / UCD 15.1.0 producer. This is an
implementation-only repair pending finite all-scalar category comparison,
fold/generator verification and affected checks by the parent. It does not qualify
the actual Electron runtime or all Python >=3.13 versions. Well-formed handling,
path limits, routes, full folding and NFC input validation are unchanged; folded
output is not normalized. NFC still uses the runtime's `String.normalize('NFC')`.
The full-fold provenance links this category-C pin separately from the remaining
runtime NFC qualification. No wire or schema field is added.
