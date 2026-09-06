# SDK and automatic publication implementation

Authorized on 2026-09-05 following discussion of `super ii tech .pages`.
Baseline: `3c03dfa5b764c3457448018c7da179ff4e1b6c39`.

The existing join journeys, empty pre-launch catalogue, pricing, and older Drive
and Documents checkouts are preserved. The implementation was merged in
[PR #1](https://github.com/smavgs/super-ii/pull/1) at `b99a307` and integrated
with the newer member profiles and Builders directory through `6df2076`.
No public content was seeded.

## Acceptance criteria

- Ordinary HTTP clients can use health, discovery, downloads, API and MCP.
  Browser challenges must not replace authentication or rate limits.
- A typed Python package provides inspect, hardware, plan, pull, verify, load,
  asynchronous acquisition, and local serving. Immutable manifest and file
  hashes are checked. Repository Python is never imported automatically.
- Hardware planning happens before download/load. Supported installed runtimes
  receive local verified files and explicit context/memory limits. Unknown or
  oversized configurations fail with actionable alternatives.
- Transfers resume, use parallel verified ranges, deduplicate by content, and
  support an explicitly configured authenticated peer cache. Credentials and
  private repository access remain scoped to the canonical origin.
- Authorized submission runs deterministic checks and an independent policy
  service. Passing releases publish automatically; failures remain blocked with
  reasons. No human publication queue or agent-authored approval exists.
- Publication records bind the exact manifest, license/provenance declarations,
  scanner evidence and policy version to a cryptographic signature. Old review
  history is preserved as historical evidence.
- Research for partial weights, mmap, layer/MoE loading and optional remote
  warm-start is separately measurable. No zero-OOM or instant-inference claim
  may be promoted without measurements for the relevant model and hardware.

## Verification and deployment record

Verified on 2026-09-06. The evidence below distinguishes live service checks,
isolated integration tests, and local inference measurements.

- **Public Python release:** [superii-sdk 0.1.0](https://pypi.org/project/superii-sdk/0.1.0/)
  was published from `b99a307` by the successful
  [GitHub release workflow](https://github.com/smavgs/super-ii/actions/runs/34007539909).
  Trusted Publishing is scoped to `smavgs/super-ii`, `publish-sdk.yml`, and
  environment `pypi`; that environment allows only `main`. Install with
  `python -m pip install superii-sdk` on Python 3.11 or newer. The import and CLI
  remain `superii`. A fresh isolated installation from public PyPI imported
  version 0.1.0, ran `superii hardware`, and completed real llama.cpp inference.
  [Release evidence](verification/sdk-pypi-release.json) records both distribution
  hashes and the published wheel's empty-cache and warm-cache measurements.
- **Machine access:** the approved Cloudflare rule
  `Super ii machine routes - browser integrity exception v1`
  (`099f15f878fe40aea5807eb4841c5abc`) is active for `superii.site` and
  `www.superii.site`. It disables Browser Integrity Check on API, MCP, A2A and
  machine-readable resource routes. The [scope and rollback procedure](operations/MACHINE-ACCESS.md)
  record the deployed expression. [All 28 ordinary urllib requests passed](verification/machine-access.json),
  including public A2A execution, MCP discovery, the SDK manifest schema and
  active publication keys. A protected Work receipt read was correctly denied
  without a token. Authentication, rate limits, WAF and DDoS protections remain
  active. The [live signed Skill](verification/signed-skill-live.json) passed
  Ed25519 verification and all four exact file hashes against the pinned key.
- **SDK verification:** 28 tests passed, including authenticated local HTTP
  serving, a real stdio MCP handshake/call, immutable signature checks,
  interrupted transfers, cache integrity and explicit remote-provider isolation.
  [Local llama.cpp inference](verification/sdk-local-inference.json) and the
  public PyPI wheel both used an existing 55 MB GGUF; their second acquisitions
  transferred zero bytes. These are smoke measurements, not model-quality or
  large-model latency benchmarks. The OS file cache was not cleared.
- **Automatic publication:** 78 runtime tests passed. Real Ed25519 and
  restricted-role PostgreSQL integration passed; scanner evidence in that
  isolated integration test is deliberately a fixture. The live policy service
  runs on loopback port 8791 with a dedicated restricted database login and
  Keychain-held secrets. [Production readiness](verification/runtime-publication-ready.json)
  confirms the database, storage, transfer service, real ClamAV and Gitleaks,
  publication policy, and matching active public key. The public catalogue is
  empty; the first real creator release remains pending.
- **Combined source and database:** the implementation
  [passed full CI](https://github.com/smavgs/super-ii/actions/runs/34007248531),
  including SDK/runtime tests, Rust checks, container builds and website checks.
  The final source preserves upstream Skills, commerce, homepage, CSP, richer
  member profiles (`452b06e`) and Builders discovery (`6df2076`). Local Astro
  checking reports 271 files with zero errors, warnings or hints; the build
  scans 353 release files and passes CSP checks. All 18 database migrations
  apply twice and their transactional suites pass. Migration `0017` adds
  automatic publication; `0018` adds member profiles. Production has 89 tables
  and one view, with no public repository seed rows.

## Supported execution and research limits

Acquisition, planning, full-file verification, existing-format selection, local adapters, cache reuse, API/MCP serving and automatic repository publication are implemented. Unknown licenses, absent inspection evidence, custom model Python and unsupported model formats stay blocked with reasons. Rights declarations are recorded evidence, not an automated legal ruling.

The SDK exposes measured first-output timing, RSS sampling and bounded mmap reads of verified safetensors for layer/expert experiments. Generic partial-weight inference, universal instant start, automatic model conversion and a zero-OOM guarantee are not claimed. Remote warm-start sends a prompt only on an explicit application call using a separately supplied provider token. CUDA/ROCm/vLLM execution needs validation on corresponding accelerator hardware.

Native adapter verification also passed for Transformers on CPU and MLX on Apple Metal using a tiny randomly initialized local fixture. This caught and fixed an unsupported MLX loader argument. No provider weights were downloaded or published. See `verification/sdk-native-adapters.json`.
