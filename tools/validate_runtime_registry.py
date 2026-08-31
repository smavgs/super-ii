#!/usr/bin/env python3
"""Fail-closed validation for the public Use Model runtime registry."""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_FILE = ROOT / "src" / "content" / "runtime-registry.json"
REGISTRY_SCHEMA = ROOT / "public" / "schemas" / "runtime-registry-v1.json"
USE_SCHEMA = ROOT / "public" / "schemas" / "use-manifest-v1.json"

EXPECTED_INTEGRATIONS = {
    "llama-cpp",
    "ollama",
    "mlx-lm",
    "transformers",
    "diffusers",
    "transformers-js",
    "lm-studio",
    "jan",
    "docker-model-runner",
    "vllm",
    "sglang",
    "superii-runtime",
}
EXPECTED_AGENTS = {"codex", "pi", "hermes", "openclaw"}
EXPECTED_NOTEBOOKS = {"jupyter", "colab", "kaggle"}
VERIFIED_INTEGRATIONS = {"transformers-js", "superii-runtime"}
VERIFIED_AGENTS = {"codex"}
INTEGRATION_DOCUMENTATION_HOSTS = {
    "llama-cpp": "github.com",
    "ollama": "docs.ollama.com",
    "mlx-lm": "github.com",
    "transformers": "huggingface.co",
    "diffusers": "huggingface.co",
    "transformers-js": "huggingface.co",
    "lm-studio": "lmstudio.ai",
    "jan": "jan.ai",
    "docker-model-runner": "docs.docker.com",
    "vllm": "docs.vllm.ai",
    "sglang": "docs.sglang.io",
    "superii-runtime": "superii.site",
}
AGENT_DOCUMENTATION_HOSTS = {
    "codex": "developers.openai.com",
    "pi": "github.com",
    "hermes": "hermes-agent.nousresearch.com",
    "openclaw": "docs.openclaw.ai",
}
CATEGORIES = {"library", "local-runtime", "browser", "desktop-app", "api-server", "hosted"}
STATUSES = {"verified", "registry-supported", "community", "failing", "unsupported"}
FORMATS = {"gguf", "safetensors", "pytorch", "onnx", "mlx", "diffusers", "dduf"}
SAFE_EXECUTABLE = re.compile(r"^[A-Za-z0-9._-]+$")
TOKEN = re.compile(r"\{\{([a-z_]+)\}\}")
FORBIDDEN_SHELL = ("curl |", "curl|", "wget |", "wget|", "&&", "||", ";", "`", "$(")


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path.relative_to(ROOT)}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path.relative_to(ROOT)} must contain one JSON object")
    return value


def identifiers(items: object, label: str, errors: list[str]) -> set[str]:
    if not isinstance(items, list):
        errors.append(f"{label} must be an array")
        return set()
    values = [item.get("id") for item in items if isinstance(item, dict)]
    if len(values) != len(items) or not all(isinstance(value, str) for value in values):
        errors.append(f"every {label} entry must have a string id")
        return set()
    if len(values) != len(set(values)):
        errors.append(f"{label} ids must be unique")
    return set(values)


def parsed_date(value: object, label: str, errors: list[str]) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        errors.append(f"{label} must be an ISO calendar date")
        return None


