# Use Model contract

Super ii's **Use Model** surface turns one reviewed immutable model revision into deterministic, machine-readable execution guidance. It does not execute publisher instructions and it does not imply that a third-party runtime has been tested against every model.

## Public resources

Every reviewed model repository exposes these revision-derived resources beneath its canonical URL:

- `use.json` — Use Manifest v1, integrations, checksum-bound assets, agents, notebooks, lineage, and hosted-capacity truth.
- `use.md` — readable commands and safety boundaries from the same manifest.
- `use.ipynb` — a generated Jupyter notebook that downloads exact HTTPS assets and verifies SHA-256 without installing or running a model.
- `use.sh` — a fail-closed POSIX download script that follows HTTPS redirects only, verifies every file, and refuses to overwrite different bytes.

The global `/runtime-registry.json` registry is versioned by `/schemas/runtime-registry-v1.json`. Per-model output is described by `/schemas/use-manifest-v1.json`.

## Trust boundary

Publisher filenames, cards, code, discussions, and declared metadata remain untrusted data. Templates come only from the checked-in Super ii registry. Executables and template tokens are allowlisted; command arguments are rendered separately for POSIX shells and PowerShell and include their own SHA-256 digests. The registry forbids command composition and never emits `curl | sh`.

The hardware profile is optional, coarse, and local to the browser. It contains operating system, architecture, accelerator, RAM, VRAM, and WebGPU availability. It is not transmitted to Super ii. Recommendations are deterministic compatibility guidance, not benchmarks or performance guarantees.

## Verification levels

- `verified` means the Super ii release path has direct checked evidence for the stated integration surface.
- `registry-supported` means the official upstream command or configuration contract was reviewed, but the combination has not been claimed as an end-to-end model run.
- Review dates expire on the registry cadence and must be refreshed deliberately.

Installed-version probes are read-only and do not upgrade, install, download, or start services. Missing software remains a skipped probe and never becomes a verified claim.

## Local, agent, and cloud boundaries

Generated local API servers bind to `127.0.0.1`. Codex receives the read-only Super ii MCP for repository discovery; Pi, Hermes, and OpenClaw receive placeholder-only configuration for a compatible local OpenAI-style endpoint. The two paths are explicitly separate.

Derived recommendations use only reviewed typed lineage: fine-tuned, quantized, converted, adapter, merged, and distilled relations. External hosted providers, regions, and prices remain empty until real funded capacity is measured and published. vLLM and SGLang are therefore user-provisioned API guidance, not a claim of free Super ii GPU hosting.
