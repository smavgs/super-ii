from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from .database import RepositoryDatabase
from .settings import Settings


def benchmark_storage(path: Path, iterations: int = 3) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    if resolved.is_symlink() or not resolved.is_file():
        raise ValueError("benchmark source must be a regular local file")
    if iterations < 1 or iterations > 20:
        raise ValueError("benchmark iterations must be between 1 and 20")
    measurements: list[float] = []
    hashes: list[str] = []
    size_bytes = resolved.stat().st_size
    for _ in range(iterations):
        digest = hashlib.sha256()
        started = time.perf_counter_ns()
        with resolved.open("rb") as source:
            while chunk := source.read(8 * 1024 * 1024):
                digest.update(chunk)
        elapsed = max((time.perf_counter_ns() - started) / 1_000_000_000, 1e-9)
        measurements.append(elapsed)
        hashes.append(digest.hexdigest())
    if len(set(hashes)) != 1:
        raise RuntimeError("benchmark source changed during measurement")
    throughputs = [size_bytes / elapsed for elapsed in measurements]
    return {
        "schema_version": 1,
        "benchmark_id": str(uuid4()),
        "category": "storage",
        "runtime": "superii-python-streaming-sha256",
        "runtime_version": platform.python_version(),
        "model_sha256": None,
        "hardware": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "logical_cpus": os.cpu_count(),
        },
        "parameters": {
            "iterations": iterations,
            "chunk_bytes": 8 * 1024 * 1024,
            "source_size_bytes": size_bytes,
        },
        "metrics": {
            "elapsed_seconds": measurements,
            "bytes_per_second": throughputs,
            "median_bytes_per_second": statistics.median(throughputs),
        },
        "provenance": {
            "source_sha256": hashes[0],
            "clock": "time.perf_counter_ns",
            "network_used": False,
            "generated_by": "superii-benchmark/0.1.0",
        },
        "claim_scope": "local measurement only",
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a provenance-bound Super ii benchmark")
    parser.add_argument("file", type=Path)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--record", action="store_true", help="record into configured Postgres")
    arguments = parser.parse_args()
    result = benchmark_storage(arguments.file, arguments.iterations)
    if arguments.record:
        RepositoryDatabase(Settings()).record_benchmark(result)
        result["recorded"] = True
    else:
        result["recorded"] = False
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
