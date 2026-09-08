from __future__ import annotations

import json
import math
import time
from pathlib import Path

from .contracts import RunRecord


def retrieval_metrics(retrieved: list[str], relevant: set[str]) -> dict[str, float]:
    if not relevant:
        raise ValueError("Retrieval evaluation needs non-empty reference document ids")
    retrieved = list(dict.fromkeys(retrieved))
    hits = [int(item in relevant) for item in retrieved]
    dcg = sum(hit / math.log2(rank + 2) for rank, hit in enumerate(hits))
    ideal = sum(1 / math.log2(rank + 2) for rank in range(min(len(relevant), len(retrieved))))
    return {
        "recall_at_k": len(set(retrieved) & relevant) / len(relevant),
        "precision_at_k": sum(hits) / max(1, len(hits)),
        "mrr": next((1 / (rank + 1) for rank, hit in enumerate(hits) if hit), 0),
        "ndcg_at_k": dcg / ideal if ideal else 0,
    }


def evaluate_rag(
    index,
    cases_file: Path,
    *,
    output_directory: Path = Path("runs"),
    gates: dict[str, float] | None = None,
) -> tuple[dict, Path]:
    import numpy as np

    run = RunRecord(index.recipe, "evaluate", directory=output_directory)
    if cases_file.stat().st_size > 1024**2:
        raise ValueError("Evaluation cases exceed 1 MiB")
    cases = [json.loads(line) for line in cases_file.read_text().splitlines() if line.strip()]
    if not 1 <= len(cases) <= 1000:
        raise ValueError("Supply 1–1,000 evaluation cases")
    metrics, latencies = [], []
    corpus_ids = {c["document_id"] for c in index.chunks}
    for case in cases:
        if (
            set(case) != {"question", "relevant_document_ids"}
            or not isinstance(case["relevant_document_ids"], list)
            or not all(isinstance(v, str) for v in case["relevant_document_ids"])
        ):
            raise ValueError("Each case needs question and relevant_document_ids")
        relevant = set(case["relevant_document_ids"])
        if not relevant <= corpus_ids:
            raise ValueError("Reference ids must exist in this corpus")
        started = time.perf_counter()
        hits = index.search(case["question"])
        latencies.append((time.perf_counter() - started) * 1000)
        metrics.append(retrieval_metrics([h["document_id"] for h in hits], relevant))
    results = {key: sum(row[key] for row in metrics) / len(metrics) for key in metrics[0]}
    results.update(
        {
            "cases": len(cases),
            "top_k_chunks": index.recipe.config["top_k"],
            "retrieval_p95_ms": float(np.percentile(latencies, 95)),
            "concurrency": 1,
            "measurement": "warm index; query embedding + retrieval; excludes generation/load time",
        }
    )
    failed = []
    for metric, threshold in (gates or {}).items():
        if (
            metric not in metrics[0]
            or not isinstance(threshold, (float, int))
            or not 0 <= threshold <= 1
        ):
            raise ValueError("Gates require a supported retrieval metric and threshold in [0,1]")
        if results[metric] < threshold:
            failed.append(metric)
    output = run.finish(
        metrics=results,
        error="Project metric gates failed: " + ", ".join(failed) if failed else None,
    )
    if failed:
        raise ValueError(f"Project metric gates failed; reported evidence: {output}")
    return results, output
