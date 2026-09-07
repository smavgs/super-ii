"""Manual GitHub OIDC integration check against one private, synthetic dataset repository."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpx
from superii import Client

ORIGIN = "https://superii.site"
REPOSITORY = "smavgs/build-ship-verification"
DATA = b"".join(
    json.dumps(
        {"text": "Private integration fixture. No user data.", "sample": i},
        sort_keys=True,
    ).encode()
    + b"\n"
    for i in range(3)
)


def main():
    repository_id = str(UUID(os.environ["SUPERII_VERIFY_REPOSITORY_ID"]))
    request_url = urlsplit(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"])
    if request_url.scheme != "https" or not request_url.hostname.endswith(
        ".actions.githubusercontent.com"
    ):
        raise RuntimeError("Expected the GitHub Actions OIDC endpoint")
    query = dict(parse_qsl(request_url.query))
    query["audience"] = ORIGIN
    oidc_url = urlunsplit(request_url._replace(query=urlencode(query)))
    with httpx.Client(trust_env=False, follow_redirects=False, timeout=180) as http:

        def checked(response):
            if not response.is_success:
                raise RuntimeError(
                    f"Integration request returned HTTP {response.status_code}"
                )
            return response

        oidc = checked(
            http.get(
                oidc_url,
                headers={
                    "authorization": "Bearer "
                    + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
                },
            )
        ).json()["value"]
        exchange = ORIGIN + "/api/trusted-publishing/github/exchange"
        denied = http.post(
            exchange,
            headers={"authorization": "Bearer " + oidc},
            json={"repository_id": repository_id, "scopes": ["repository:trace"]},
        )
        assert denied.status_code == 403, "Scope expansion was not rejected"
        invalid = http.post(
            exchange,
            headers={"authorization": "Bearer " + oidc[:-10] + "invalidxyz"},
            json={"repository_id": repository_id, "scopes": ["repository:read"]},
        )
        assert invalid.status_code == 401, "Invalid signature was not rejected"
        response = checked(
            http.post(
                exchange,
                headers={"authorization": "Bearer " + oidc},
                json={
                    "repository_id": repository_id,
                    "scopes": [
                        "repository:read",
                        "repository:upload",
                        "repository:commit",
                        "repository:submit",
                    ],
                },
            )
        ).json()
        token = response["access_token"]
        headers = {"authorization": "Bearer " + token}
        route = ORIGIN + "/api/repositories/" + repository_id
        destination = checked(http.get(route + "/recipe", headers=headers)).json()
        uploaded = False
        if destination["status"] != "published":
            assert destination["status"] in ["draft", "quarantined"]
            existing = {row["path"]: row for row in destination["files"]}
            if "verification.jsonl" in existing:
                assert (
                    existing["verification.jsonl"]["sha256"]
                    == hashlib.sha256(DATA).hexdigest()
                )
            else:
                checked(
                    http.post(
                        route + "/files",
                        headers=headers,
                        data={"path": "verification.jsonl"},
                        files={
                            "file": ("verification.jsonl", DATA, "application/x-ndjson")
                        },
                    )
                )
                uploaded = True
            checked(
                http.post(
                    route + "/publication-metadata",
                    headers=headers,
                    json={"license": "mit", "basis": "original", "confirmed": True},
                )
            )
            publication = checked(http.post(route + "/submit", headers=headers)).json()
            assert publication["status"] == "published", (
                "Central policy did not publish the fixture"
            )
        public = http.get(ORIGIN + "/api/sdk/datasets/" + REPOSITORY)
        assert public.status_code == 404, "The private fixture became publicly readable"
        with Client(token=token) as client:
            snapshot = client.pull(
                REPOSITORY, kind="dataset", files=("verification.jsonl",)
            )
            assert snapshot.verify()
            assert (snapshot.path / "verification.jsonl").read_bytes() == DATA
            report = {
                "status": "passed",
                "repository_id": repository_id,
                "repository": REPOSITORY,
                "revision": snapshot.manifest.revision,
                "manifest_sha256": snapshot.manifest.manifest_sha256,
                "visibility": snapshot.manifest.visibility,
                "files_verified": len(snapshot.files),
                "scope_expansion_rejected": True,
                "invalid_signature_rejected": True,
                "public_access_rejected": True,
                "publication_attestation_verified": True,
                "uploaded_this_run": uploaded,
                "data": "synthetic fixture; no user data",
            }
        output = Path("reports/github-superii-publishing.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
