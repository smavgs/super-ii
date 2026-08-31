from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from superii_runtime import bridge
from superii_runtime.bridge import BridgeError, BridgeWorker, decrypt_access_token, verify_snapshot
from superii_runtime.settings import Settings


def _encoded_key(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode().rstrip("=")


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_root=tmp_path / "store",
        database_url="postgresql://unused",
        runtime_token="r" * 32,
        bridge_token_encryption_key=_encoded_key(b"k" * 32),
    )


def _git_oid(payload: bytes) -> str:
    return hashlib.sha1(  # noqa: S324 - Git object compatibility, not security
        f"blob {len(payload)}\0".encode() + payload,
        usedforsecurity=False,
    ).hexdigest()


def test_bridge_token_decryption_matches_control_plane_contract(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    nonce = b"n" * 12
    token = "hf_" + uuid4().hex
    ciphertext = AESGCM(b"k" * 32).encrypt(nonce, token.encode(), bridge.BRIDGE_AAD)
    credential = {
        "access_token_ciphertext": _encoded_key(ciphertext),
        "access_token_nonce": _encoded_key(nonce),
        "token_expires_at": datetime.now(UTC) + timedelta(minutes=5),
    }

    assert decrypt_access_token(settings, credential) == token


def test_verify_snapshot_checks_git_and_lfs_objects(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    readme = b"# Safe card\n"
    weights = b"safe tensor bytes"
    (snapshot / "README.md").write_bytes(readme)
    (snapshot / "weights.safetensors").write_bytes(weights)
    expected = {
        "README.md": {
            "path": "README.md",
            "size_bytes": len(readme),
            "source_oid": _git_oid(readme),
            "source_sha256": None,
        },
        "weights.safetensors": {
            "path": "weights.safetensors",
            "size_bytes": len(weights),
            "source_oid": "0" * 40,
            "source_sha256": hashlib.sha256(weights).hexdigest(),
        },
    }

    verified = verify_snapshot(snapshot, expected)

    assert [entry["path"] for entry in verified] == ["README.md", "weights.safetensors"]
    assert verified[1]["imported_sha256"] == hashlib.sha256(weights).hexdigest()


def test_verify_snapshot_fails_closed_when_content_changes(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    (snapshot / "README.md").write_bytes(b"changed")
    expected = {
        "README.md": {
            "path": "README.md",
            "size_bytes": 7,
            "source_oid": "0" * 40,
            "source_sha256": None,
        }
    }

    with pytest.raises(BridgeError, match="checksum_mismatch"):
        verify_snapshot(snapshot, expected)


class FakeDatabase:
    def __init__(self) -> None:
        self.repository_id = uuid4()
        self.revision_id = uuid4()
        self.progress: list[int] = []
        self.completed: tuple[str, list[dict[str, object]]] | None = None
        self.state: tuple[str, int, str | None] | None = None

    def bridge_cancel_requested(self, _job_id):
        return False

    def prepare_bridge_item(self, _item_id):
        return self.repository_id, self.revision_id, False

    def update_bridge_item_progress(self, _item_id, progress):
        self.progress.append(progress)

    def complete_bridge_item(self, _item_id, card, manifest):
        self.completed = (card, manifest)
        return "review"

    def set_bridge_item_state(self, _item_id, state, progress, code=None, _detail=None):
        self.state = (state, progress, code)
        return state


def test_worker_imports_exact_snapshot_into_review_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"# Imported card\n"
    digest = hashlib.sha256(payload).hexdigest()
    item_id = uuid4()
    job_id = uuid4()
    item = {
        "id": item_id,
        "kind": "dataset",
        "provider_repo_id": "owner/repository",
        "source_revision": "a" * 40,
        "source_manifest": [
            {
                "path": "README.md",
                "size_bytes": len(payload),
                "source_oid": None,
                "source_sha256": digest,
            }
        ],
        "total_size_bytes": len(payload),
        "progress_bytes": 0,
    }
    database = FakeDatabase()
    uploaded: list[str] = []
    runtime_calls: list[tuple[str, object]] = []

    def fake_download(_item, _expected, _token, target):
        (target / "README.md").write_bytes(payload)
        return target

    def fake_upload(**kwargs):
        uploaded.append(kwargs["repository_path"])
        return {"status": "clean"}

    def fake_runtime(_settings, path, body=None):
        runtime_calls.append((path, body))
        return {"status": "passed"}

    monkeypatch.setattr(bridge, "_download_snapshot", fake_download)
    monkeypatch.setattr(bridge, "process_upload", fake_upload)
    monkeypatch.setattr(bridge, "_runtime_post", fake_runtime)
    worker = BridgeWorker(_settings(tmp_path), database=database)  # type: ignore[arg-type]

    worker.process_item(job_id, item, None)

    assert uploaded == ["README.md"]
    assert database.progress == [len(payload)]
    assert database.state is None
    assert database.completed is not None
    assert database.completed[0] == payload.decode()
    assert database.completed[1][0]["imported_sha256"] == digest
    assert runtime_calls == [
        (
            f"/v1/repositories/{database.repository_id}/revisions/{database.revision_id}/inspect",
            {"kind": "dataset"},
        ),
        (
            f"/v1/repositories/{database.repository_id}/revisions/{database.revision_id}/finalize",
            None,
        ),
    ]


def test_sync_preview_requires_public_complete_metadata(tmp_path: Path) -> None:
    worker = BridgeWorker(_settings(tmp_path), database=FakeDatabase())  # type: ignore[arg-type]
    info = SimpleNamespace(
        siblings=[SimpleNamespace(rfilename="README.md", size=5, lfs=None, blob_id="a" * 40)],
        card_data=SimpleNamespace(to_dict=lambda: {"license": "mit"}),
    )
    subscription = {
        "kind": "model",
        "source_url": "https://huggingface.co/owner/repository",
        "provider_repo_id": "owner/repository",
    }

    preview = worker._sync_preview(subscription, info, "b" * 40)

    assert preview["source_visibility"] == "public"
    assert preview["blocked_reason"] is None
    assert preview["license"] == "mit"
