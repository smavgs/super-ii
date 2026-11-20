#!/usr/bin/env python3
"""Audit every checked-in Python lock without installing its optional ML stacks."""
import json
from pathlib import Path
import sys
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCKS = (
    "runtime/uv.lock", "runtime/space-image/uv.lock", "runtime/notebook-image/uv.lock",
    "sdk/python/uv.lock", "src/data/recipes/uv.lock", "src/data/recipes/soup/uv.lock",
)
# No fixed release; see docs/security/ACCELERATE-CVE-2026-69112.md. New IDs fail.
COMPENSATED = {("accelerate", "1.14.0"): {"GHSA-4j2p-28q2-5m79", "PYSEC-2026-3804"}}


def main() -> int:
    entries: dict[tuple[str, str], list[str]] = {}
    for name in LOCKS:
        for package in tomllib.loads((ROOT / name).read_text())["package"]:
            if "registry" in package.get("source", {}):
                key = (package["name"], package["version"].split("+")[0])
                entries.setdefault(key, []).append(name)
    keys = list(entries)
    queries = [{"package": {"name": n, "ecosystem": "PyPI"}, "version": v} for n, v in keys]
    request = urllib.request.Request(
        "https://api.osv.dev/v1/querybatch", data=json.dumps({"queries": queries}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        results = json.load(response)["results"]
    if len(results) != len(keys):
        raise RuntimeError("OSV returned an incomplete result; audit did not pass")
    failures = 0
    for key, result in zip(keys, results, strict=True):
        if "error" in result:
            raise RuntimeError("OSV could not scan a package; audit did not pass")
        for advisory in result.get("vulns", []):
            identifier = advisory["id"]
            compensated = identifier in COMPENSATED.get(key, set())
            print(f"{'COMPENSATED' if compensated else 'FAIL'} {key[0]} {key[1]} {identifier}: {', '.join(entries[key])}")
            failures += not compensated
    print(f"Scanned {len(keys)} package/version pairs in {len(LOCKS)} locks; {failures} uncompensated advisories")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
