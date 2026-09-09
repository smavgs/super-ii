# Temporary archive dependency patch

The 2026-09-08 update to [GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
includes the installed `adm-zip` 0.6.0. ONNX Runtime Node brings this dependency
through Transformers.js; its installer extracts selected native-library files.

No patched npm release was available on 2026-09-09. The root npm override pins
the exact commit `7d90dea2bfd35bc4761d6c8cf822f26b59aeef77` from
[upstream pull request 575](https://github.com/cthackers/adm-zip/pull/575).
That commit declares version 0.6.1, but it is an **unreleased upstream patch**,
not an official npm release. The npm lock records its archive integrity.

The patch checks existing path components with `lstat` and rejects symlinks.
`tools/check-archive-dependency.mjs` exercises actual file and directory links
outside a temporary extraction root through sync, entry and async extraction.
It checks that the outside file is unchanged and normal extraction still works.
These checks cover pre-existing destination links, not concurrent filesystem
mutation. They run with website validation; npm audit remains unchanged.

Replace this temporary pin with a tested official release when the upstream fix
is published, retaining the extraction regression check.
