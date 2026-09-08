from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from test_sdk import ORIGIN, document

from superii import Client, IntegrityError, PlanError
from superii.client import Snapshot
from superii.manifest import Manifest
from superii.recipes.contracts import Recipe, RunRecord, digest, validate_document
from superii.recipes.evaluation import retrieval_metrics

DEFAULTS = dict(
    chunk_size=256,
    chunk_overlap=32,
    top_k=3,
    context_size=512,
    max_tokens=32,
    min_score=-1,
    embedding_max_tokens=128,
    query_prefix="",
    document_prefix="",
    seed=42,
    max_steps=1,
    batch_size=1,
    gradient_accumulation_steps=1,
    sequence_length=32,
    lora_rank=2,
    learning_rate=0.0002,
    adapter="lora",
    framework="python",
    ui="none",
    observability=False,
)


def snapshot(directory: Path, kind="model", architecture="gpt2"):
    data = {
        p.relative_to(directory).as_posix(): p.read_bytes()
        for p in directory.rglob("*")
        if p.is_file()
    }
    doc = document(data)
    doc["repository"]["kind"] = kind
    doc["repository"]["slug"] = directory.name
    doc["compatibility"] = {"architecture": architecture, "dtype": "float32"}
    manifest = Manifest.parse(doc, ORIGIN)
    return Snapshot(directory, manifest, tuple(data), 0)


def reference(value=None, kind="model"):
    return dict(
        kind=kind,
        repository=value.manifest.repository if value else "owner/model",
        revision="c" * 64,
        manifest_sha256=value.manifest.manifest_sha256 if value else "a" * 64,
        files=list(value.files) if value else ["config.json", "model.safetensors"],
    )


def recipe(outcome="rag", generator=None, embedding=None, dataset=None, **config):
    value = dict(
        schema="https://superii.site/schemas/superii-recipe-v1.json",
        recipe_version=1,
        outcome=outcome,
        template={"id": "superii-" + outcome, "version": "1.0.0"},
        inputs={
            "generator": reference(generator),
            "embedding": reference(embedding) if outcome == "rag" else None,
            "dataset": reference(dataset, "dataset") if dataset else None,
        },
        target={"accelerator": "cpu", "python": "3.12", "runtime": "transformers"},
        configuration={**DEFAULTS, **config},
        dependencies={"superii-sdk": "0.2.0"},
        verification={
            "scope": "template-fixture-tests",
            "model_quality": "not-established",
            "hardware": ["cpu"],
        },
    )
    value["recipe_sha256"] = digest(value)
    return Recipe(value)


def test_recipe_checksum_paths_and_run_evidence(tmp_path):
    selected = recipe()
    changed = {**selected.document, "outcome": "api"}
    with pytest.raises(IntegrityError):
        Recipe(changed)
    with pytest.raises(ValueError):
        recipe(chunk_overlap=256)
    output = tmp_path / "output.txt"
    output.write_text("actual output")
    report = json.loads(
        RunRecord(selected, "package", directory=tmp_path / "runs")
        .finish(metrics={"latency_ms": 1.2}, artifacts={"output.txt": output})
        .read_text()
    )
    assert report["evidence"] == {"classification": "reported", "independent_verification": False}
    assert report["artifacts"][0]["size_bytes"] == 13
    assert "TOKEN" not in json.dumps(report["environment"])
    validate_document("superii-run-v1.json", report)


def test_dataset_acquisition_rechecks_kind(tmp_path):
    data = b'{"text":"data"}\n'
    doc = document({"data.jsonl": data})
    doc["repository"]["kind"] = "dataset"
    seen = []

    def handle(request):
        seen.append(request.url.path)
        if request.url.path.startswith("/api/sdk/"):
            return httpx.Response(200, json=doc)
        return httpx.Response(
            206, content=data, headers={"content-range": f"bytes 0-{len(data) - 1}/{len(data)}"}
        )

    with Client(
        ORIGIN, cache_dir=tmp_path, transport=httpx.MockTransport(handle), require_attestation=False
    ) as client:
        acquired = client.pull("owner/model", kind="dataset", revision="c" * 64)
        assert acquired.verify() and acquired.manifest.kind == "dataset"
        with pytest.raises(IntegrityError):
            client.inspect("owner/model", kind="model")
    assert seen[0].startswith("/api/sdk/datasets/")


def test_reference_metrics_are_document_based():
    assert retrieval_metrics(["a", "a", "b"], {"a", "c"}) == {
        "recall_at_k": 0.5,
        "precision_at_k": 0.5,
        "mrr": 1.0,
        "ndcg_at_k": 1 / (1 + 1 / __import__("math").log2(3)),
    }
    with pytest.raises(ValueError):
        retrieval_metrics(["a"], set())


