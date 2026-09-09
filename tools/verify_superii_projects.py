"""Exercise generated projects against private synthetic, policy-published inputs."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import secrets
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpx
from superii import Client
from superii.recipes import Recipe
from superii.recipes.exports import export_project
from superii.recipes.publication import publish

ORIGIN = "https://superii.site"
SCOPES = [
    "repository:read",
    "repository:upload",
    "repository:commit",
    "repository:submit",
]
ROOT = Path("private-project-verification").resolve()


def checked(response):
    if not response.is_success:
        detail = ""
        if response.headers.get("content-type", "").startswith("application/json"):
            error = response.json().get("error")
            if error in {
                "no matching trusted publisher",
                "requested scope is not allowed for this publisher",
                "GitHub repository claim does not match the trusted subject",
                "GitHub OIDC signature or claims are invalid",
                "GitHub OIDC token lifetime is outside the accepted window",
                "scoped access token could not be issued",
                "trusted publishing service unavailable",
            }:
                detail = f": {error}"
        raise RuntimeError(
            f"{response.request.method} {response.request.url.path}: HTTP {response.status_code}{detail}"
        )
    return response


def exchange(http, repository_id, scopes):
    url = urlsplit(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"])
    if url.scheme != "https" or not url.hostname.endswith(
        ".actions.githubusercontent.com"
    ):
        raise ValueError("Expected the GitHub Actions OIDC endpoint")
    query = dict(parse_qsl(url.query))
    query["audience"] = ORIGIN
    jwt = checked(
        http.get(
            urlunsplit(url._replace(query=urlencode(query))),
            headers={
                "authorization": "Bearer "
                + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
            },
        )
    ).json()["value"]
    return checked(
        http.post(
            ORIGIN + "/api/trusted-publishing/github/exchange",
            headers={"authorization": "Bearer " + jwt},
            json={"repository_id": repository_id, "scopes": scopes},
        )
    ).json()["access_token"]


def fixture_files():
    import torch
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import (
        BertConfig,
        BertModel,
        GPT2Config,
        GPT2LMHeadModel,
        PreTrainedTokenizerFast,
    )

    torch.set_num_threads(2)
    torch.manual_seed(42)
    words = [
        "[PAD]",
        "[UNK]",
        "[EOS]",
        "red",
        "blue",
        "green",
        "apple",
        "sky",
        "water",
        "answer",
        "question",
        "is",
        "the",
        "a",
        "color",
        "fruit",
        ".",
        *map(str, range(20)),
    ]
    raw = Tokenizer(
        models.WordLevel({w: i for i, w in enumerate(words)}, unk_token="[UNK]")
    )
    raw.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=raw,
        pad_token="[PAD]",
        unk_token="[UNK]",
        eos_token="[EOS]",
        model_max_length=512,
    )
    paths = {
        role: ROOT / "sources" / role for role in ("generator", "embedding", "dataset")
    }
    for directory in paths.values():
        directory.mkdir(parents=True, exist_ok=True)
    for role in ("generator", "embedding"):
        tokenizer.save_pretrained(paths[role])
    GPT2LMHeadModel(
        GPT2Config(
            vocab_size=len(words),
            n_embd=16,
            n_layer=1,
            n_head=2,
            n_positions=512,
            eos_token_id=2,
            pad_token_id=0,
        )
    ).save_pretrained(paths["generator"])
    BertModel(
        BertConfig(
            vocab_size=len(words),
            hidden_size=16,
            num_hidden_layers=1,
            num_attention_heads=2,
            intermediate_size=32,
            max_position_embeddings=512,
        )
    ).save_pretrained(paths["embedding"])
    (paths["dataset"] / "data.jsonl").write_text(
        "".join(
            json.dumps(
                {
                    "id": f"fixture-{i}",
                    "text": f"the apple is red . the sky is blue . question {i} .",
                }
            )
            + "\n"
            for i in range(20)
        )
    )
    return paths


def prepare(http, target, directory):
    token = exchange(http, target["id"], SCOPES)
    headers = {"authorization": "Bearer " + token}
    route = ORIGIN + "/api/repositories/" + target["id"]
    state = checked(http.get(route + "/recipe", headers=headers)).json()
    if state["status"] != "published":
        assert state["status"] in ("draft", "quarantined")
        existing = {f["path"]: f for f in state["files"]}
        for item in sorted(directory.iterdir()):
            content = item.read_bytes()
            if item.name in existing:
                assert (
                    existing[item.name]["sha256"] == hashlib.sha256(content).hexdigest()
                ), "Existing fixture file differs"
                continue
            checked(
                http.post(
                    route + "/files",
                    headers={**headers, "origin": ORIGIN},
                    data={"path": item.name},
                    files={"file": (item.name, content, "application/octet-stream")},
                )
            )
        checked(
            http.post(
                route + "/publication-metadata",
                headers=headers,
                json={"license": "mit", "basis": "original", "confirmed": True},
            )
        )
        result = checked(http.post(route + "/submit", headers=headers, json={})).json()
        assert result["status"] == "published", (
            "Independent publication policy did not publish the fixture"
        )
    token = exchange(http, target["id"], ["repository:read"])
    with Client(token=token) as client:
        snapshot = client.pull(target["repository"], kind=target["kind"])
        assert snapshot.verify() and snapshot.manifest.visibility == "private"
        ref = {
            "repository": target["repository"],
            "revision": snapshot.manifest.revision,
        }
    collection = "datasets" if target["kind"] == "dataset" else "models"
    assert (
        http.get(
            ORIGIN + "/api/sdk/" + collection + "/" + target["repository"]
        ).status_code
        == 404
    )
    return token, ref


def command(directory, *arguments):
    result = subprocess.run(
        ["uv", "run", "--frozen", *arguments],
        cwd=directory,
        text=True,
        capture_output=True,
        check=False,
        timeout=300,
    )
    if result.returncode:
        # Inputs are synthetic. Credentials are never command arguments or printed.
        print(result.stdout[-3000:])
        print(result.stderr[-3000:])
        raise RuntimeError("Generated project command failed: " + " ".join(arguments))
    return result.stdout


def refresh_inputs(http, targets):
    for role in ("generator", "embedding", "dataset"):
        os.environ[f"SUPERII_{role.upper()}_TOKEN"] = exchange(
            http, targets[role]["id"], ["repository:read"]
        )


def verify_container(project, http, targets):
    image = f"superii-project-verification:{project.name}"
    build = subprocess.run(
        ["docker", "build", "--quiet", "-t", image, "."],
        cwd=project,
        capture_output=True,
        check=False,
        text=True,
        timeout=600,
    )
    if build.returncode:
        print(build.stderr[-3000:])
        raise RuntimeError("Generated Docker image did not build")
    refresh_inputs(http, targets)
    arguments = ["docker", "run", "--detach", "--rm", "-p", "127.0.0.1::8000"]
    for name in (
        "SUPERII_APP_TOKEN",
        "SUPERII_GENERATOR_TOKEN",
        "SUPERII_EMBEDDING_TOKEN",
        "SUPERII_DATASET_TOKEN",
    ):
        arguments.extend(["-e", name])
    container = subprocess.check_output(
        [*arguments, image], text=True, timeout=30
    ).strip()
    try:
        binding = subprocess.check_output(
            ["docker", "port", container, "8000/tcp"], text=True, timeout=30
        ).strip()
        assert binding.startswith("127.0.0.1:") and binding.count(":") == 1
        base = "http://" + binding
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                if http.get(base + "/health", timeout=3).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Generated container did not become healthy")
        assert http.get(base + "/ready").status_code == 401
        headers = {"authorization": "Bearer " + os.environ["SUPERII_APP_TOKEN"]}
        assert http.get(base + "/ready", headers=headers).status_code == 200
        assert (
            http.post(
                base + "/v1/predict",
                headers=headers,
                json={"text": "the apple is red ."},
            ).status_code
            == 200
        )
        assert (
            subprocess.check_output(
                ["docker", "exec", container, "id", "-u"], text=True, timeout=30
            ).strip()
            == "10001"
        )
        return {
            "private_model_loaded": True,
            "authenticated_prediction": True,
            "uid": 10001,
            "host_binding": "127.0.0.1",
        }
    finally:
        subprocess.run(
            ["docker", "rm", "--force", container],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=30,
        )


def main():
    targets = json.loads(os.environ["SUPERII_PROJECT_FIXTURES"])
    for role in ("generator", "embedding", "dataset", "adapter"):
        target = targets[role]
        target["id"] = str(UUID(target["id"]))
        assert target["repository"] == f"smavgs/build-ship-{role}-verification"
        assert target["kind"] == ("dataset" if role == "dataset" else "model")
    ROOT.mkdir(mode=0o700, exist_ok=False)
    files = fixture_files()
    refs = {}
    with httpx.Client(trust_env=False, follow_redirects=False, timeout=180) as http:
        for role in ("generator", "embedding", "dataset"):
            token, refs[role] = prepare(http, targets[role], files[role])
            os.environ[f"SUPERII_{role.upper()}_TOKEN"] = token
        refresh_inputs(http, targets)
        # A read credential from a different repository cannot manage the adapter.
        denied = http.get(
            ORIGIN + "/api/repositories/" + targets["adapter"]["id"] + "/recipe",
            headers={
                "authorization": "Bearer " + os.environ["SUPERII_GENERATOR_TOKEN"]
            },
        )
        assert denied.status_code == 403
        records = {}
        for outcome in ("api", "rag", "sft"):
            print(f"Verifying generated {outcome} project", flush=True)
            refresh_inputs(http, targets)
            project = ROOT / outcome
            request = {
                "outcome": outcome,
                "generator": refs["generator"],
                "runtime": "transformers",
                "configuration": {
                    "context_size": 512,
                    "max_tokens": 4,
                    "embedding_max_tokens": 128,
                    "chunk_size": 64,
                    "chunk_overlap": 8,
                    "min_score": -1,
                    "sequence_length": 64,
                    "max_steps": 1,
                    "lora_rank": 2,
                    "gradient_accumulation_steps": 1,
                },
            }
            if outcome == "rag":
                request["embedding"] = refs["embedding"]
            if outcome in ("rag", "sft"):
                request["dataset"] = refs["dataset"]
            with Client() as client:
                export_project(request, destination=project, client=client)
            assert Recipe.read(project / "superii-recipe.json").document[
                "dependencies"
            ]["superii-sdk"] == importlib.metadata.version("superii-sdk"), (
                "Live exports must use the same published SDK as the verification environment"
            )
            assert (project / "uv.lock").is_file(), (
                "A generated project must include the resolved lock"
            )
            sync = ["uv", "sync", "--frozen"] + (
                ["--extra", "train"] if outcome == "sft" else []
            )
            subprocess.run(
                sync, cwd=project, check=True, timeout=300, stdout=subprocess.DEVNULL
            )
            command(project, "pytest", "-q")
            if outcome == "rag":
                command(project, "python", "ingest.py")
                (project / "cases.jsonl").write_text(
                    json.dumps(
                        {
                            "question": "the apple is red .",
                            "relevant_document_ids": ["fixture-0"],
                        }
                    )
                    + "\n"
                )
                command(project, "python", "evaluate.py", "cases.jsonl")
            if outcome == "sft":
                command(project, "python", "train.py")
                (report,) = project.glob("runs/*/superii-run.json")
                run = json.loads(report.read_text())
                assert run["status"] == "completed"
                refresh_inputs(http, targets)
                token = exchange(http, targets["adapter"]["id"], SCOPES)
                route = ORIGIN + "/api/repositories/" + targets["adapter"]["id"]
                state = checked(
                    http.get(
                        route + "/recipe", headers={"authorization": "Bearer " + token}
                    )
                ).json()
                if state["status"] == "published":
                    with Client(token=token) as client:
                        adapter = client.pull(targets["adapter"]["repository"])
                        previous = json.loads(
                            (adapter.path / "superii-run.json").read_text()
                        )
                        assert previous["recipe_sha256"] == run["recipe_sha256"]
                        assert previous["artifacts"] == run["artifacts"], (
                            "Prior adapter differs; use an intentionally prepared new fixture revision"
                        )
                    publication = {"status": "published", "reused": True}
                else:
                    checked(
                        http.post(
                            route + "/publication-metadata",
                            headers={"authorization": "Bearer " + token},
                            json={
                                "license": "mit",
                                "basis": "original",
                                "confirmed": True,
                            },
                        )
                    )
                    publication = publish(
                        Recipe.read(project / "superii-recipe.json"),
                        report,
                        targets["adapter"]["id"],
                        token=token,
                        directory=project / "adapter",
                        submit=True,
                    )
                    assert publication["status"] == "published"
                    with Client(token=token) as client:
                        adapter = client.pull(targets["adapter"]["repository"])
                        assert adapter.verify()
                command(
                    project,
                    "python",
                    "-c",
                    """from pathlib import Path