def main() -> int:
    errors: list[str] = []
    try:
        registry = load_json(REGISTRY_FILE)
        registry_schema = load_json(REGISTRY_SCHEMA)
        use_schema = load_json(USE_SCHEMA)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if registry.get("schemaVersion") != 1:
        errors.append("runtime registry schemaVersion must remain 1")
    if registry_schema.get("$id") != "https://superii.site/schemas/runtime-registry-v1.json":
        errors.append("runtime registry schema has the wrong canonical id")
    if use_schema.get("$id") != "https://superii.site/schemas/use-manifest-v1.json":
        errors.append("Use Manifest schema has the wrong canonical id")

    cadence = registry.get("reviewCadenceDays")
    if not isinstance(cadence, int) or not 1 <= cadence <= 365:
        errors.append("reviewCadenceDays must be between 1 and 365")
        cadence = 0
    published = parsed_date(registry.get("publishedAt"), "publishedAt", errors)
    if published and published > date.today():
        errors.append("publishedAt cannot be in the future")

    allowed_tokens = registry.get("allowedTemplateTokens")
    if not isinstance(allowed_tokens, list) or not allowed_tokens or not all(
        isinstance(token, str) and re.fullmatch(r"[a-z_]+", token) for token in allowed_tokens
    ):
        errors.append("allowedTemplateTokens must be a non-empty lowercase token list")
        allowed_tokens = []
    elif len(allowed_tokens) != len(set(allowed_tokens)):
        errors.append("allowedTemplateTokens must be unique")

    integrations = registry.get("integrations")
    integration_ids = identifiers(integrations, "integration", errors)
    if integration_ids != EXPECTED_INTEGRATIONS:
        errors.append(f"integration ids must be exactly {sorted(EXPECTED_INTEGRATIONS)}")

    if isinstance(integrations, list):
        for integration in integrations:
            if not isinstance(integration, dict):
                continue
            integration_id = str(integration.get("id", "<missing>"))
            prefix = f"integration {integration_id}"
            status = integration.get("status")
            if status not in STATUSES:
                errors.append(f"{prefix} has an invalid status")
            if (status == "verified") != (integration_id in VERIFIED_INTEGRATIONS):
                errors.append(f"{prefix} verified status exceeds the checked release evidence")
            if integration.get("category") not in CATEGORIES:
                errors.append(f"{prefix} has an invalid category")
            if not isinstance(integration.get("formats"), list) or not set(integration.get("formats", [])).issubset(FORMATS):
                errors.append(f"{prefix} has an invalid format contract")
            for field in ("summary", "verification"):
                if not isinstance(integration.get(field), str) or not integration[field].strip():
                    errors.append(f"{prefix} requires non-empty {field} evidence")

            documentation = urlparse(str(integration.get("documentation", "")))
            if documentation.scheme != "https" or not documentation.netloc:
                errors.append(f"{prefix} documentation must be an absolute HTTPS URL")
            elif documentation.hostname != INTEGRATION_DOCUMENTATION_HOSTS.get(integration_id):
                errors.append(f"{prefix} documentation host is not the reviewed upstream")
            verified_at = parsed_date(integration.get("verifiedAt"), f"{prefix} verifiedAt", errors)
            expires_at = parsed_date(integration.get("expiresAt"), f"{prefix} expiresAt", errors)
            if verified_at and expires_at:
                delta = (expires_at - verified_at).days
                if delta < 1 or (cadence and delta > cadence):
                    errors.append(f"{prefix} review expiry must be within the registry cadence")
                if published and verified_at > published:
                    errors.append(f"{prefix} cannot be reviewed after publishedAt")
                if expires_at < date.today():
                    errors.append(f"{prefix} review evidence has expired")

            commands = integration.get("commands")
            if not isinstance(commands, list):
                errors.append(f"{prefix} commands must be an array")
                continue
            command_ids: list[str] = []
            for command in commands:
                if not isinstance(command, dict):
                    errors.append(f"{prefix} command entries must be objects")
                    continue
                command_ids.append(str(command.get("id", "")))
                executable = command.get("executable")
                if not isinstance(executable, str) or not SAFE_EXECUTABLE.fullmatch(executable):
                    errors.append(f"{prefix} command executable is not allowlist-shaped")
                arguments = command.get("args")
                if not isinstance(arguments, list) or not all(isinstance(argument, str) for argument in arguments):
                    errors.append(f"{prefix} command args must be strings")
                    continue
                command_text = " ".join([str(executable), *arguments])
                if any(forbidden in command_text for forbidden in FORBIDDEN_SHELL):
                    errors.append(f"{prefix} command contains shell composition")
                if any(character in command_text for character in ("\n", "\r", "\x00")):
                    errors.append(f"{prefix} command contains control characters")
                unknown_tokens = set(TOKEN.findall(command_text)) - set(allowed_tokens)
                if unknown_tokens:
                    errors.append(f"{prefix} command uses unknown template tokens: {sorted(unknown_tokens)}")
                residue = TOKEN.sub("", command_text)
                if "{{" in residue or "}}" in residue:
                    errors.append(f"{prefix} command contains malformed template syntax")
            if len(command_ids) != len(set(command_ids)):
                errors.append(f"{prefix} command ids must be unique")

            api = integration.get("api")
            if api is not None:
                if not isinstance(api, dict) or api.get("protocol") != "openai-compatible":
                    errors.append(f"{prefix} API must use the explicit OpenAI-compatible contract")
                else:
                    endpoint = urlparse(str(api.get("baseUrl", "")))
                    if endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost"}:
                        errors.append(f"{prefix} generated API endpoint must stay on loopback")

    agents = registry.get("agents")
    agent_ids = identifiers(agents, "agent", errors)
    if agent_ids != EXPECTED_AGENTS:
        errors.append(f"agent ids must be exactly {sorted(EXPECTED_AGENTS)}")
    if isinstance(agents, list):
        for agent in agents:
            if not isinstance(agent, dict):
                continue
            agent_id = str(agent.get("id", "<missing>"))
            if (agent.get("status") == "verified") != (agent_id in VERIFIED_AGENTS):
                errors.append(f"agent {agent_id} verified status exceeds the checked documentation evidence")
            documentation = urlparse(str(agent.get("documentation", "")))
            if documentation.scheme != "https" or not documentation.netloc:
                errors.append(f"agent {agent_id} documentation must be an absolute HTTPS URL")
            elif documentation.hostname != AGENT_DOCUMENTATION_HOSTS.get(agent_id):
                errors.append(f"agent {agent_id} documentation host is not the reviewed upstream")

    notebooks = registry.get("notebooks")
    if identifiers(notebooks, "notebook", errors) != EXPECTED_NOTEBOOKS:
        errors.append(f"notebook ids must be exactly {sorted(EXPECTED_NOTEBOOKS)}")
    if registry.get("hostedProviders") != []:
        errors.append("external hosted providers must stay empty until funded capacity is verified")
    if isinstance(notebooks, list):
        expected_notebook_hosts = {"colab": "colab.research.google.com", "kaggle": "www.kaggle.com"}
        for notebook in notebooks:
            if not isinstance(notebook, dict) or notebook.get("id") == "jupyter":
                continue
            notebook_url = urlparse(str(notebook.get("url", "")))
            if notebook_url.scheme != "https" or notebook_url.hostname != expected_notebook_hosts.get(notebook.get("id")):
                errors.append(f"notebook {notebook.get('id')} must use its reviewed HTTPS host")

    combined = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in (
            REGISTRY_FILE,
            ROOT / "src" / "lib" / "use-model.ts",
            ROOT / "src" / "components" / "UseModel.astro",
            ROOT / "src" / "lib" / "agent-resources.ts",
        )
    )
    for marker in (
        "superii-local-deterministic-v1",
        "transmittedToSuperii: false",
        "local_files_only=True",
        "curl --fail --location --proto '=https' --proto-redir '=https'",
        "Refusing to overwrite",
        "use.ipynb",
        "use.json",
        "use.md",
        "No free hosted GPU pool",
        "mcp_servers.superii",
        "127.0.0.1",
    ):
        if marker not in combined:
            errors.append(f"Use Model implementation is missing release marker: {marker}")
    combined_lower = combined.lower()
    for forbidden in ("trust_remote_code=true",):
        if forbidden in combined_lower:
            errors.append(f"Use Model implementation contains forbidden behavior: {forbidden}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"OK: Use Model registry v1 verified {len(integration_ids)} integrations, "
        f"{len(agent_ids)} agents, local-only hardware guidance, safe commands, and zero hosted-provider claims"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