@pytest.fixture
def tiny_models(tmp_path):
    torch = pytest.importorskip("torch")
    pytest.importorskip("faiss")
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
    vocabulary = {
        word: i
        for i, word in enumerate(
            [
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
            ]
        )
    }
    raw = Tokenizer(models.WordLevel(vocabulary, unk_token="[UNK]"))
    raw.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=raw,
        pad_token="[PAD]",
        unk_token="[UNK]",
        eos_token="[EOS]",
        model_max_length=512,
    )
    encoder = tmp_path / "encoder"
    generator = tmp_path / "generator"
    encoder.mkdir()
    generator.mkdir()
    tokenizer.save_pretrained(encoder)
    tokenizer.save_pretrained(generator)
    BertModel(
        BertConfig(
            vocab_size=len(vocabulary),
            hidden_size=16,
            num_hidden_layers=1,
            num_attention_heads=2,
            intermediate_size=32,
            max_position_embeddings=512,
        )
    ).save_pretrained(encoder)
    GPT2LMHeadModel(
        GPT2Config(
            vocab_size=len(vocabulary),
            n_embd=16,
            n_layer=1,
            n_head=2,
            n_positions=512,
            eos_token_id=2,
            pad_token_id=0,
        )
    ).save_pretrained(generator)
    return snapshot(generator), snapshot(encoder, architecture="bert")


def test_real_encoder_retrieval_citations_and_integrity(tiny_models, tmp_path):
    from superii.recipes.embeddings import Encoder
    from superii.recipes.evaluation import evaluate_rag
    from superii.recipes.rag import RagIndex, documents

    gen, emb = tiny_models
    selected = recipe(generator=gen, embedding=emb)
    encoder = Encoder(emb, max_tokens=128)
    corpus = tmp_path / "documents"
    corpus.mkdir()
    (corpus / "colors.jsonl").write_text(
        "\n".join(
            json.dumps(v)
            for v in [
                {"id": "apple", "text": "red apple is a fruit"},
                {"id": "sky", "text": "blue sky is blue"},
            ]
        )
    )
    index, measures = RagIndex.ingest(selected, encoder, corpus, tmp_path / "index")
    assert measures["documents"] == 2
    assert index.search("red apple is a fruit")[0]["document_id"] == "apple"
    assert len({c["id"] for c in index.chunks}) == 2
    restored = RagIndex.read(selected, encoder, tmp_path / "index")
    assert restored.search("blue sky is blue")[0]["document_id"] == "sky"
    cases = tmp_path / "cases.jsonl"
    cases.write_text(
        json.dumps({"question": "red apple is a fruit", "relevant_document_ids": ["apple"]})
    )
    results, record = evaluate_rag(
        index, cases, output_directory=tmp_path / "runs", gates={"recall_at_k": 1.0}
    )
    assert results["recall_at_k"] == 1 and record.is_file()

    class Cited:
        def generate(self, prompt, **_):
            assert len(prompt.encode()) + selected.config["max_tokens"] <= 512
            import re

            label = re.findall(r"\[D:([a-f0-9]{16})\]", prompt)[0]
            return f"The apple is red. [D:{label}]"

    assert not index.answer("apple", Cited())["abstained"]

    class Uncited:
        def generate(self, *_args, **_kwargs):
            return "a claim with no source"

    assert index.answer("apple", Uncited())["abstained"]
    (tmp_path / "index/vectors.npy").write_bytes(b"corrupt")
    with pytest.raises(IntegrityError):
        RagIndex.read(selected, encoder, tmp_path / "index")
    (corpus / "link.md").symlink_to(cases)
    with pytest.raises(ValueError, match="symlink"):
        documents(corpus)


