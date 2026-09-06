from __future__ import annotations

import base64
import json
from collections.abc import Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .errors import IntegrityError
from .manifest import Manifest


def verify_attestation(manifest: Manifest, trusted_keys: Mapping[str, str]) -> bool:
    proof = manifest.publication
    if not proof:
        raise IntegrityError("This release has no automatic publication attestation")
    try:
        key = trusted_keys[proof["key_id"]]
        payload = proof["payload"]
        Ed25519PublicKey.from_public_bytes(base64.b64decode(key, validate=True)).verify(
            base64.b64decode(proof["signature"], validate=True),
            payload.encode(),
        )
        data = json.loads(payload)
        if (
            data["manifest_sha256"] != manifest.manifest_sha256
            or data["repository_id"] != manifest.repository_id
            or data["revision_id"] != manifest.revision_id
            or data["commit_sha"] != manifest.revision
            or data["outcome"] != "passed"
            or data["policy_version"] != "superii-auto-publish-v1"
        ):
            raise IntegrityError("Publication attestation does not approve this manifest")
    except (KeyError, TypeError, ValueError, InvalidSignature) as error:
        raise IntegrityError(
            "Publication signature is missing, invalid or signed by an untrusted key"
        ) from error
    return True
