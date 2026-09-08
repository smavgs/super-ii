from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..client import Client
from ..errors import IntegrityError
from ..manifest import safe_path
from .access import input_headers
from .contracts import Recipe


def export_project(request: dict, *, destination: Path, client: Client | None = None) -> Path:
    """Download text-only recipe files; does not execute or install anything."""
    if destination.exists():
        raise ValueError("Choose a new project directory")
    own = client is None
    client = client or Client()
    try:
        url = client.base_url + "/api/recipes/generate"
        with client.http.stream(
            "POST",
            url,
            headers={**client._headers(url), **input_headers(client.base_url)},
            json=request,
        ) as response:
            client._check(response)
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 4 * 1024**2:
                    raise IntegrityError("Project response exceeds 4 MiB")
        project = json.loads(body)
        recipe = Recipe(project["recipe"])
        files = project["files"]
        if not isinstance(files, dict) or not 1 <= len(files) <= 100:
            raise IntegrityError("Invalid project file count")
        verified = {}
        for name, content in files.items():
            safe_path(name)
            if not isinstance(content, str):
                raise IntegrityError("Project files must be text")
            encoded = content.encode()
            entry = project["manifest"][name]
            if (
                hashlib.sha256(encoded).hexdigest() != entry["sha256"]
                or len(encoded) != entry["size_bytes"]
            ):
                raise IntegrityError("Project file checksum differs")
            verified[name] = encoded
        if Recipe(json.loads(files["superii-recipe.json"])).sha256 != recipe.sha256:
            raise IntegrityError("Project recipe differs from the response")
        destination.mkdir(mode=0o700, parents=True)
        for name, content in verified.items():
            output = destination / name
            output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            output.write_bytes(content)
            output.chmod(0o600)
        return destination / "superii-recipe.json"
    finally:
        if own:
            client.close()
