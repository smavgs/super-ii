# Performance baseline and claim boundary

Super ii records measurements with enough provenance to reproduce their scope. A local result is never promoted into a general performance promise.

## Foundation baseline

The existing deterministic benchmark measures:

- full SHA-256 reads of a local object;
- first materialization into a read-only workspace;
- same-volume hardlink reuse and copy fallback;
- the checked-in 25 MiB per-file browser WASM ceiling.

Run:

```sh
uv run --directory runtime python scripts/benchmark-foundation.py --size-mib 64 --samples 3
```

## Canonical runtime records

`superii-benchmark` records local storage or transfer measurements with runtime version, hardware description, parameters, metrics, source SHA-256 provenance, measured time, and the fixed claim scope `local measurement only`. Repository/model identifiers are optional and must identify the exact immutable revision when used.

Persistent llama.cpp responses may include upstream timing data, while the lifecycle table records cold start and request count for the exact revision, path, and model SHA-256. A publishable comparison must additionally name prompt, parameters, context, warm/cold state, sample count, concurrency, hardware, and runtime version.

Machine, filesystem, cache warmth, storage pressure, model format, quantization, and concurrent work affect every result. A successful smoke run proves the request path, not model quality or fleet capacity.

## Claim boundary

The public catalog intentionally has no seeded artifacts. Until a reviewed model exists, Super ii does not publish general claims for cold model load, warm reuse, time-to-first-token, tokens per second, Diffusers generation, accelerator utilization, concurrent inference, or notebook completion time. Measurements remain local evidence and never establish a hosted GPU service, benchmark leadership, or guaranteed user performance.
