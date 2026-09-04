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
STATUS_LADDER = {"designed", "implemented", "tested", "integrated", "staging", "production", "GA"}
MAX_WASM_BYTES = 25 * 1024 * 1024


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
        errors.append("Free must remain an immediately available zero-price plan")
    available_paid = {plan.get("id") for plan in plans if plan.get("id") != "free" and plan.get("status") == "available"}
    billing = data.get("billing", {})
    if not isinstance(billing, dict):
        billing = {}
    billing_terms = billing.get("terms", [])
    if (
        billing.get("asset") != "USDC"
        or billing.get("network") != "Ethereum"
        or billing.get("automaticRenewal") is not False
        or billing_terms != [
            {"id": "30_days", "label": "30 days", "discountPercent": 0},
            {"id": "12_months", "label": "12 months", "discountPercent": 20},
        ]
        or billing.get("annualTotalsUsd") != {"pro": "86.40", "teamPerMember": "192.00"}
    ):
        errors.append("billing must expose exact prepaid 30-day and discounted 12-month USDC terms")
    if available_paid:
        required_billing_sources = [
            ROOT / "src" / "lib" / "nowpayments.ts",
            ROOT / "src" / "pages" / "api" / "checkout.ts",
            ROOT / "src" / "pages" / "api" / "payments" / "nowpayments" / "ipn.ts",
            ROOT / "database" / "migrations" / "0005_creator_commerce.sql",
            ROOT / "database" / "migrations" / "0015_prepaid_plan_terms.sql",
            ROOT / "src" / "pages" / "pricing.astro",
        ]
        if available_paid != {"pro", "team"} or not all(path.is_file() for path in required_billing_sources):
            errors.append("paid availability requires the complete Pro and Team NOWPayments contract")
        else:
            billing_contract = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in required_billing_sources)
            for marker in (
                "NOWPAYMENTS_API_KEY",
                "NOWPAYMENTS_IPN_SECRET",
                "USDC",
                "apply_nowpayments_status",
                "12_months",
                "0.80",
            ):
                if marker.lower() not in billing_contract.lower():
                    errors.append(f"paid billing contract is missing {marker}")

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
    for stale in ("how publishing will work", "first release, coming soon", "after the first creator cohort"):
        if stale in source_text:
            errors.append(f"stale launch copy remains in production source: {stale!r}")

    required_machine_files = [
        ROOT / "SYSTEM-STATE.md",
        ROOT / "src" / "lib" / "agent-resources.ts",
        ROOT / "src" / "lib" / "mcp-server.ts",
        ROOT / "src" / "pages" / "agents.md.ts",
        ROOT / "src" / "pages" / "mcp.ts",
        ROOT / "src" / "pages" / "system-state.json.ts",
        ROOT / "src" / "pages" / "system-state.md.ts",
        ROOT / "public" / "schemas" / "repository-manifest-v1.json",
        ROOT / "public" / "schemas" / "repository-api-v1.json",
        ROOT / "public" / "schemas" / "use-manifest-v1.json",
        ROOT / "public" / "schemas" / "runtime-registry-v1.json",
        ROOT / "src" / "content" / "runtime-registry.json",
        ROOT / "src" / "lib" / "use-model.ts",
        ROOT / "src" / "components" / "UseModel.astro",
        ROOT / "src" / "pages" / "runtime-registry.json.ts",
        ROOT / "runtime" / "src" / "superii_runtime" / "inspectors" / "compatibility.py",
        ROOT / "database" / "migrations" / "0007_agent_native_foundation.sql",
        ROOT / "database" / "migrations" / "0008_notebook_foundation.sql",
        ROOT / "database" / "migrations" / "0009_resumable_runtime.sql",
        ROOT / "database" / "migrations" / "0010_use_model_foundation.sql",
        ROOT / "docs" / "architecture" / "notebook-security.md",
        ROOT / "docs" / "architecture" / "cas-integrity.md",
        ROOT / "docs" / "architecture" / "performance-baseline.md",
        ROOT / "docs" / "architecture" / "resumable-transfers.md",
        ROOT / "docs" / "architecture" / "persistent-inference.md",
        ROOT / "runtime" / "src" / "superii_runtime" / "inspectors" / "notebooks.py",
        ROOT / "runtime" / "src" / "superii_runtime" / "notebooks.py",
        ROOT / "runtime" / "src" / "superii_runtime" / "transfers.py",
        ROOT / "runtime" / "src" / "superii_runtime" / "workspace_cache.py",
        ROOT / "runtime" / "src" / "superii_runtime" / "runtimes" / "llama_server.py",
        ROOT / "runtime" / "notebook-image" / "Dockerfile",
        ROOT / "runtime" / "notebook-image" / "execute_notebook.py",
        ROOT / "rust" / "Cargo.toml",
        ROOT / "rust" / "Cargo.lock",
        ROOT / "rust" / "src" / "transfer.rs",
        ROOT / "rust" / "src" / "bin" / "superii-transferd.rs",
        ROOT / "rust" / "src" / "bin" / "superii.rs",
        ROOT / "src" / "lib" / "transfer-ticket.ts",
        ROOT / "src" / "lib" / "transfers.ts",
        ROOT / "src" / "pages" / "api" / "transfers" / "[transferId].ts",
        ROOT / "src" / "lib" / "notebook-markdown.ts",
        ROOT / "src" / "pages" / "notebooks" / "index.astro",
        ROOT / "database" / "migrations" / "0011_bridge_foundation.sql",
        ROOT / "docs" / "architecture" / "bridge.md",
        ROOT / "src" / "lib" / "bridge.ts",
        ROOT / "src" / "pages" / "bring-my-work.astro",
        ROOT / "runtime" / "src" / "superii_runtime" / "bridge.py",
        ROOT / "src" / "components" / "AgentStarter.astro",
        ROOT / "database" / "migrations" / "0012_agent_participation.sql",
        ROOT / "docs" / "architecture" / "agent-participation.md",
        ROOT / "src" / "content" / "agent-connectors.json",
        ROOT / "public" / "schemas" / "agent-connector-registry-v1.json",
        ROOT / "public" / "skills" / "superii" / "SKILL.md",
        ROOT / "public" / "skills" / "superii" / "manifest.json",
        ROOT / "public" / "skills" / "superii" / "signature.json",
        ROOT / "public" / "skills" / "superii" / "public-key.json",
        ROOT / "src" / "lib" / "a2a.ts",
        ROOT / "src" / "lib" / "agent-auth.ts",
        ROOT / "src" / "lib" / "agent-profile.ts",
        ROOT / "src" / "lib" / "work-mcp-server.ts",
        ROOT / "src" / "pages" / ".well-known" / "agent-card.json.ts",
        ROOT / "src" / "pages" / "a2a" / "v1" / "[...operation].ts",
        ROOT / "src" / "pages" / "mcp" / "work.ts",
        ROOT / "src" / "components" / "AgentWorkspace.astro",
        ROOT / "rust" / "src" / "connect.rs",
    ]
    missing_machine_files = [str(path.relative_to(ROOT)) for path in required_machine_files if not path.is_file()]
    if missing_machine_files:
        errors.append(f"agent-native production files missing: {missing_machine_files}")
    else:
        system_state = (ROOT / "SYSTEM-STATE.md").read_text(encoding="utf-8")
        statuses = set(re.findall(r"\|\s*([^|]+?)\s*\|\s*(designed|implemented|tested|integrated|staging|production|GA)\s*\|", system_state))
        if len(statuses) < 10:
            errors.append("SYSTEM-STATE.md must contain a substantial canonical capability register")
        if {status for _, status in statuses} - STATUS_LADDER:
            errors.append("SYSTEM-STATE.md contains an unknown capability status")
        mcp_contract = (ROOT / "src" / "lib" / "mcp-server.ts").read_text(encoding="utf-8")
        for marker in ("createMcpHandler", "legacy: 'stateless'", "readOnlyHint: true", "search_models", "download_artifact"):
            if marker not in mcp_contract:
                errors.append(f"public MCP contract is missing {marker}")
        trusted_contract = (ROOT / "src" / "pages" / "api" / "trusted-publishing" / "github" / "exchange.ts").read_text(encoding="utf-8")
        for marker in ("createRemoteJWKSet", "jwtVerify", "token.actions.githubusercontent.com", "sha256Hex", "cache-control': 'no-store"):
            if marker not in trusted_contract:
                errors.append(f"trusted publishing contract is missing {marker}")
        notebook_inspector = (
            ROOT / "runtime" / "src" / "superii_runtime" / "inspectors" / "notebooks.py"
        ).read_text(encoding="utf-8")
        for marker in (
            "MAX_NOTEBOOK_BYTES",
            "nbformat.validate",
            "SAFE_IMAGE_MIME_TYPES",
            '"code_executed": False',
            '"javascript_rendered": False',
        ):
            if marker not in notebook_inspector:
                errors.append(f"static notebook inspector is missing {marker}")
        notebook_markdown = (ROOT / "src" / "lib" / "notebook-markdown.ts").read_text(
            encoding="utf-8"
        )
        for marker in ("html: false", "markdown.disable('image')", "nofollow noreferrer"):
            if marker not in notebook_markdown:
                errors.append(f"static notebook renderer is missing {marker}")
        transfer_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "rust" / "src" / "transfer.rs",
                ROOT / "src" / "lib" / "transfer-ticket.ts",
                ROOT / "src" / "lib" / "transfers.ts",
                ROOT / "src" / "pages" / "api" / "transfers" / "[transferId].ts",
                ROOT / "src" / "pages" / "repositories" / "[repositoryId]" / "edit.astro",
            )
        )
        for marker in (
            'TUS_VERSION: &str = "1.0.0"',
            "bind.ip().is_loopback()",
            "ct_eq",
            "sync_all",
            "DEFAULT_MAX_UPLOAD_BYTES",
            "superii-transfer-ticket-v1",
            "request.body",
            "advance_resumable_upload",
            "transfer_runtime_state_missing",
            "TransferResumeError",
        ):
            if marker not in transfer_contract:
                errors.append(f"resumable transfer contract is missing {marker}")
        runtime_proxy = (ROOT / "src" / "lib" / "runtime.ts").read_text(encoding="utf-8")
        if "redirect: init.redirect ?? 'manual'" not in runtime_proxy:
            errors.append("runtime proxy must reject redirects with Cloudflare-compatible manual handling")
        notebook_runner = (
            ROOT / "runtime" / "src" / "superii_runtime" / "notebooks.py"
        ).read_text(encoding="utf-8")
        for marker in (
            '"--network=none"',
            '"--ipc=none"',
            '"--read-only"',
            '"--cap-drop=ALL"',
            '"--security-opt=no-new-privileges:true"',
            '"--user=65532:65532"',
            '"--ulimit=nofile=256:256"',
            "result_sha256",
            "_docker_environment",
        ):
            if marker not in notebook_runner:
                errors.append(f"isolated notebook runner is missing {marker}")
        llama_server = (
            ROOT / "runtime" / "src" / "superii_runtime" / "runtimes" / "llama_server.py"
        ).read_text(encoding="utf-8")
        for marker in (
            '"127.0.0.1"',
            '"--cont-batching"',
            '"--no-webui"',
            "model_sha256",
            "record_model_instance",
            "llama_server_idle_seconds",
        ):
            if marker not in llama_server:
                errors.append(f"persistent llama.cpp contract is missing {marker}")
        use_model_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "src" / "lib" / "use-model.ts",
                ROOT / "src" / "components" / "UseModel.astro",
                ROOT / "src" / "lib" / "agent-resources.ts",
            )
        )
        for marker in (
            "superii-local-deterministic-v1",
            "transmittedToSuperii: false",
            "local_files_only=True",
            "useDownloadScript",
            "useNotebook",
            "No free hosted GPU pool",
        ):
            if marker not in use_model_contract:
                errors.append(f"Use Model contract is missing {marker}")
        bridge_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "src" / "lib" / "bridge.ts",
                ROOT / "src" / "pages" / "bring-my-work.astro",
                ROOT / "runtime" / "src" / "superii_runtime" / "bridge.py",
                ROOT / "database" / "migrations" / "0011_bridge_foundation.sql",
            )
        )
        for marker in (
            "BRIDGE_CLIENT_ID",
            "createRemoteJWKSet",
            "AES-GCM",
            "redirect: 'manual'",
            "ownership_attested: true",
            "bridgeInitialized",
            "MutationObserver",
            "snapshot_download",
            "process_upload",
            "item.awaiting_review",
        ):
            if marker not in bridge_contract:
                errors.append(f"Bridge contract is missing {marker}")
        agent_starter_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "src" / "components" / "AgentStarter.astro",
                ROOT / "src" / "pages" / "index.astro",
                ROOT / "src" / "pages" / "account.astro",
                ROOT / "src" / "pages" / "sign-up.astro",
            )
        )
        for marker in (
            "curl -fsSL https://ollama.com/install.sh | sh",
            "irm https://ollama.com/install.ps1 | iex",
            "ollama signin",
            "ollama launch opencode",
            "gpt-oss:20b-cloud",
            "Free cloud usage has session and weekly limits.",
            "superii-agent-starter-v1",
            "opencode mcp add",
            "opencode mcp list",
            "oauth: false",
            "/account?welcome=agent-starter#agent-starter",
        ):
            if marker not in agent_starter_contract:
                errors.append(f"Agent Starter contract is missing {marker}")
        ai_worker_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "src" / "components" / "AIWorkerStarter.astro",
                ROOT / "src" / "pages" / "index.astro",
                ROOT / "src" / "pages" / "account.astro",
                ROOT / "src" / "pages" / "sign-up.astro",
                ROOT / "src" / "pages" / "sign-in.astro",
                ROOT / "src" / "pages" / "docs.astro",
            )
        )
        for marker in (
            "Your own free AI worker",
            "<details class=\"ai-worker\"",
            "superii-ai-worker-v1",
            "ollama pull qwen3.5:4b",
            "Ollama → Settings → Context length",
            "64K or higher",
            "ollama launch opencode",
            "opencode mcp add",
            "opencode mcp list",
            "Public and read-only",
            "/account?welcome=ai-worker#ai-worker",
            "history.replaceState",
        ):
            if marker not in ai_worker_contract:
                errors.append(f"AI Worker contract is missing {marker}")
        homepage_contract = (ROOT / "src" / "pages" / "index.astro").read_text(encoding="utf-8")
        for private_detail in (
            "ollama pull qwen3.5:4b",
            "ollama launch opencode",
            "https://ollama.com/download",
        ):
            if private_detail in homepage_contract:
                errors.append(f"AI Worker homepage hook exposes setup detail: {private_detail}")
        agent_participation_contract = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT / "database" / "migrations" / "0012_agent_participation.sql",
                ROOT / "src" / "lib" / "agent-auth.ts",
                ROOT / "src" / "lib" / "work-mcp-server.ts",
                ROOT / "src" / "components" / "AgentWorkspace.astro",
            )
        )
        for marker in (
            "spend_limit_cents = 0",
            "agent_action_receipts_immutable",
            "consume_agent_access_token",
            "agent_create_repository_with_receipt",
            "review_agent_contribution",
            "createMcpHandler",
            "create_draft_repository",
            "create_revision",
            "prepare_resumable_upload",
            "submit_revision_for_review",
            "claim_contribution_job",
            "submit_contribution_job",
            "get_action_receipt",
            "This tool cannot publish",
        ):
            if marker not in agent_participation_contract:
                errors.append(f"agent participation contract is missing {marker}")
        connector_contract = json.loads(
            (ROOT / "src" / "content" / "agent-connectors.json").read_text(encoding="utf-8")
        )
        if connector_contract.get("public_mcp_url") != "https://superii.site/mcp":
            errors.append("connector registry public MCP URL changed")
        if connector_contract.get("work_mcp_url") != "https://superii.site/mcp/work":
            errors.append("connector registry Work MCP URL changed")
        connector_policy = connector_contract.get("connector_policy", {})
        if connector_policy != {
            "default_access": "public-read-only",
            "write_access": "explicit-workspace-token",
            "installer_behavior": "dry-run-first",
            "secrets_in_commands": False,
        }:
            errors.append("connector registry safety policy changed")
        verified_connectors = {
            item.get("id") for item in connector_contract.get("connectors", [])
            if item.get("status") == "verified"
        }
        if not {"codex", "opencode-v1", "opencode-v2", "claude-code"}.issubset(verified_connectors):
            errors.append("connector registry is missing a verified first-party setup")
        connect_cli = (ROOT / "rust" / "src" / "connect.rs").read_text(encoding="utf-8")
        for marker in (
            'PUBLIC_MCP_URL: &str = "https://superii.site/mcp"',
            "atomic_replace",
            "configuration changed since connect; rollback refused",
            "mode(0o600)",
            "already exists with a different URL; no file was changed",
        ):
            if marker not in connect_cli:
                errors.append(f"safe connector CLI is missing {marker}")

    wasm_files = sorted((ROOT / "public" / "runtime-assets" / "wasm").glob("*.wasm"))
    if not wasm_files:
        errors.append("browser inference release must contain checked-in WASM assets")
    for wasm_file in wasm_files:
        if wasm_file.stat().st_size > MAX_WASM_BYTES:
            errors.append(
                f"browser WASM asset exceeds the 25 MiB release ceiling: {wasm_file.name}"
            )

    truth_sources = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in (ROOT / "SYSTEM-STATE.md", ROOT / "src" / "pages" / "docs.astro")
    ).lower()
    for unsupported_claim in ("rootless isolated containers", "bounded rootless containers"):
        if unsupported_claim in truth_sources:
            errors.append(f"unsupported container claim remains public: {unsupported_claim}")

    unbound_clerk_button = re.compile(
        r"<sign(?:in|up)button\b(?![^>]*\baschild\b)[^>]*>\s*<button\b",
        re.DOTALL,
    )
    if unbound_clerk_button.search(source_text):
        errors.append("custom Clerk sign-in and sign-up buttons must use asChild")

    if errors:
        for error in errors:
            fail(error)
        return 1

    print(f"OK: site, Agent Starter, AI Worker, agent-native and Use Model machine contracts, empty catalogs, {len(plans)} plans, {len(routes)} routes, and supplied logo verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
