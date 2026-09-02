from __future__ import annotations

import json
import sys

from .api_models import WebSearchRequest
from .web_search import _search_sync


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(4_096)
        payload = WebSearchRequest.model_validate_json(raw)
        results = _search_sync(payload)
        sys.stdout.write(json.dumps({"results": results}, separators=(",", ":")))
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
