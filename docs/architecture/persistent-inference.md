# Persistent inference contract

Super ii reuses verified local model state without turning inference into an unbounded public compute service.

## Immutable workspace cache

The runtime derives a cache key from the exact revision and sorted manifest SHA-256. On first use it verifies every source object's size and complete digest, materializes safe paths by read-only hardlink or copy, writes a canonical receipt, locks files and directories read-only, and atomically publishes the workspace. Later requests reuse the cache only when the receipt and manifest match; any inconsistency rebuilds or fails closed.

## llama.cpp process lifecycle

- Only a reviewed local `.gguf` file is accepted.
- One `llama-server` process is bound to an ephemeral loopback port.
- The web UI is disabled, offline environment variables are enforced, and continuous batching is enabled.
- Identity includes repository, revision, safe path, and complete model SHA-256.
- A different identity waits for active requests, stops the old process, and starts the exact requested model.
- Health must pass before the process becomes ready.
- Status, cold-start time, request count, last use, idle expiry, endpoint identity, and failures are stored in Postgres.
- Authenticated owners can inspect status or unload an idle model; the default idle window is 15 minutes.

Tokenizer instances use a separate bounded in-process LRU cache. Diffusers remains a one-shot offline path with private, expiring artifacts.

## Capacity and claims

Warm reuse improves repeated-request latency, but actual speed and concurrency depend on the exact model, quantization, context, and operator hardware. vLLM, dedicated GPU pools, autoscaling endpoints, and hosted GPU guarantees remain deferred until capacity is funded and measured. Timing evidence is provenance-bound and labeled `local measurement only`.