from superii import Client
from superii.recipes import Recipe
from superii.recipes.training import load_adapter
with Client() as client:
    with load_adapter(Recipe.read(), client, next(Path('runs').glob('*/superii-run.json'))) as model:
        assert isinstance(model.generate('the apple', max_tokens=4), str)
""",
                )
                records[outcome] = {
                    "recipe": run["recipe_sha256"],
                    "run": run["run_id"],
                    "adapter_publication": publication["status"],
                    "adapter_hashes_verified": True,
                }
            else:
                os.environ["SUPERII_APP_TOKEN"] = secrets.token_urlsafe(32)
                command(
                    project,
                    "python",
                    "-c",
                    """import os
from fastapi.testclient import TestClient
from app import app
with TestClient(app, base_url='http://localhost') as http:
    assert http.get('/health').status_code == 200
    assert http.get('/ready').status_code == 401
    headers={'authorization':'Bearer '+os.environ['SUPERII_APP_TOKEN']}
    assert http.get('/ready',headers=headers).status_code == 200
    response=http.post('/v1/predict',headers=headers,json={'text':'the apple is red .'})
    assert response.status_code == 200, response.text
    assert http.post('/v1/predict',headers={**headers,'origin':'https://example.invalid'},json={'text':'test'}).status_code == 403
""",
                )
                records[outcome] = {
                    "recipe": Recipe.read(project / "superii-recipe.json").sha256,
                    "generated_code_executed": True,
                    "api_auth_and_origin_checks": True,
                    "container": verify_container(project, http, targets),
                }
        output = Path("reports/generated-projects.json")
        output.parent.mkdir(exist_ok=True)
        output.write_text(
            json.dumps(
                {
                    "status": "passed",
                    "hardware": "cpu",
                    "sources": "private synthetic fixtures",
                    "source_revisions": refs,
                    "sdk_version": importlib.metadata.version("superii-sdk"),
                    "scope": "execution; not model quality",
                    "cross_repository_token_rejected": True,
                    "projects": records,
                },
                indent=2,
            )
            + "\n"
        )
        print(output.read_text())


if __name__ == "__main__":
    main()
