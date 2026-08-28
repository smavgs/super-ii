#!/usr/bin/env python3
"""Fail-closed validation for Super ii's public launch content and brand asset."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SITE_FILE = ROOT / "src" / "content" / "site.json"
LOGO_FILE = ROOT / "public" / "brand" / "super-ii-logo.png"
EXPECTED_LOGO_SHA256 = "b28353284ddd75513d5344684711a2a2f50065197b9510c12b909adbd346f60f"
EXPECTED_CATALOGS = {"models", "datasets", "spaces"}
EXPECTED_PLANS = {"free", "pro", "team", "enterprise"}
ALLOWED_PLAN_STATUSES = {"available", "beta-waitlist", "proposal"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)


def main() -> int:
    errors: list[str] = []

    try:
        data = json.loads(SITE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {SITE_FILE}: {exc}")
        return 1

    brand = data.get("brand", {})
    if brand.get("name") != "Super ii" or brand.get("shortName") != "Sii":
        errors.append("brand names must remain 'Super ii' and single-line 'Sii'")
    if brand.get("url") != "https://superii.site":
        errors.append("canonical brand URL must be https://superii.site")

    catalog = data.get("catalog")
    if not isinstance(catalog, dict) or set(catalog) != EXPECTED_CATALOGS:
        errors.append(f"catalog keys must be exactly {sorted(EXPECTED_CATALOGS)}")
    else:
        for kind, entries in catalog.items():
            if entries != []:
                errors.append(f"{kind} catalog must stay empty until reviewed uploads open")

    plans = data.get("plans", [])
    plan_ids = {plan.get("id") for plan in plans if isinstance(plan, dict)}
    if plan_ids != EXPECTED_PLANS:
        errors.append(f"plan ids must be exactly {sorted(EXPECTED_PLANS)}")
    for plan in plans:
        if plan.get("status") not in ALLOWED_PLAN_STATUSES:
            errors.append(f"plan {plan.get('id')} has an invalid status")
        if not plan.get("features") or not all(isinstance(item, str) and item.strip() for item in plan.get("features", [])):
            errors.append(f"plan {plan.get('id')} must have non-empty feature labels")
    free = next((plan for plan in plans if plan.get("id") == "free"), {})
    if free.get("price") != "$0" or free.get("status") != "available":
        errors.append("Free must be the only immediately available zero-price plan")
    if any(plan.get("status") == "available" for plan in plans if plan.get("id") != "free"):
        errors.append("paid plans cannot be marked available before billing activation")

    routes = data.get("routes", [])
    if not isinstance(routes, list) or not routes:
        errors.append("routes must be a non-empty list")
    elif len(routes) != len(set(routes)):
        errors.append("routes must be unique")
    else:
        for route in routes:
            if not isinstance(route, str) or not route.startswith("/") or (route != "/" and route.endswith("/")):
                errors.append(f"invalid canonical route: {route!r}")

    try:
        logo_hash = hashlib.sha256(LOGO_FILE.read_bytes()).hexdigest()
    except OSError as exc:
        errors.append(f"cannot read logo: {exc}")
    else:
        if logo_hash != EXPECTED_LOGO_SHA256:
            errors.append("brand logo does not match the user-supplied master asset")

    source_text = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in (ROOT / "src").rglob("*")
        if path.is_file() and path.suffix in {".astro", ".ts", ".css", ".json"}
    ).lower()
    for forbidden in ("54 models", "thousands of our own models", "private model hub"):
        if forbidden in source_text:
            errors.append(f"legacy demo claim remains in production source: {forbidden!r}")

    unbound_clerk_button = re.compile(
        r"<Sign(?:In|Up)Button\b(?![^>]*\basChild\b)[^>]*>\s*<button\b",
        re.DOTALL,
    )
    if unbound_clerk_button.search(source_text):
        errors.append("custom Clerk sign-in and sign-up buttons must use asChild")

    if errors:
        for error in errors:
            fail(error)
        return 1

    print(f"OK: site contract, empty catalogs, {len(plans)} plans, {len(routes)} routes, and supplied logo verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
