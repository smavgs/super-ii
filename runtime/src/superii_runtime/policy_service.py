"""Separate loopback service with its own credential and signing key."""

from __future__ import annotations

import base64
import hmac
import os
from typing import Annotated
from uuid import UUID

import psycopg
import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Header, HTTPException
from psycopg.rows import dict_row

from .publication_policy import POLICY_SHA256, VERSION, canonical, evaluate
from .settings import get_settings

app = FastAPI(title="Super ii independent publication policy", docs_url=None, redoc_url=None)


def signing_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(
        base64.b64decode(
            os.environ["SUPERII_POLICY_SIGNING_KEY"],
            validate=True,
        )
    )


def authenticate(supplied: str | None) -> None:
    expected = get_settings().policy_token
    if expected is None or len(expected.get_secret_value()) < 32:
        raise HTTPException(503, "policy credential is not configured")
    if not hmac.compare_digest((supplied or "").encode(), expected.get_secret_value().encode()):
        raise HTTPException(401, "invalid policy credential")


@app.get("/ready")
def ready(x_superii_policy_token: Annotated[str | None, Header()] = None) -> dict:
    authenticate(x_superii_policy_token)
    try:
        key = signing_key()
        with psycopg.connect(get_settings().require_database_url(), row_factory=dict_row) as conn:
            trusted = conn.execute(
                "select public_key from app.publication_keys "
                "where id = %s and enabled and policy_sha256 = %s",
                (os.environ["SUPERII_POLICY_KEY_ID"], POLICY_SHA256),
            ).fetchone()
        if (
            not trusted
            or base64.b64decode(trusted["public_key"]) != key.public_key().public_bytes_raw()
        ):
            raise ValueError("policy key is not registered")
    except (KeyError, ValueError, RuntimeError, psycopg.Error) as error:
        raise HTTPException(503, "policy signing or database configuration unavailable") from error
    return {"state": "ready", "policy_version": VERSION, "policy_sha256": POLICY_SHA256}


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/publish")
def publish(
    repository_id: UUID,
    revision_id: UUID,
    x_superii_policy_token: Annotated[str | None, Header()] = None,
) -> dict:
    authenticate(x_superii_policy_token)
    try:
        with psycopg.connect(get_settings().require_database_url(), row_factory=dict_row) as conn:
            row = conn.execute(
                "select app.publication_candidate(%s,%s) as candidate", (repository_id, revision_id)
            ).fetchone()
            candidate = row["candidate"] if row else None
            if not candidate:
                raise HTTPException(404, "finalized revision not found")
            if candidate.get("published_decision"):
                return {
                    "status": "published",
                    "decision": candidate["published_decision"],
                    "replayed": True,
                }
            result = evaluate(candidate)
            payload = canonical(result)
            signature = base64.b64encode(signing_key().sign(payload.encode())).decode()
            key_id = os.environ["SUPERII_POLICY_KEY_ID"]
            # This function is executable only by the publisher role and database owner.
            row = conn.execute(
                "select app.apply_publication_decision(%s,%s,%s) as id",
                (payload, signature, key_id),
            ).fetchone()
            decision = {
                "id": str(row["id"]),
                **result,
                "payload": payload,
                "signature": signature,
                "key_id": key_id,
            }
        return {
            "status": "published" if result["outcome"] == "passed" else "blocked",
            "decision": decision,
            "replayed": False,
        }
    except HTTPException:
        raise
    except (KeyError, ValueError, RuntimeError, psycopg.Error) as error:
        raise HTTPException(
            503, "independent publication policy unavailable; revision stays closed"
        ) from error


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8791, access_log=False)
