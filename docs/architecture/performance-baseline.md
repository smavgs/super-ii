# Performance baseline and claim boundary

The first performance baseline records the repository paths that already exist before larger storage, upload, notebook, or inference work is optimized.

## Baseline scope

- Full SHA-256 read of a deterministic local object.
- Current workspace materialization: verify the complete source, then create a read-only same-volume hardlink.
- Copy fallback cost when a hardlink is unavailable.
- Browser WASM release-asset ceiling: every individual checked-in `.wasm` file must stay at or below 25 MiB.

The reproducible command is:

```sh
uv run --directory runtime python scripts/benchmark-foundation.py --size-mib 64 --samples 3
```

Machine, filesystem, cache warmth, storage pressure, and concurrent work affect the result. The checked-in JSON therefore records the environment and synthetic fixture and makes no cross-machine promise.

## Not yet benchmarked

The public catalog intentionally has no seeded artifacts. Until a reviewed model exists, Super ii does not publish claims for cold model load, warm reuse, time-to-first-token, tokens per second, Diffusers generation, accelerator utilization, or concurrent inference. Those benchmarks must name the exact revision, hardware, runtime versions, parameters, prompt or seed, sample count, and warm/cold state.
