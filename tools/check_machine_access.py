"""Read-only smoke check using Python's ordinary User-Agent, without cookies."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default="https://superii.site")
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    results = []

    def request(path: str, body: dict | None = None):
        headers = {"accept": "application/json, text/event-stream"}
        if body is not None:
            headers["content-type"] = "application/json"
        with urlopen(
            Request(
                origin + path,
                data=json.dumps(body).encode() if body is not None else None,
                headers=headers,
            ),
            timeout=30,
        ) as response:
            raw = response.read(2 * 1024**2).decode()
            content_type = response.headers.get("content-type", "")
            assert response.status == 200 and "text/html" not in content_type, path
            results.append(
                {
                    "path": path,
                    "method": "POST" if body else "GET",
                    "status": response.status,
                    "content_type": content_type,
                }
            )
            if "text/event-stream" in content_type:
                return json.loads(
                    next(
                        line[6:]
                        for line in raw.splitlines()
                        if line.startswith("data: ")
                    )
                )
            return json.loads(raw) if "json" in content_type else raw

    assert request("/api/health")["status"] == "ok"
    assert "Super ii" in request("/llms.txt")
    for path in ("/mcp", "/mcp/work"):
        assert request(path, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})[
            "result"
        ]["tools"]
    protected = request(
        "/mcp/work",
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "get_action_receipt",
                "arguments": {"receipt_id": "00000000-0000-4000-8000-000000000001"},
            },
        },
    )
    assert protected["result"]["isError"] is True
    error_text = json.dumps(protected["result"]).lower()
    assert "token" in error_text or "authentication" in error_text
    keys = request("/api/publication-keys")
    assert isinstance(keys["keys"], list)
    assert request("/schemas/sdk-manifest-v1.json")["$id"].endswith(
        "sdk-manifest-v1.json"
    )
    print(
        json.dumps(
            {
                "verified_at": datetime.now(timezone.utc).isoformat(),
                "client": "default Python urllib, no cookies or bearer token",
                "routes": results,
                "protected_work_read_denied": True,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
