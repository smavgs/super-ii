from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import replace

import httpx
import pytest
from test_sdk import ORIGIN, document

from superii.client import Snapshot
from superii.errors import IntegrityError, SuperiiError
from superii.experiments import iter_tensor_bytes, tensor_ranges
from superii.manifest import Manifest
from superii.remote import RemoteModel


def tensor_snapshot(tmp_path, *, offsets=(0, 4)):
    header = json.dumps(
        {
            "layer.0.weight": {
                "dtype": "F32",
                "shape": [1],
                "data_offsets": offsets,
            }
        }
    ).encode()
    contents = struct.pack("<Q", len(header)) + header + struct.pack("<f", 1)
    (tmp_path / "model.safetensors").write_bytes(contents)
    manifest = Manifest.parse(document({"model.safetensors": contents}), ORIGIN)
    return Snapshot(tmp_path, manifest, ("model.safetensors",), 0)


def test_mmap_reads_only_verified_selected_layer_bytes(tmp_path):
    snapshot = tensor_snapshot(tmp_path)
    ranges = tensor_ranges(snapshot)
    assert ranges[0].shape == (1,)
    assert b"".join(
        data for _, data in iter_tensor_bytes(snapshot, prefix="layer.0", chunk_bytes=2)
    ) == struct.pack("<f", 1)
    assert list(iter_tensor_bytes(snapshot, prefix="expert.9")) == []
    (tmp_path / "model.safetensors").write_bytes(b"corrupted")
    with pytest.raises(IntegrityError):
        list(iter_tensor_bytes(snapshot))


def test_mmap_rejects_offset_outside_verified_object(tmp_path):
    with pytest.raises(IntegrityError):
        tensor_ranges(tensor_snapshot(tmp_path, offsets=(0, 8)))


def test_mmap_rejects_oversized_header_even_with_matching_hash(tmp_path):
    snapshot = tensor_snapshot(tmp_path)
    value = struct.pack("<Q", 16 * 1024**2 + 1)
    (tmp_path / "model.safetensors").write_bytes(value)
    file = replace(
        snapshot.manifest.files[0], size_bytes=len(value), sha256=hashlib.sha256(value).hexdigest()
    )
    snapshot = replace(snapshot, manifest=replace(snapshot.manifest, files=(file,)))
    with pytest.raises(IntegrityError):
        tensor_ranges(snapshot)


def test_remote_warmstart_is_explicit_and_uses_only_provider_credential(monkeypatch):
    requests = []
    monkeypatch.setenv("SUPERII_TOKEN", "canonical-origin-only")

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"text": "remote answer"}]})

    with RemoteModel(
        "https://provider.example",
        "chosen-model",
        token="provider-only",
        transport=httpx.MockTransport(handle),
    ) as remote:
        assert not requests
        assert remote.generate("explicit remote prompt") == "remote answer"
    assert requests[0].headers["authorization"] == "Bearer provider-only"
    assert json.loads(requests[0].content)["model"] == "chosen-model"


def test_remote_does_not_follow_redirect_or_silently_fallback():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "https://elsewhere.example"})

    with RemoteModel(
        "https://provider.example",
        "chosen-model",
        token="provider-only",
        transport=httpx.MockTransport(handle),
    ) as remote:
        with pytest.raises(SuperiiError):
            remote.generate("hello")
    assert len(requests) == 1
