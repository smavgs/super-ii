from __future__ import annotations

import json
import os
import selectors
import subprocess
import sys
import tempfile
import threading
import weakref
from pathlib import Path


def _cleanup(process, temporary):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    temporary.cleanup()


class VectorIndex:
    def __init__(self, vectors):
        import numpy as np

        self.local = None
        self.lock = threading.Lock()
        self.cleanup = None
        if sys.platform != "darwin":
            import faiss

            faiss.omp_set_num_threads(2)
            self.local = faiss.IndexFlatIP(vectors.shape[1])
            self.local.add(np.ascontiguousarray(vectors, dtype="float32"))
            return
        temporary = tempfile.TemporaryDirectory(prefix="superii-faiss-")
        filename = Path(temporary.name) / "vectors.npy"
        np.save(filename, vectors, allow_pickle=False)
        filename.chmod(0o600)
        self.process = subprocess.Popen(
            [sys.executable, "-m", "superii.recipes.faiss_worker", str(filename)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={
                k: v
                for k, v in os.environ.items()
                if k in {"PATH", "HOME", "TMPDIR", "LANG", "SYSTEMROOT"}
            },
        )
        self.cleanup = weakref.finalize(self, _cleanup, self.process, temporary)
        try:
            if self._read() != {"ready": True}:
                raise RuntimeError("FAISS worker could not start")
        except Exception:
            self.close()
            raise

    def _read(self):
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=60):
                raise RuntimeError("FAISS worker timed out")
        line = self.process.stdout.readline(1024 * 1024)
        if not line or len(line) >= 1024 * 1024:
            raise RuntimeError("FAISS worker returned an invalid response")
        return json.loads(line)

    def search(self, vector, count):
        import numpy as np

        if self.local is not None:
            return self.local.search(vector, count)
        with self.lock:
            self.process.stdin.write(
                json.dumps({"vector": vector.tolist(), "k": count}, allow_nan=False).encode()
                + b"\n"
            )
            self.process.stdin.flush()
            result = self._read()
        if "error" in result:
            raise RuntimeError(result["error"])
        return np.asarray(result["scores"]), np.asarray(result["indices"])

    def close(self):
        if self.cleanup:
            self.cleanup()
        self.local = None
