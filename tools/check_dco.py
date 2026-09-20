#!/usr/bin/env python3
"""Require a Developer Certificate of Origin sign-off on every PR commit."""

from __future__ import annotations

import re
import subprocess
import sys


SIGN_OFF = re.compile(r"(?im)^Signed-off-by:\s+[^<>\r\n]+\s+<[^<>\s]+@[^<>\s]+>\s*$")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    ).stdout


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: check_dco.py <base-sha> <head-sha>", file=sys.stderr)
        return 2

    base_sha, head_sha = sys.argv[1:]
    commits = [
        line
        for line in git("rev-list", "--reverse", f"{base_sha}..{head_sha}").splitlines()
        if line
    ]
    if not commits:
        print("ERROR: pull request contains no commits", file=sys.stderr)
        return 1

    unsigned: list[str] = []
    for commit in commits:
        message = git("show", "-s", "--format=%B", commit)
        if not SIGN_OFF.search(message):
            subject = git("show", "-s", "--format=%s", commit).strip()
            unsigned.append(f"{commit[:12]} {subject}")

    if unsigned:
        print("ERROR: every pull-request commit needs a DCO Signed-off-by trailer:", file=sys.stderr)
        for commit in unsigned:
            print(f"  - {commit}", file=sys.stderr)
        print("Create commits with `git commit -s`.", file=sys.stderr)
        return 1

    print(f"OK: {len(commits)} pull-request commit(s) include DCO sign-off")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
