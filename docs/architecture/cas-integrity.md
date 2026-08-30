# Content-addressed storage integrity and performance

Super ii currently favors simple, fail-closed integrity over optimistic caching.

## Current contract

1. Quarantined bytes pass the required scanners and format policy.
2. The runtime computes SHA-256 and promotes clean bytes into a content-addressed object path.
3. Database rows bind each immutable revision file to its expected size, MIME type, SHA-256 digest, and object key.
4. Workspace materialization verifies the complete stored object before creating a read-only hardlink; it falls back to a copy only when linking is unavailable.
5. Public downloads verify the complete object again before serving it and record the transfer.

This catches tampering and storage drift, but verification cost is linear in object size on both checkout and download. Deduplication prevents duplicate storage; it does not make repeated verification free.

## Measured baseline

Run `uv run --directory runtime python scripts/benchmark-foundation.py --size-mib 64 --samples 3` and retain the JSON evidence under `qa/benchmarks/`. The fixture is synthetic and measures local hashing/materialization paths only. It is not evidence for model load time, time-to-first-token, token throughput, GPU utilization, or concurrent inference.

## Optimization gate

A future integrity index may cache a verified digest only when it is bound to immutable object identity and invalidated on any size, timestamp, inode, filesystem, or storage-generation change. Download and checkout behavior must continue to fail closed when the cache is absent or inconsistent. No optimization may turn a missing check into a successful read.
