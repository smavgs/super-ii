"""Disposable PostgreSQL + real policy service/signature/role integration check."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import subprocess
import time
from pathlib import Path

import psycopg
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    name = "superii-policy-check-" + secrets.token_hex(4)
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD=local-test-only",
            "-e",
            "POSTGRES_DB=policy_test",
            "-p",
            "127.0.0.1::5432",
            "postgres:17-alpine",
        ],
        check=True,
        capture_output=True,
    )
    try:
        port = (
            subprocess.run(
                ["docker", "port", name, "5432"],
                check=True,
                capture_output=True,
                text=True,
            )
            .stdout.strip()
            .split(":")[-1]
        )
        owner_url = (
            f"postgresql://postgres:local-test-only@127.0.0.1:{port}/policy_test"
        )
        for attempt in range(30):
            try:
                with psycopg.connect(owner_url):
                    break
            except psycopg.OperationalError:
                time.sleep(0.2)
        else:
            raise RuntimeError("Disposable PostgreSQL failed to start")
        with psycopg.connect(owner_url, autocommit=True) as conn:
            for path in sorted((ROOT / "database/migrations").glob("*.sql")):
                conn.execute(path.read_text())
            conn.execute(
                "create role policy_test_login login password 'policy-local-only'"
            )
            conn.execute("grant superii_policy to policy_test_login")
        os.environ["SUPERII_DATABASE_URL"] = (
            f"postgresql://policy_test_login:policy-local-only@127.0.0.1:{port}/policy_test"
        )
        os.environ["SUPERII_POLICY_TOKEN"] = secrets.token_urlsafe(32)
        key = Ed25519PrivateKey.generate()
        os.environ["SUPERII_POLICY_SIGNING_KEY"] = base64.b64encode(
            key.private_bytes_raw()
        ).decode()
        os.environ["SUPERII_POLICY_KEY_ID"] = "integration-test-only"
        from superii_runtime.publication_policy import POLICY_SHA256
        from superii_runtime.policy_service import app
        from superii_runtime.settings import get_settings

        get_settings.cache_clear()
        with psycopg.connect(owner_url) as conn:
            conn.execute(
                "insert into app.publication_keys(id,public_key,policy_sha256) values (%s,%s,%s)",
                (
                    "integration-test-only",
                    base64.b64encode(key.public_key().public_bytes_raw()).decode(),
                    POLICY_SHA256,
                ),
            )
            profile = conn.execute(
                "select app.ensure_profile('policy-test','policy-test','Policy Test',null)"
            ).fetchone()[0]
            cases = []
            for slug, license_id, failed in [
                ("pass", "apache-2.0", False),
                ("unknown-license", "unknown", False),
                ("latest-failure", "apache-2.0", True),
            ]:
                result = conn.execute(
                    "select * from app.create_repository_with_revision(%s,null,'dataset',%s,%s,%s,%s,null,null,null,'',%s)",
                    (
                        profile,
                        slug,
                        slug,
                        "Disposable integration test data",
                        license_id,
                        Jsonb(
                            {
                                "rights_declaration": {
                                    "confirmed": True,
                                    "basis": "original",
                                }
                            }
                        ),
                    ),
                ).fetchone()
                repo, revision = result[0], result[1]
                conn.execute(
                    "update app.repositories set visibility='private' where id=%s",
                    (repo,),
                )
                digest = hashlib.sha256(b"x\n1\n").hexdigest()
                file = conn.execute(
                    """insert into app.repository_files(repository_id,revision_id,path,
                    size_bytes,mime_type,sha256,storage_key,storage_state,scan_status,created_by)
                    values (%s,%s,'data.csv',4,'text/csv',%s,%s,'available','clean','test') returning id""",
                    (repo, revision, digest, f"objects/sha256/{digest[:2]}/{digest}"),
                ).fetchone()[0]
                for scanner in ["clamav", "gitleaks", "format_policy"]:
                    conn.execute(
                        """insert into app.repository_file_inspections(repository_file_id,
                        inspector,status,tool_version,completed_at) values (%s,%s,'passed','fixture-1',now())""",
                        (file, scanner),
                    )
                if failed:
                    conn.execute(
                        """insert into app.repository_file_inspections(repository_file_id,
                        inspector,status,tool_version,started_at,completed_at)
                        values (%s,'clamav','failed','fixture-2',now()+interval '1 second',now())""",
                        (file,),
                    )
                conn.execute(
                    """insert into app.repository_revision_analyses(repository_id,revision_id,
                    analysis_type,status,result,tool_versions,completed_at)
                    values (%s,%s,'dataset','passed','{}','{"fixture":"1"}',now())""",
                    (repo, revision),
                )
                manifest = hashlib.sha256(
                    f"data.csv\0{digest}\0{4}\n".encode()
                ).hexdigest()
                conn.execute(
                    """update app.repository_revisions set status='review',manifest_sha256=%s,
                    commit_sha=%s,file_count=1,total_size_bytes=4,manifest=%s where id=%s""",
                    (
                        manifest,
                        "c" * 64,
                        Jsonb(
                            [{"path": "data.csv", "sha256": digest, "size_bytes": 4}]
                        ),
                        revision,
                    ),
                )
                cases.append((slug, repo, revision))
        client = TestClient(app)
        assert client.get("/ready").status_code == 401
        headers = {"x-superii-policy-token": os.environ["SUPERII_POLICY_TOKEN"]}
        assert client.get("/ready", headers=headers).status_code == 200
        for slug, repo, revision in cases:
            path = f"/v1/repositories/{repo}/revisions/{revision}/publish"
            response = client.post(path, headers=headers, json={"outcome": "passed"})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["status"] == ("published" if slug == "pass" else "blocked"), (
                result
            )
            proof = result["decision"]
            key.public_key().verify(
                base64.b64decode(proof["signature"]), proof["payload"].encode()
            )
            if slug == "pass":
                assert client.post(path, headers=headers).json()["replayed"] is True
        with psycopg.connect(owner_url) as conn:
            assert (
                conn.execute(
                    "select count(*) from app.publication_decisions"
                ).fetchone()[0]
                == 3
            )
            assert (
                conn.execute(
                    "select count(*) from app.repositories where visibility='public'"
                ).fetchone()[0]
                == 0
            )
            assert (
                conn.execute(
                    "select count(*) from app.repository_revisions where status='published'"
                ).fetchone()[0]
                == 1
            )
        with psycopg.connect(os.environ["SUPERII_DATABASE_URL"]) as conn:
            try:
                conn.execute("update app.publication_keys set enabled=false")
            except psycopg.errors.InsufficientPrivilege:
                conn.rollback()
            else:
                raise AssertionError("policy service may not alter its trust policy")
        print(
            json.dumps(
                {
                    "passed": True,
                    "checks": [
                        "independent credential",
                        "restricted DB role",
                        "real Ed25519 signatures",
                        "private visibility preserved",
                        "atomic publication",
                        "unknown license blocked",
                        "latest scanner failure blocks",
                        "request cannot override policy",
                        "idempotent retry",
                    ],
                    "environment": "disposable PostgreSQL; scanner evidence is a fixture",
                },
                indent=2,
            )
        )
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)


if __name__ == "__main__":
    main()
