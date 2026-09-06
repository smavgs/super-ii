from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import replace

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from superii import Client, Hardware, IntegrityError, Peer, PlanError
from superii.attestation import verify_attestation
from superii.manifest import Manifest, safe_path
from superii.planner import plan
from superii.serving import create_app, create_cache_app

ORIGIN = "https://superii.test"


def document(files: dict[str, bytes], visibility="public"):
    entries = [
        {
            "path": path,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "download_url": ORIGIN + "/files/" + path,
        }
        for path, data in files.items()
    ]
    checksum = hashlib.sha256(
        b"".join(
            f"{f['path']}\0{f['sha256']}\0{f['size_bytes']}\n".encode()
            for f in sorted(entries, key=lambda f: f["path"])
        )
    ).hexdigest()
    return {
        "repository": {"id": "repo", "owner": "owner", "slug": "model", "visibility": visibility},
        "revision": {
            "id": "revision",
            "commit_sha": "c" * 64,
            "manifest_sha256": checksum,
            "total_size_bytes": sum(len(data) for data in files.values()),
        },
        "files": entries,
        "compatibility": {},
    }


def server(
    files: dict[str, bytes],
    *,
    visibility="public",
    ignored_range=False,
    corrupt=False,
    requests=None,
):
    doc = document(files, visibility)

    def handle(request: httpx.Request):
        if requests is not None:
            requests.append(request)
        if request.url.path.startswith("/api/sdk/models/"):
            return httpx.Response(200, json=doc)
        path = request.url.path.removeprefix("/files/")
        data = files[path]
        if corrupt:
            data = b"x" * len(data)
        start, end = map(int, request.headers["range"].removeprefix("bytes=").split("-"))
        if ignored_range:
            return httpx.Response(200, content=data)
        return httpx.Response(
            206,
            content=data[start : end + 1],
            headers={"content-range": f"bytes {start}-{end}/{len(data)}"},
        )

    return httpx.MockTransport(handle)


@pytest.mark.parametrize(
    "path",
    [
        "../escape",
        "/absolute",
        "a//b",
        "a/./b",
        "a\\b",
        "nul.txt",
        "a\0b",
        "a\nb",
        "folder/file.",
        "C:/file",
    ],
)
def test_paths_fail_closed(path):
    with pytest.raises(IntegrityError):
        safe_path(path)


def test_manifest_rejects_substitution_and_cross_origin():
    doc = document({"model.gguf": b"verified"})
    with pytest.raises(IntegrityError):
        Manifest.parse(doc, ORIGIN, revision="f" * 64)
    doc["files"][0]["download_url"] = "https://attacker.test/stolen"
    with pytest.raises(IntegrityError):
        Manifest.parse(doc, ORIGIN)


def test_pull_verifies_and_reuses_bytes_but_rechecks_access(tmp_path):
    requests = []
    files = {"model.gguf": b"weights", "tokenizer.json": b"{}", "empty.txt": b""}
    with Client(
        ORIGIN,
        cache_dir=tmp_path,
        require_attestation=False,
        transport=server(files, requests=requests),
    ) as client:
        first = client.pull("owner/model")
        second = client.pull("owner/model", revision=first.manifest.revision)
        assert first.transferred_bytes == 9 and second.transferred_bytes == 0
        assert second.verify()
        assert sum(r.url.path.startswith("/api/sdk/") for r in requests) == 2
        local = second.path / "model.gguf"
        local.chmod(0o600)
        local.write_bytes(b"tampered")
        with pytest.raises(IntegrityError):
            second.verify()
        repaired = client.pull("owner/model")
        assert repaired.verify() and repaired.transferred_bytes == 0


def test_resume_and_parallel_range(tmp_path, monkeypatch):
    import superii.client as module

    monkeypatch.setattr(module, "CHUNK", 4)
    files = {"model.gguf": b"abcdefghijkl"}
    requests = []
    with Client(
        ORIGIN,
        cache_dir=tmp_path,
        require_attestation=False,
        transport=server(files, requests=requests),
    ) as client:
        checksum = hashlib.sha256(files["model.gguf"]).hexdigest()
        chunks = client.cache / "chunks" / checksum
        chunks.mkdir(parents=True)
        (chunks / "0").write_bytes(b"ab")
        snapshot = client.pull("owner/model")
        assert snapshot.transferred_bytes == 10
        assert {r.headers.get("range") for r in requests if "range" in r.headers} == {
            "bytes=2-3",
            "bytes=4-7",
            "bytes=8-11",
        }


@pytest.mark.parametrize("ignored,corrupt", [(True, False), (False, True)])
def test_invalid_download_is_never_promoted(tmp_path, monkeypatch, ignored, corrupt):
    import superii.client as module

    monkeypatch.setattr(module, "CHUNK", 4)
    with Client(
        ORIGIN,
        cache_dir=tmp_path,
        require_attestation=False,
        transport=server({"model.gguf": b"abcdefgh"}, ignored_range=ignored, corrupt=corrupt),
    ) as client:
        with pytest.raises(IntegrityError):
            client.pull("owner/model")
        assert not [p for p in (client.cache / "objects").iterdir() if p.suffix != ".lock"]


