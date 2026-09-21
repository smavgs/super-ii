#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"Cannot read JSON from {path}: {error}") from error


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: check_gitleaks_report.py REPORT KNOWN_FINDINGS")
    report_path, known_path = map(Path, sys.argv[1:])
    report = load_json(report_path)
    known_document = load_json(known_path)
    if not isinstance(report, list) or known_document.get("schema_version") != 1:
        raise SystemExit("Unsupported Gitleaks report or known-finding schema")
    known_entries = known_document.get("findings")
    if not isinstance(known_entries, list):
        raise SystemExit("Known findings must be a list")

    known = {entry.get("fingerprint") for entry in known_entries if isinstance(entry, dict)}
    if None in known or len(known) != len(known_entries):
        raise SystemExit("Known findings contain a missing or duplicate fingerprint")
    actual = {
        entry.get("Fingerprint") for entry in report if isinstance(entry, dict)
    }
    if None in actual:
        raise SystemExit("Gitleaks report contains a finding without a fingerprint")

    unexpected = sorted(actual - known)
    stale = sorted(known - actual)
    if unexpected:
        print("Unexpected Gitleaks findings:", file=sys.stderr)
        for fingerprint in unexpected:
            print(f"- {fingerprint}", file=sys.stderr)
    if stale:
        print("Stale known-finding entries:", file=sys.stderr)
        for fingerprint in stale:
            print(f"- {fingerprint}", file=sys.stderr)
    if unexpected or stale:
        raise SystemExit(1)
    print(f"Gitleaks full-history report matches {len(known)} exact historical fixtures.")


if __name__ == "__main__":
    main()
