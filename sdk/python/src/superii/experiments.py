"""Measurable local weight-access experiments; no partial unverified execution."""

from __future__ import annotations

import json
import mmap
import struct
import time
from collections.abc import Iterator
from dataclasses import asdict, dataclass

import psutil

from .client import Snapshot
from .errors import IntegrityError
from .model import Model


@dataclass(frozen=True)
class TensorRange:
    name: str
    file: str
    dtype: str
    shape: tuple[int, ...]
    start: int
    end: int


def tensor_ranges(snapshot: Snapshot) -> tuple[TensorRange, ...]:
    """Index bounded safetensors headers after full snapshot verification."""
    snapshot.verify()
    result = []
    for name in snapshot.files:
        if not name.endswith(".safetensors"):
            continue
        file = snapshot.path / name
        with file.open("rb") as stream:
            prefix = stream.read(8)
            if len(prefix) != 8:
                raise IntegrityError("Truncated safetensors header")
            size = struct.unpack("<Q", prefix)[0]
            if size > 16 * 1024**2 or size + 8 > file.stat().st_size:
                raise IntegrityError("Invalid safetensors header length")
            header = json.loads(stream.read(size))
        ranges = []
        for tensor, metadata in header.items():
            if tensor == "__metadata__":
                continue
            start, end = metadata["data_offsets"]
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or not 0 <= start <= end
                or end + size + 8 > file.stat().st_size
            ):
                raise IntegrityError("Tensor range escapes its verified object")
            ranges.append((start, end))
            result.append(
                TensorRange(
                    tensor,
                    name,
                    metadata["dtype"],
                    tuple(metadata["shape"]),
                    start + size + 8,
                    end + size + 8,
                )
            )
        ordered = sorted(ranges)
        if any(left[1] > right[0] for left, right in zip(ordered, ordered[1:], strict=False)):
            raise IntegrityError("Overlapping tensor ranges")
    return tuple(result)


def iter_tensor_bytes(
    snapshot: Snapshot, *, prefix: str = "", chunk_bytes: int = 1024**2
) -> Iterator[tuple[str, bytes]]:
    """Explore layer/expert-prefixed mmap reads with bounded copied chunks.

    This is an acquisition research primitive, not a generic lazy-inference engine.
    """
    if not 1 <= chunk_bytes <= 16 * 1024**2:
        raise ValueError("chunk_bytes must be 1–16 MiB")
    for tensor in tensor_ranges(snapshot):
        if not tensor.name.startswith(prefix):
            continue
        with (snapshot.path / tensor.file).open("rb") as source:
            with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as mapping:
                for start in range(tensor.start, tensor.end, chunk_bytes):
                    yield tensor.name, mapping[start : min(start + chunk_bytes, tensor.end)]


def benchmark(model: Model, prompt: str, *, max_tokens: int = 128) -> dict:
    """Measure an already-loaded model; label batch adapters separately from TTFT."""
    import threading

    process = psutil.Process()
    peak = 0
    stop = threading.Event()

    def sample() -> None:
        nonlocal peak
        while not stop.is_set():
            total = 0
            for child in [process, *process.children(recursive=True)]:
                try:
                    total += child.memory_info().rss
                except psutil.Error:
                    pass
            peak = max(peak, total)
            stop.wait(0.02)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    started, first, output = time.perf_counter(), None, ""
    try:
        for chunk in model.stream(prompt, max_tokens=max_tokens):
            first = first or time.perf_counter()
            output += chunk
    finally:
        elapsed = time.perf_counter() - started
        stop.set()
        sampler.join()
    streaming = model.plan.runtime in {"llama.cpp", "mlx"}
    tokens = model.count_tokens(output)
    return {
        "runtime": model.plan.runtime,
        "plan": asdict(model.plan),
        "first_output_seconds": first - started if first else None,
        "ttft_seconds": first - started if first and streaming else None,
        "generation_seconds": elapsed,
        "retokenized_output_tokens": tokens,
        "approximate_tokens_per_second": tokens / elapsed if elapsed else None,
        "sampled_peak_process_tree_rss_bytes": peak,
        "bytes_acquired_before_inference": model.snapshot.transferred_bytes,
        "full_weights_verified_before_inference": True,
        "scope": "one local run; RSS sampling and retokenized token count are estimates",
    }