def test_private_never_queries_peer(tmp_path):
    requests = []
    with Client(
        ORIGIN,
        token="private-token",
        cache_dir=tmp_path,
        require_attestation=False,
        peers=(Peer("https://peer.test", "p" * 32),),
        transport=server({"model.gguf": b"weights"}, visibility="private", requests=requests),
    ) as client:
        client.pull("owner/model")
    assert {r.url.host for r in requests} == {"superii.test"}
    assert all(r.headers["authorization"] == "Bearer private-token" for r in requests)


def test_peer_corruption_falls_back_without_leaking_repository_token(tmp_path):
    requests = []
    canonical = server({"model.gguf": b"weights"}, requests=requests)

    def handle(request):
        if request.url.host == "peer.test":
            assert request.headers["authorization"] == "Bearer " + "p" * 32
            return httpx.Response(200, content=b"corrupt")
        return canonical.handle_request(request)

    with Client(
        ORIGIN,
        token="repository-secret",
        cache_dir=tmp_path,
        require_attestation=False,
        peers=(Peer("https://peer.test", "p" * 32),),
        transport=httpx.MockTransport(handle),
    ) as client:
        assert client.pull("owner/model").verify()


def test_redirect_does_not_forward_token(tmp_path):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "https://attacker.test/"})

    with Client(
        ORIGIN, token="secret", cache_dir=tmp_path, transport=httpx.MockTransport(handle)
    ) as client:
        with pytest.raises(IntegrityError):
            client.inspect("owner/model")
    assert len(requests) == 1


def test_attestation_requires_trusted_signature_for_exact_manifest():
    manifest = Manifest.parse(document({"model.gguf": b"weights"}), ORIGIN)
    key = Ed25519PrivateKey.generate()
    payload = json.dumps(
        {
            "outcome": "passed",
            "policy_version": "superii-auto-publish-v1",
            "repository_id": manifest.repository_id,
            "revision_id": manifest.revision_id,
            "commit_sha": manifest.revision,
            "manifest_sha256": manifest.manifest_sha256,
        }
    )
    proof = {
        "key_id": "test",
        "payload": payload,
        "signature": base64.b64encode(key.sign(payload.encode())).decode(),
    }
    signed = replace(manifest, publication=proof)
    trusted = {"test": base64.b64encode(key.public_key().public_bytes_raw()).decode()}
    assert verify_attestation(signed, trusted)
    with pytest.raises(IntegrityError):
        verify_attestation(signed, {})
    with pytest.raises(IntegrityError):
        verify_attestation(replace(signed, manifest_sha256="a" * 64), trusted)
    with pytest.raises(IntegrityError):
        verify_attestation(replace(signed, revision="b" * 64), trusted)
    with pytest.raises(IntegrityError):
        verify_attestation(replace(signed, revision_id="other"), trusted)


def test_plan_prevents_predictable_oom_and_chooses_existing_variant():
    manifest = Manifest.parse(document({"small.gguf": b"a", "large.gguf": b"ab"}), ORIGIN)
    machine = Hardware(
        "linux", "x86_64", "cpu", 16 * 1024**3, 12 * 1024**3, runtimes=("llama.cpp",)
    )
    chosen = plan(manifest, machine)
    assert chosen.primary_file == "large.gguf" and chosen.gpu_layers == 0
    with pytest.raises(PlanError):
        plan(manifest, replace(machine, available_ram_bytes=1024))
    with pytest.raises(PlanError):
        plan(manifest, replace(machine, runtimes=()))


class FakeModel:
    plan = type("Plan", (), {"repository": "owner/model", "revision": "c" * 64})()

    def generate(self, prompt, **kwargs):
        return prompt.upper()


def test_serving_auth_origin_host_and_body_limits():
    app = create_app(FakeModel(), token="t" * 32)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.get("/v1/models").status_code == 401
        headers = {"authorization": "Bearer " + "t" * 32}
        assert client.get("/v1/models", headers=headers).status_code == 200
        assert (
            client.get("/v1/models", headers={**headers, "origin": "https://evil.test"}).status_code
            == 403
        )
        assert client.get("/v1/models", headers={**headers, "host": "evil.test"}).status_code == 400
        response = client.post(
            "/v1/completions", headers=headers, json={"model": "owner/model", "prompt": "hello"}
        )
        assert response.status_code == 200 and response.json()["choices"][0]["text"] == "HELLO"
        assert (
            client.post(
                "/v1/completions", headers=headers, content=b"x" * (1024**2 + 1)
            ).status_code
            == 413
        )


def test_peer_server_rechecks_visibility(tmp_path):
    with Client(
        ORIGIN,
        cache_dir=tmp_path,
        require_attestation=False,
        transport=server({"model.gguf": b"weights"}, visibility="private"),
    ) as canonical:
        snapshot = canonical.pull("owner/model")
        app = create_cache_app(canonical, token="p" * 32)
        with TestClient(app) as peer:
            url = (
                f"/v1/cache/owner/model/{snapshot.manifest.revision}/"
                f"{snapshot.manifest.files[0].sha256}"
            )
            assert peer.get(url).status_code == 401
            assert peer.get(url, headers={"authorization": "Bearer " + "p" * 32}).status_code == 404
