import asyncio
import hashlib
import io
import json
import tarfile
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import superii_runtime.api as api
from superii_runtime.database import RevisionFile
from superii_runtime.packages import (
    CHUNK_SIZE,
    make_package,
    package_bytes,
    package_range,
    stream_package,
)
from superii_runtime.settings import Settings, get_settings
from superii_runtime.storage import ObjectStore


@pytest.fixture
def release(tmp_path):
    store = ObjectStore(tmp_path, 20 * 1024**3)
    repo, revision = uuid4(), uuid4()
    payloads = {
        "weights/model.gguf": b"GGUF fixture",
        "数据/" + "长" * 55 + ".csv": "名称,值\n测试,42\n".encode(),
        "empty": b"",
        "SUPERII-RELEASE.json": b"original",
    }
    files = []
    for path, content in payloads.items():
        sha = hashlib.sha256(content).hexdigest()
        key = f"objects/sha256/{sha}"
        store.resolve_key(key).write_bytes(content)
        files.append(
            RevisionFile(
                uuid4(), repo, revision, path, len(content), "application/octet-stream", sha, key
            )
        )
    metadata = {
        "owner_handle": "fixture",
        "slug": "model",
        "kind": "model",
        "commit_sha": "a" * 64,
        "manifest_sha256": "b" * 64,
        "file_count": len(files),
        "total_size_bytes": sum(f.size_bytes for f in files),
    }
    return store, files, metadata, payloads


def test_archive_round_trip_and_ranges(release):
    store, files, metadata, payloads = release
    plan = make_package(files, metadata, store)
    whole = b"".join(package_bytes(plan, (0, plan.size - 1)))
    assert len(whole) == plan.size
    with tarfile.open(fileobj=io.BytesIO(whole)) as archive:
        assert archive.getnames() == sorted(payloads) + ["_SUPERII-RELEASE.json"]
        for path, expected in payloads.items():
            assert archive.extractfile(path).read() == expected
            assert archive.getmember(path).mode == 0o644
        manifest = json.load(archive.extractfile("_SUPERII-RELEASE.json"))
        assert manifest["repository"] == "fixture/model"
        assert manifest["revision"] == metadata["commit_sha"]
        assert len(manifest["files"]) == len(files)
    for header in [
        None,
        "bytes=0-511",
        "bytes=510-550",
        "bytes=1000-4000",
        "bytes=1024-",
        "bytes=-100",
        "bytes=-99999999",
    ]:
        bounds = package_range(header, plan.size)
        assert b"".join(package_bytes(plan, bounds)) == whole[bounds[0] : bounds[1] + 1]
    assert make_package(list(reversed(files)), metadata, store) == plan
    assert make_package(files, {**metadata, "slug": "renamed"}, store).etag != plan.etag


@pytest.mark.parametrize(
    "header",
    [
        "bytes=-0",
        "bytes=1-0",
        "bytes=999999999-",
        "bytes=0-1,3-4",
        "foo=0-1",
        "bytes=",
        "bytes=" + "9" * 5000 + "-",
    ],
)
def test_bad_ranges(header):
    assert package_range(header, 2048) is None


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "../escape",
        "safe/../x",
        "safe//x",
        "a/./b",
        "C:drive",
        "a\\b",
        "a\x00b",
        " trimmed ",
    ],
)
def test_unsafe_paths(release, path):
    store, files, metadata, _ = release
    with pytest.raises(ValueError):
        make_package([replace(files[0], path=path), *files[1:]], metadata, store)


def test_incomplete_or_conflicting_package(release):
    store, files, metadata, _ = release
    for invalid in [
        files[:-1],
        [files[0], *files[:-1]],
        [replace(files[0], path="empty/nested"), *files[1:]],
    ]:
        with pytest.raises(ValueError):
            make_package(invalid, metadata, store)
    store.resolve_key(files[0].storage_key).unlink()
    with pytest.raises(ValueError):
        make_package(files, metadata, store)


def test_corruption_fails_stream_and_header_only_skips_content(release):
    store, files, metadata, _ = release
    plan = make_package(files, metadata, store)
    store.resolve_key(files[0].storage_key).write_bytes(b"bad" * 4)
    assert len(b"".join(package_bytes(plan, (0, 511)))) == 512
    with pytest.raises(ValueError, match="integrity"):
        b"".join(package_bytes(plan, (0, plan.size - 1)))


