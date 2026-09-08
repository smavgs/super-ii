import os
import re


def input_headers(origin: str) -> dict[str, str]:
    """Explicit per-input credentials are sent only to the canonical recipe API."""
    result = {}
    for role in ("generator", "embedding", "dataset"):
        token = os.environ.get(f"SUPERII_{role.upper()}_TOKEN")
        if not token:
            continue
        if origin != "https://superii.site":
            raise ValueError("Recipe input credentials require the canonical Super ii origin")
        if not re.fullmatch(r"sii_(?:agent_)?[a-z0-9]{40,128}", token):
            raise ValueError("Invalid recipe input credential")
        result[f"x-superii-{role}-token"] = token
    return result
