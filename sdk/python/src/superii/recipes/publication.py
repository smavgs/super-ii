from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID

import httpx

from ..errors import IntegrityError
from ..manifest import safe_path
from .access import input_headers
from .contracts import Recipe, canonical, validate_document

ORIGIN = "https://superii.site"


def publish(
    recipe: Recipe,
    report: Path,
    repository_id: str,
    *,
    token: str,
    directory: Path = Path("adapter"),
    submit: bool = False,
    transport=None,
) -> dict:
    """Upload verified outputs to an existing editable revision."""
    repository_id = str(UUID(repository_id))
    run = json.loads(report.read_text())
    validate_document("superii-run-v1.json", run)
    if (
        recipe.document["outcome"] != "sft"
        or run["stage"] != "train"
        or run["status"] != "completed"
        or run["recipe_sha256"] != recipe.sha256
    ):
        raise ValueError("Supply the successful training record for this exact recipe")
    if not token.startswith("sii_"):
        raise ValueError("A scoped Super ii publication token is required")
    directory = directory.resolve(strict=True)
    artifacts = {}
    for item in run["artifacts"]:
        name = safe_path(item["path"])
        local = directory / name
        if (
            local.is_symlink()
            or not local.resolve().is_relative_to(directory)
            or not local.is_file()
        ):
            raise IntegrityError("Artifact is not a regular file within the adapter directory")
        with local.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != item["sha256"] or local.stat().st_size != item["size_bytes"]:
            raise IntegrityError("Training output changed; refusing publication")
        artifacts[name] = (local, item["sha256"], item["size_bytes"])
    # Canonical copies bind server-side lineage to the exact files uploaded.
    for name, value in (("superii-recipe.json", recipe.document), ("superii-run.json", run)):
        local = directory / name
        expected = canonical(value) + b"\n"
        if local.exists() and (local.is_symlink() or local.read_bytes() != expected):
            raise IntegrityError("An existing publication record differs")
        local.write_bytes(expected)
        local.chmod(0o600)
        artifacts[name] = (local, hashlib.sha256(expected).hexdigest(), len(expected))
    with httpx.Client(
        base_url=ORIGIN,
        transport=transport,
        trust_env=False,
        follow_redirects=False,
        timeout=180,
        headers={"authorization": "Bearer " + token},
    ) as http:

        def request(method, route, **kwargs):
            response = http.request(method, route, **kwargs)
            if not response.is_success:
                raise RuntimeError(
                    f"Publication returned HTTP {response.status_code}; inspect the workspace"
                )
            return response

        route = f"/api/repositories/{repository_id}"
        destination = request("GET", route + "/recipe").json()
        if destination["status"] not in {"draft", "quarantined"}:
            raise ValueError("Create an editable revision in the destination workspace first")
        branch = {"branch": destination["branch_id"]}
        current = {item["path"]: item for item in destination["files"]}
        for name, (local, expected, size) in artifacts.items():
            if name in current:
                if current[name]["sha256"] == expected and int(current[name]["size_bytes"]) == size:
                    continue
                raise IntegrityError("A destination file differs; use a new editable revision")
            transfer = request(
                "POST",
                route + "/transfers",
                params=branch,
                json={
                    "path": name,
                    "filename": local.name,
                    "mime_type": "application/octet-stream",
                    "length": size,
                    "sha256": expected,
                },
            ).json()
            transfer_id = str(UUID(transfer["transfer_id"]))
            transfer_route = f"/api/transfers/{transfer_id}"
            headers = {
                "x-superii-transfer-token": transfer["transfer_token"],
                "tus-resumable": "1.0.0",
            }
            # Canonical endpoints only; never follow a server-supplied upload URL with credentials.
            with local.open("rb") as stream:
                offset = 0
                while offset < size:
                    chunk = stream.read(min(4 * 1024**2, size - offset))
                    checksum = base64.b64encode(hashlib.sha256(chunk).digest()).decode()
                    response = request(
                        "PATCH",
                        transfer_route,
                        content=chunk,
                        headers={
                            **headers,
                            "content-type": "application/offset+octet-stream",
                            "upload-offset": str(offset),
                            "upload-checksum": "sha256 " + checksum,
                        },
                    )
                    offset += len(chunk)
                    if response.headers.get("upload-offset") != str(offset):
                        raise IntegrityError("The transfer offset differs")
            request("POST", transfer_route + "/commit", headers=headers)
        verified = request("GET", route + "/recipe", params=branch).json()
        if verified["revision_id"] != destination["revision_id"] or not all(
            any(
                row["path"] == name and row["sha256"] == expected and int(row["size_bytes"]) == size
                for row in verified["files"]
            )
            for name, (_, expected, size) in artifacts.items()
        ):
            raise IntegrityError(
                "Destination readback does not match the selected revision and artifacts"
            )
        request(
            "POST",
            route + "/recipe",
            params=branch,
            headers=input_headers(ORIGIN),
            json={"recipe": recipe.document, "run": run},
        )
        result = {
            "repository_id": repository_id,
            "revision_id": destination["revision_id"],
            "files": len(artifacts),
            "status": "uploaded",
            "evidence": "reported",
        }
        if submit:
            result["publication"] = request("POST", route + "/submit", params=branch).json()
            result["status"] = result["publication"].get("status", "evaluated")
        return result


def main():
    parser = argparse.ArgumentParser(
        description="Return a trained adapter to an existing Super ii revision"
    )
    parser.add_argument("repository_id")
    parser.add_argument("run_record", type=Path)
    parser.add_argument("--adapter", type=Path, default=Path("adapter"))
    parser.add_argument(
        "--submit", action="store_true", help="Submit uploaded files to central publication policy"
    )
    args = parser.parse_args()
    print(
        json.dumps(
            publish(
                Recipe.read(),
                args.run_record,
                args.repository_id,
                token=os.environ.get("SUPERII_TOKEN", ""),
                directory=args.adapter,
                submit=args.submit,
            ),
            indent=2,
        )
    )
