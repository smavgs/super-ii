#!/usr/bin/env python3
"""Measure the current CAS verification and workspace materialization costs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import statistics
import tempfile
import time
from pathlib import Path

CHUNK_BYTES = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def timed(operation) -> float:
    started = time.perf_counter()
    operation()
    return time.perf_counter() - started


def median_rate(size_bytes: int, samples: list[float]) -> float:
    seconds = statistics.median(samples)
    return size_bytes / seconds if seconds else 0.0


def run(size_mib: int, samples: int) -> dict[str, object]:
    size_bytes = size_mib * CHUNK_BYTES
    deterministic_chunk = hashlib.sha256(b"super-ii-cas-baseline-v1").digest() * 32_768
    with tempfile.TemporaryDirectory(prefix="super-ii-benchmark-") as temp:
        benchmark_root = Path(temp)
        source = benchmark_root / "object.bin"
        with source.open("wb") as handle:
            remaining = size_bytes
            while remaining:
                block = deterministic_chunk[: min(remaining, len(deterministic_chunk))]
                handle.write(block)
                remaining -= len(block)
        expected = sha256_file(source)

        hash_samples = [timed(lambda: sha256_file(source)) for _ in range(samples)]
        verify_link_samples: list[float] = []
        copy_samples: list[float] = []
        for index in range(samples):
            hardlink = benchmark_root / f"hardlink-{index}.bin"

            def verify_and_link(target: Path = hardlink) -> None:
                if sha256_file(source) != expected:
                    raise RuntimeError("fixture integrity changed")
                os.link(source, target, follow_symlinks=False)

            verify_link_samples.append(timed(verify_and_link))
            hardlink.unlink()

            copy = benchmark_root / f"copy-{index}.bin"
            copy_samples.append(
                timed(lambda target=copy: shutil.copyfile(source, target, follow_symlinks=False))
            )
            copy.unlink()

    hash_median = statistics.median(hash_samples)
    verify_link_median = statistics.median(verify_link_samples)
    copy_median = statistics.median(copy_samples)
    return {
        "schema_version": 1,
        "fixture": {"size_bytes": size_bytes, "sha256": expected, "samples": samples},
        "environment": {
            "system": platform.system(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "measurements": {
            "full_sha256": {
                "median_seconds": round(hash_median, 6),
                "bytes_per_second": round(median_rate(size_bytes, hash_samples), 2),
            },
            "verify_then_hardlink": {
                "median_seconds": round(verify_link_median, 6),
                "bytes_per_second": round(median_rate(size_bytes, verify_link_samples), 2),
                "note": (
                    "Current workspace path: full SHA-256 verification followed by a "
                    "same-volume hardlink."
                ),
            },
            "copy_fallback": {
                "median_seconds": round(copy_median, 6),
                "bytes_per_second": round(median_rate(size_bytes, copy_samples), 2),
                "note": (
                    "Copy-only fallback timing; destination re-verification is measured separately."
                ),
            },
        },
        "claim_boundary": (
            "Synthetic local I/O baseline, not a model-loading or inference benchmark."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size-mib", type=int, default=64)
    parser.add_argument("--samples", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.size_mib <= 4096 or not 1 <= args.samples <= 20:
        parser.error("size-mib must be 1..4096 and samples must be 1..20")
    print(json.dumps(run(args.size_mib, args.samples), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
