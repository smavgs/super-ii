"""Exercise the SDK against an existing local GGUF; never seeds a public repository."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import superii


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.model_file.resolve(strict=True)
    with source.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    size = source.stat().st_size
    manifest_hash = hashlib.sha256(
        f"model.gguf\0{checksum}\0{size}\n".encode()
    ).hexdigest()
    key = Ed25519PrivateKey.generate()
    payload = json.dumps(
        {
            "repository_id": "local-fixture",
            "revision_id": "local-fixture",
            "commit_sha": "c" * 64,
            "manifest_sha256": manifest_hash,
            "outcome": "passed",
            "policy_version": "superii-auto-publish-v1",
        }
    )
    proof = {
        "key_id": "local-test-only",
        "payload": payload,
        "signature": base64.b64encode(key.sign(payload.encode())).decode(),
    }
    trusted = {
        "local-test-only": base64.b64encode(
            key.public_key().public_bytes_raw()
        ).decode()
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path.startswith("/api/sdk/models/"):
                body = json.dumps(
                    {
                        "repository": {
                            "id": "local-fixture",
                            "owner": "verification",
                            "slug": "local-model",
                            "visibility": "private",
                        },
                        "revision": {
                            "id": "local-fixture",
                            "commit_sha": "c" * 64,
                            "manifest_sha256": manifest_hash,
                            "total_size_bytes": size,
                        },
                        "files": [
                            {
                                "path": "model.gguf",
                                "sha256": checksum,
                                "size_bytes": size,
                                "download_url": f"http://127.0.0.1:{self.server.server_port}/weights",
                            }
                        ],
                        "publication": proof,
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            start, end = map(
                int, self.headers["Range"].removeprefix("bytes=").split("-")
            )
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            with source.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    runs = []
    try:
        with tempfile.TemporaryDirectory(prefix="superii-sdk-test-") as cache:
            options = {
                "base_url": f"http://127.0.0.1:{server.server_port}",
                "cache_dir": cache,
                "trusted_keys": trusted,
            }
            for state in ["empty-sdk-cache", "warm-sdk-cache"]:
                started = time.perf_counter()
                with superii.load(
                    "verification/local-model",
                    runtime="llama.cpp",
                    context_size=1024,
                    **options,
                ) as model:
                    loaded = time.perf_counter()
                    first = None
                    output = ""
                    for chunk in model.stream(
                        "The next number after one is", max_tokens=16
                    ):
                        first = first or time.perf_counter()
                        output += chunk
                    ended = time.perf_counter()
                    runs.append(
                        {
                            "cache": state,
                            "load_seconds": loaded - started,
                            "first_output_seconds_from_start": first - started
                            if first
                            else None,
                            "generation_seconds": ended - loaded,
                            "output_characters": len(output),
                            "transferred_bytes": model.snapshot.transferred_bytes,
                            "verified": model.snapshot.verify(),
                            "runtime": model.plan.runtime,
                        }
                    )
        result = {
            "scope": "Local SDK acquisition and real inference smoke test; not a quality benchmark",
            "public_catalog_mutated": False,
            "model_bytes": size,
            "runs": runs,
            "limitations": [
                "OS file cache was not cleared",
                "Existing local model; no accuracy claim",
                "Full verified weights acquired before inference",
            ],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
