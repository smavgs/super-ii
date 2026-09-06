# SDK and automatic publication implementation

Authorized on 2026-09-05 following discussion of `super ii tech .pages`.
Baseline: `3c03dfa5b764c3457448018c7da179ff4e1b6c39`.

The existing join journeys, empty pre-launch catalogue, pricing, and older Drive
and Documents checkouts are preserved. This branch adds capabilities to the
current GitHub version. It does not seed public content.

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

This section is updated as implementation and verification complete. An entry
in the acceptance list above is a requirement, not a claim of completion.

- Dependencies installed in the isolated checkout; baseline npm audit: zero
  vulnerabilities.
- Cloudflare zone: `7af416fae17419da625a210264535500`. Ordinary urllib requests
  received Error 1010 on health and both MCP endpoints. Wrangler OAuth has
  deployment permissions but cannot read or edit zone security rules.

- The approved Cloudflare configuration rule is active: `Super ii machine routes - browser integrity exception v1`, ID `099f15f878fe40aea5807eb4841c5abc`. It turns Browser Integrity Check off only for the canonical host's API, MCP and machine resource paths. Other settings remain unchanged. Ordinary Python urllib requests now return JSON/SSE/text instead of Error 1010. Rollback: disable this named configuration rule in the zone Rules overview.
- Python distribution: `superii-sdk` 0.1.0; import and CLI: `superii`. PyPI rejected the original distribution name; the user approved the alternative. A pending trusted publisher is registered for `smavgs/super-ii`, `publish-sdk.yml`, environment `pypi`. The GitHub environment allows only `main`.
- SDK: 28 tests passed, including authenticated local HTTP serving, a real stdio MCP handshake/call, immutable signature checks, interrupted transfers, cache integrity and explicit remote-provider isolation. Real local llama.cpp inference passed on an existing 55 MB GGUF; the second acquisition transferred zero bytes. See `verification/sdk-local-inference.json`; these are smoke measurements, not model-quality or large-model latency benchmarks.
- Runtime: 78 tests passed. Real Ed25519 and restricted-role PostgreSQL publication integration passed; scanner evidence in that isolated integration test is deliberately a fixture. The complete Rust/Python/container verification script passed.
- Live policy service is running on loopback port 8791 with a dedicated restricted database login and Keychain-held secrets. Its ready check and the main runtime ready check passed; real ClamAV, Gitleaks, storage, transfer service and automatic publication are enabled. The public catalogue remains empty.
- The upgrade is being integrated with upstream `065e194`, preserving the six newer Skills, commerce, homepage and CSP commits. Automatic publication uses migration `0017` to follow upstream agent-commerce migration `0016`. The schema is rerunnable; no publication data is seeded.

## Supported execution and research limits

Acquisition, planning, full-file verification, existing-format selection, local adapters, cache reuse, API/MCP serving and automatic repository publication are implemented. Unknown licenses, absent inspection evidence, custom model Python and unsupported model formats stay blocked with reasons. Rights declarations are recorded evidence, not an automated legal ruling.

The SDK exposes measured first-output timing, RSS sampling and bounded mmap reads of verified safetensors for layer/expert experiments. Generic partial-weight inference, universal instant start, automatic model conversion and a zero-OOM guarantee are not claimed. Remote warm-start sends a prompt only on an explicit application call using a separately supplied provider token. CUDA/ROCm/vLLM execution needs validation on corresponding accelerator hardware.
