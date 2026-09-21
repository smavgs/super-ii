#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    forbidden = tuple(f"/Users/{user}/".encode() for user in ("apple", "mac"))
    findings: list[str] = []
    for raw_name in listed.split(b"\0"):
        if not raw_name:
            continue
        name = raw_name.decode("utf-8")
        path = root / name
        if not path.is_file():
            continue
        content = path.read_bytes()
        if b"\0" in content:
            continue
        for line_number, line in enumerate(content.splitlines(), start=1):
            if any(marker in line for marker in forbidden):
                findings.append(f"{name}:{line_number}")

    templates = sorted((root / "runtime").glob("site.superii.*.plist.template"))
    if len(templates) != 4:
        findings.append("runtime: expected four portable launch-agent templates")
    for template in templates:
        content = template.read_text(encoding="utf-8")
        if "__SUPERII_RUNTIME_ROOT__" not in content or "__SUPERII_LOG_ROOT__" not in content:
            findings.append(f"{template.relative_to(root)}: missing portable path markers")

    if findings:
        raise SystemExit("Non-portable repository paths:\n" + "\n".join(findings))
    print("Portable-path check passed for tracked and untracked repository files.")


if __name__ == "__main__":
    main()
