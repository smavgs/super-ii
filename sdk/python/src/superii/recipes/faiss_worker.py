"""Isolated FAISS worker: macOS torch and FAISS wheels bundle different OpenMP copies."""

from __future__ import annotations

import json
import sys


def main():
    import faiss
    import numpy as np

    faiss.omp_set_num_threads(2)
    vectors = np.load(sys.argv[1], allow_pickle=False, mmap_mode="r")
    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)
    print('{"ready":true}', flush=True)
    while line := sys.stdin.buffer.readline(1024 * 1024):
        try:
            request = json.loads(line)
            vector = np.asarray(request["vector"], dtype="float32")
            count = int(request["k"])
            if vector.shape != (1, vectors.shape[1]) or not 1 <= count <= 50:
                raise ValueError("Invalid retrieval request")
            scores, indices = index.search(vector, count)
            print(
                json.dumps(
                    {"scores": scores.tolist(), "indices": indices.tolist()}, allow_nan=False
                ),
                flush=True,
            )
        except Exception:
            print('{"error":"Retrieval worker failed"}', flush=True)


if __name__ == "__main__":
    main()
