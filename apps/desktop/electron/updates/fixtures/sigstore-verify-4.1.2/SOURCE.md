# Offline Sigstore cryptographic fixture

Copyright 2023 The Sigstore Authors. Licensed under Apache-2.0; the complete license is in `LICENSE`.

Source repository: https://github.com/sigstore/sigstore-js
Release: `@sigstore/verify@4.1.2`
Exact source commit: `769a53d8713248a8bf49edfc2a5d1955b0dcc24d`

`bundle.json` is the literal `V3.DSSE.WITH_SIGNING_CERT.TLOG_DSSEV002` from upstream `bundles.ts`. `trusted-root.json` is the literal `trustedRootJSON` from upstream `trust.ts`. Only representation changed: TypeScript object literals were serialized as JSON, and JavaScript `undefined` became JSON `null`. Certificate, signature, payload, log, timestamp and trust bytes are unchanged.

This fixture authenticates upstream's public `text/plain` payload under its own signing identity. It exercises the real verifier with the default certificate-transparency, transparency-log and timestamp requirements. It does not establish HQ repository/workflow identity, SLSA subjects, current production TUF freshness or a successful HQ release. HQ-specific mismatch tests and the real-release acceptance gate remain.

Source files and SHA-256:

- `46730a904b1c12fb8397d37d125b9da353f4edb1dc29f0411b43603311a2d7e7` [packages/verify/src/__tests__/__fixtures__/bundles.ts](https://raw.githubusercontent.com/sigstore/sigstore-js/769a53d8713248a8bf49edfc2a5d1955b0dcc24d/packages/verify/src/__tests__/__fixtures__/bundles.ts)
- `2d998343a2edb221b3f52b8239772aa25f85197a7e2d41105f92a5e657b1906d` [packages/verify/src/__tests__/__fixtures__/trust.ts](https://raw.githubusercontent.com/sigstore/sigstore-js/769a53d8713248a8bf49edfc2a5d1955b0dcc24d/packages/verify/src/__tests__/__fixtures__/trust.ts)
- `364a130d2ca340bd56eb1e6d045fc6929bb0f9d0aa018f2c1949b29517e1cdd0` [LICENSE](https://raw.githubusercontent.com/sigstore/sigstore-js/769a53d8713248a8bf49edfc2a5d1955b0dcc24d/LICENSE)

Serialized fixture SHA-256:

- `ba2a4182345c5e7c4e660e084db9e460f13392693e168c43992d4b4c8db8f4a0` `bundle.json`
- `8c00097fd6f6ad8ce610ecb497f293997964c4f4ed7a8f3c97c9f626a9e74f4d` `trusted-root.json`
- `364a130d2ca340bd56eb1e6d045fc6929bb0f9d0aa018f2c1949b29517e1cdd0` `LICENSE`