def test_large_file_plan_and_5000_files_without_reading_bytes(release):
    store, files, metadata, _ = release
    huge = store.resolve_key("objects/sha256/sparse")
    with huge.open("wb") as output:
        output.truncate(10 * 1024**3)
    file = replace(files[0], storage_key="objects/sha256/sparse", size_bytes=huge.stat().st_size)
    plan = make_package(
        [file], {**metadata, "file_count": 1, "total_size_bytes": file.size_bytes}, store
    )
    assert plan.size > 10 * 1024**3
    assert sum(len(p.data or b"") for p in plan.parts) < 8192
    many = [replace(files[0], path=f"shard/{i}.gguf") for i in range(5000)]
    assert (
        make_package(
            many,
            {**metadata, "file_count": 5000, "total_size_bytes": 5000 * files[0].size_bytes},
            store,
        ).size
        > 5000 * 512
    )
    with pytest.raises(ValueError, match="count"):
        make_package(many + [files[0]], metadata, store)


def test_stream_closes_source_on_disconnect(release, monkeypatch):
    store, files, metadata, _ = release
    payload = b"x" * (CHUNK_SIZE * 2)
    path = store.resolve_key(files[0].storage_key)
    path.write_bytes(payload)
    file = replace(files[0], size_bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    plan = make_package(
        [file], {**metadata, "file_count": 1, "total_size_bytes": len(payload)}, store
    )
    opened = []
    original = type(path).open

    def tracked(self, *args, **kwargs):
        source = original(self, *args, **kwargs)
        opened.append(source)
        return source

    monkeypatch.setattr(type(path), "open", tracked)

    async def interrupted():
        chunks = stream_package(plan, (0, plan.size - 1))
        assert len(await anext(chunks)) == 512
        assert len(await anext(chunks)) == CHUNK_SIZE
        await chunks.aclose()

    asyncio.run(interrupted())
    assert opened and all(source.closed for source in opened)


def test_runtime_auth_published_release_head_and_resume(release, monkeypatch):
    store, files, metadata, _ = release

    class Database:
        available = True
        downloads = []

        def record_package_download(self, repo, rev, size, user_agent):
            self.downloads.append((repo, rev, size))

        def get_package_release(self, repo, rev, commit):
            assert (repo, rev, commit) == (
                files[0].repository_id,
                files[0].revision_id,
                metadata["commit_sha"],
            )
            return metadata if self.available else None

        def list_revision_files(self, _revision):
            return files

    database = Database()
    token = str(uuid4()) + str(uuid4())
    app = api.app
    app.dependency_overrides[api.get_database] = lambda: database
    app.dependency_overrides[get_settings] = lambda: Settings(runtime_token=token)
    monkeypatch.setattr(api, "get_store", lambda: store)
    path = (
        f"/v1/repositories/{files[0].repository_id}/revisions/{files[0].revision_id}"
        f"/download?commit={metadata['commit_sha']}"
    )
    try:
        client = TestClient(app)
        assert client.get(path).status_code == 401
        headers = {"x-superii-runtime-token": token}
        head = client.head(path, headers=headers)
        assert head.status_code == 200 and head.content == b""
        assert database.downloads == []
        full = client.get(path, headers=headers)
        assert len(full.content) == int(head.headers["content-length"])
        assert len(database.downloads) == 1
        assert database.downloads[0][2] == len(full.content)
        partial = client.get(
            path, headers={**headers, "range": "bytes=510-530", "if-range": head.headers["etag"]}
        )
        assert partial.status_code == 206 and partial.content == full.content[510:531]
        assert client.get(path, headers={**headers, "range": "bytes=999999999-"}).status_code == 416
        assert (
            client.get(path, headers={**headers, "range": "bytes=0-1", "if-range": '"old"'}).content
            == full.content
        )
        database.available = False
        assert client.get(path, headers=headers).status_code == 404
        database.available = True
        store.resolve_key(files[0].storage_key).unlink()
        assert client.head(path, headers=headers).status_code == 503
    finally:
        app.dependency_overrides.clear()