def test_real_lora_training_and_reload(tiny_models, tmp_path):
    pytest.importorskip("trl")
    from peft import PeftModel
    from transformers import AutoModelForCausalLM

    from superii.recipes.training import train, training_plan, training_rows

    gen, _ = tiny_models
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    (dataset_dir / "train.jsonl").write_text(
        "\n".join(json.dumps({"text": "red apple is a fruit " + "blue " * i}) for i in range(20))
    )
    data = snapshot(dataset_dir, "dataset")
    selected = recipe("sft", generator=gen, dataset=data)

    class LocalClient:
        def inspect(self, *_args, **_kwargs):
            return gen.manifest

        def pull(self, _repository, *, kind, revision, files):
            source = data if kind == "dataset" else gen
            assert revision == source.manifest.revision and set(files) == set(source.files)
            return source

    before, held = training_rows(data, seed=42)
    assert len(before) == 18 and len(held) == 2
    assert not {r["text"] for r in before} & {r["text"] for r in held}
    with pytest.raises(PlanError):
        training_plan(recipe("sft", generator=gen, dataset=data, adapter="qlora"), gen)
    output = tmp_path / "adapter"
    report_path = train(selected, LocalClient(), output=output, run_directory=tmp_path / "runs")
    report = json.loads(report_path.read_text())
    assert report["status"] == "completed" and report["metrics"]["max_steps"] == 1
    assert report["metrics"]["held_out_rows"] == 2
    assert (output / "adapter_model.safetensors").is_file()
    assert not (output / "training_args.bin").exists()
    model = PeftModel.from_pretrained(
        AutoModelForCausalLM.from_pretrained(
            gen.path, local_files_only=True, trust_remote_code=False
        ),
        output,
        local_files_only=True,
    )
    assert model.peft_config["default"].r == 2
    from superii.recipes.training import load_adapter

    with load_adapter(selected, LocalClient(), report_path, directory=output) as verified:
        assert isinstance(verified.generate("red apple", max_tokens=4), str)
    assert json.loads((output / "superii-lineage.json").read_text())["base"]["revision"] == "c" * 64


def test_project_http_auth_limits_and_cleanup(tmp_path):
    pytest.importorskip("prometheus_client")
    from superii.recipes.project import Project, create_app

    selected = recipe("api")
    project = Project(selected, directory=tmp_path)

    class Generator:
        def generate(self, text, **_):
            return text + " result"

        def chat(self, messages, **_):
            return messages[-1]["content"] + " response"

        def close(self):
            pass

    project.generator = Generator()
    app = create_app(project, token="x" * 32, load_on_start=False)
    with TestClient(app, base_url="http://localhost") as client:
        assert client.get("/health").status_code == 200
        assert client.get("/metrics").status_code == 401
        client.headers["authorization"] = "Bearer " + "x" * 32
        assert client.get("/ready").status_code == 200
        result = client.post("/v1/predict", json={"text": "hello"})
        assert result.status_code == 200 and result.json()["text"] == "hello result"
        assert client.post("/v1/predict", json={"text": "x" * 1000}).status_code == 422
        assert client.post("/v1/predict", content=b"x" * 65537).status_code == 413
        assert client.get("/ready", headers={"origin": "https://example.com"}).status_code == 403
        assert "superii_project_requests_total" in client.get("/metrics").text
        chat = client.post(
            "/v1/chat/completions", json={"messages": [{"role": "user", "content": "hello"}]}
        )
        assert (
            chat.status_code == 200
            and chat.json()["choices"][0]["message"]["content"] == "hello response"
        )
        assert (
            client.post("/v1/chat/completions", json={"messages": [], "stream": True}).status_code
            == 422
        )
    assert project.generator is None


def test_export_checks_all_files_before_writing(tmp_path, monkeypatch):
    import hashlib

    from superii.recipes.contracts import canonical
    from superii.recipes.exports import export_project

    monkeypatch.setenv("SUPERII_GENERATOR_TOKEN", "sii_" + "b" * 64)
    selected = recipe("api")
    contents = canonical(selected.document).decode() + "\n"
    response = {
        "recipe": selected.document,
        "files": {"superii-recipe.json": contents},
        "manifest": {
            "superii-recipe.json": {
                "sha256": hashlib.sha256(contents.encode()).hexdigest(),
                "size_bytes": len(contents.encode()),
            }
        },
    }

    def handle(request):
        assert request.url.path == "/api/recipes/generate"
        assert request.headers["authorization"] == "Bearer private-test"
        assert request.headers["x-superii-generator-token"] == "sii_" + "b" * 64
        return httpx.Response(200, json=response)

    with Client(
        "https://superii.site",
        token="private-test",
        cache_dir=tmp_path / "cache",
        transport=httpx.MockTransport(handle),
    ) as client:
        output = export_project({}, destination=tmp_path / "project", client=client)
        assert Recipe.read(output).sha256 == selected.sha256
        response["files"]["superii-recipe.json"] += "changed"
        with pytest.raises(IntegrityError):
            export_project({}, destination=tmp_path / "other", client=client)
        assert not (tmp_path / "other").exists()


def test_publication_reuses_verified_destination_and_rejects_changed_output(tmp_path, monkeypatch):
    import hashlib

    from superii.recipes.contracts import canonical
    from superii.recipes.publication import publish

    monkeypatch.setenv("SUPERII_DATASET_TOKEN", "sii_" + "c" * 64)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "data.jsonl").write_text('{"text":"a"}')
    selected = recipe("sft", dataset=snapshot(data_dir, "dataset"))
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    weights = adapter / "adapter_model.safetensors"
    weights.write_bytes(b"fixture adapter")
    report = RunRecord(selected, "train", directory=tmp_path / "runs").finish(
        artifacts={"adapter_model.safetensors": weights}, metrics={"loss": 1.0}
    )
    record = json.loads(report.read_text())
    existing = {
        "adapter_model.safetensors": weights.read_bytes(),
        "superii-recipe.json": canonical(selected.document) + b"\n",
        "superii-run.json": canonical(record) + b"\n",
    }
    requests = []

    def handle(request):
        requests.append(request)
        assert request.url.host == "superii.site"
        if request.method == "GET":
            assert "x-superii-dataset-token" not in request.headers
            return httpx.Response(
                200,
                json={
                    "status": "draft",
                    "branch_id": "branch",
                    "revision_id": "revision",
                    "files": [
                        {
                            "path": name,
                            "sha256": hashlib.sha256(value).hexdigest(),
                            "size_bytes": len(value),
                        }
                        for name, value in existing.items()
                    ],
                },
            )
        assert request.url.path.endswith("/recipe")
        assert request.headers["x-superii-dataset-token"] == "sii_" + "c" * 64
        return httpx.Response(200, json={"ok": True})

    result = publish(
        selected,
        report,
        "00000000-0000-4000-8000-000000000001",
        token="sii_" + "a" * 64,
        directory=adapter,
        transport=httpx.MockTransport(handle),
    )
    assert result["status"] == "uploaded" and len(requests) == 3
    weights.write_bytes(b"tampered")
    with pytest.raises(IntegrityError):
        publish(
            selected,
            report,
            "00000000-0000-4000-8000-000000000001",
            token="sii_" + "a" * 64,
            directory=adapter,
            transport=httpx.MockTransport(handle),
        )
    assert len(requests) == 3


def test_publication_transfer_commit_and_submit_obey_form_origin_protection(tmp_path):
    import base64
    import hashlib
    from uuid import uuid4

    from superii.recipes.publication import publish

    dataset = tmp_path / "data"
    dataset.mkdir()
    (dataset / "data.jsonl").write_text('{"text":"fixture"}')
    selected = recipe("sft", dataset=snapshot(dataset, "dataset"))
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    weights = adapter / "adapter_model.safetensors"
    weights.write_bytes(b"synthetic adapter")
    report = RunRecord(selected, "train", directory=tmp_path / "runs").finish(
        artifacts={"adapter_model.safetensors": weights}, metrics={"loss": 1.0}
    )
    transfers, uploaded = {}, {}

    def handle(request):
        assert request.url.host == "superii.site"
        # Match the production framework's form-origin boundary. Machine JSON
        # and TUS chunks are allowed; a bodyless POST without Content-Type is not.
        if request.method == "POST":
            content_type = request.headers.get("content-type", "")
            if not content_type or content_type.startswith(
                ("text/plain", "multipart/form-data", "application/x-www-form-urlencoded")
            ):
                return httpx.Response(403, text="Cross-site POST form submissions are forbidden")
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "status": "draft",
                    "branch_id": "branch",
                    "revision_id": "revision",
                    "files": list(uploaded.values()),
                },
            )
        if request.url.path.endswith("/transfers"):
            metadata = json.loads(request.content)
            transfer_id = str(uuid4())
            transfers[transfer_id] = {**metadata, "content": b""}
            return httpx.Response(
                201,
                json={
                    "transfer_id": transfer_id,
                    "transfer_token": "fixture-capability",
                    "upload_url": "https://untrusted.invalid/must-not-follow",
                },
            )
        if "/api/transfers/" in request.url.path:
            transfer_id = request.url.path.split("/")[3]
            transfer = transfers[transfer_id]
            assert request.headers["tus-resumable"] == "1.0.0"
            assert request.headers["x-superii-transfer-token"] == "fixture-capability"
            if request.method == "PATCH":
                assert request.headers["upload-offset"] == str(len(transfer["content"]))
                expected = base64.b64encode(hashlib.sha256(request.content).digest()).decode()
                assert request.headers["upload-checksum"] == "sha256 " + expected
                transfer["content"] += request.content
                return httpx.Response(204, headers={"upload-offset": str(len(transfer["content"]))})
            assert request.url.path.endswith("/commit") and json.loads(request.content) == {}
            assert hashlib.sha256(transfer["content"]).hexdigest() == transfer["sha256"]
            uploaded[transfer["path"]] = {
                "path": transfer["path"],
                "sha256": transfer["sha256"],
                "size_bytes": len(transfer["content"]),
            }
            return httpx.Response(200, json={"status": "ready"})
        if request.url.path.endswith("/recipe"):
            assert len(uploaded) == 3
            assert json.loads(request.content)["recipe"]["recipe_sha256"] == selected.sha256
            return httpx.Response(200, json={"ok": True})
        assert request.url.path.endswith("/submit") and json.loads(request.content) == {}
        return httpx.Response(200, json={"status": "published"})

    result = publish(
        selected,
        report,
        "00000000-0000-4000-8000-000000000001",
        token="sii_" + "a" * 64,
        directory=adapter,
        submit=True,
        transport=httpx.MockTransport(handle),
    )
    assert result["status"] == "published" and len(transfers) == 3


def test_real_generated_api_and_framework_exports(tiny_models, tmp_path):
    from importlib.util import find_spec

    from superii.recipes.project import Project, create_app

    gen, _ = tiny_models
    selected = recipe("api", generator=gen, max_tokens=4)

    class LocalClient:
        def inspect(self, *_args, **_kwargs):
            return gen.manifest

        def pull(self, *_args, **_kwargs):
            return gen

    project = Project(selected, directory=tmp_path, client=LocalClient())
    with TestClient(create_app(project, token="t" * 32), base_url="http://localhost") as client:
        response = client.post(
            "/v1/predict",
            json={"text": "red apple"},
            headers={"authorization": "Bearer " + "t" * 32},
        )
        assert response.status_code == 200
        assert isinstance(response.json()["text"], str)
        if find_spec("langchain_core"):
            from langchain_core.runnables import RunnableLambda

            assert isinstance(RunnableLambda(project.predict).invoke("blue sky")["text"], str)
        if find_spec("gradio"):
            import gradio as gr

            ui = gr.Interface(
                fn=project.predict, inputs="text", outputs="json", analytics_enabled=False
            )
            assert isinstance(ui.fn("red apple")["text"], str)


def test_available_apple_rag_execution(tiny_models, tmp_path):
    import shutil
    import sys

    from superii.recipes.contracts import canonical
    from superii.recipes.project import Project

    weights = Path(
        "/Users/apple/.ollama/models/blobs/sha256-5631d74195051ec851d4df9ef7bd201e3d9cb039171ba962ebce931ffa8ed3a2"
    )
    if sys.platform != "darwin" or not weights.exists() or not shutil.which("llama-server"):
        pytest.skip("Apple host and local GGUF fixture required")
    _, encoder = tiny_models
    source = tmp_path / "gguf"
    source.mkdir()
    shutil.copyfile(weights, source / "model.gguf")
    gen = snapshot(source)
    selected = recipe(generator=gen, embedding=encoder, context_size=1024, max_tokens=8)
    value = json.loads(canonical(selected.document))
    value["target"] = {"accelerator": "metal", "python": "3.12", "runtime": "llama.cpp"}
    value["recipe_sha256"] = digest({k: v for k, v in value.items() if k != "recipe_sha256"})
    selected = Recipe(value)

    class LocalClient:
        def inspect(self, repository, **_kwargs):
            return gen.manifest if repository == gen.manifest.repository else encoder.manifest

        def pull(self, *_args, files, **_kwargs):
            return gen if "model.gguf" in files else encoder

    corpus = tmp_path / "documents"
    corpus.mkdir()
    (corpus / "apple.txt").write_text("red apple is a fruit")
    project = Project(selected, directory=tmp_path, client=LocalClient())
    try:
        project.ingest()
        project.load()
        answer = project.predict("apple")
        assert isinstance(answer["abstained"], bool)
        assert project.generator.plan.accelerator == "metal"
    finally:
        project.close()


def test_input_credentials_refuse_noncanonical_destination(monkeypatch):
    from superii.recipes.access import input_headers

    monkeypatch.setenv("SUPERII_DATASET_TOKEN", "sii_" + "b" * 64)
    with pytest.raises(ValueError, match="canonical"):
        input_headers("https://example.invalid")
    monkeypatch.setenv("SUPERII_DATASET_TOKEN", "malformed")
    with pytest.raises(ValueError, match="Invalid"):
        input_headers("https://superii.site")
