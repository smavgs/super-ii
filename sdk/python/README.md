# Super ii Python SDK

Install the package (Python 3.11 or newer):

```sh
python -m pip install superii-sdk
```

The distribution is named `superii-sdk`; the import and CLI are named `superii`.
For a source checkout, use `python -m pip install ./sdk/python` instead.

```python
import superii

print(superii.hardware())  # stays on this machine
print(superii.inspect("owner/model"))  # metadata, immutable files and evidence
print(superii.plan("owner/model"))  # estimates and explains before loading
with superii.load("owner/model") as model:
    print(model.generate("Hello", max_tokens=128))
```

The catalogue remains intentionally empty before creator submissions. The
example repository is a placeholder, not a seeded or downloadable model.

`load` resolves one published commit, plans against available memory, downloads
only its selected files, verifies every SHA-256, checks memory again and invokes
an installed runtime. Pass `revision="<full 64-character commit>"` for reproducible
notebooks, applications, training inputs and CI. `pull` returns a `Snapshot` with
its path and manifest; `verify(snapshot)` rechecks bytes. `await superii.apull(...)`
and `Client.prefetch(...)` support asynchronous/background acquisition.

Install llama.cpp's `llama-server` from its official distribution for GGUF.
Optional extras `superii-sdk[mlx]`, `superii-sdk[transformers]` and
`superii-sdk[serve]` add those integrations;
install vLLM using its hardware-specific official instructions. Nothing installs
or recompiles a backend behind the user's back. The initial planner supports
single-file GGUF and known text architectures with safetensors. Unsupported
architectures, custom Python, split GGUF and ambiguous conversions fail with a
reason. The vLLM and Transformers offline adapters currently return a complete
response rather than token streaming.

Memory estimates include OS headroom and context overhead, but are not a zero-OOM
guarantee. Existing smaller or quantized artifacts are preferred to inventing a
conversion. GPU support must be present in the installed runtime; compatibility
metadata is not a benchmark. `lazy_weights=True` enables the installed MLX
loader's lazy evaluation of already-verified local weights; it does not execute
partially downloaded weights.

Downloads use strict ranges, resume partial chunks, verify the final file and
deduplicate content within each authenticated cache. Redirects cannot forward
credentials; private content uses a separate credential-scoped cache. Set
`SUPERII_TOKEN` to an existing scoped token with `repository:read` to access an
authorized private published release. Every new pull rechecks canonical access,
even when bytes are cached. Files already intentionally downloaded by their
authorized owner remain local; revocation cannot erase an owner's copies.

```python
with superii.load("owner/model") as model:
    model.serve(port=8765, token=your_random_local_token)  # loopback OpenAI text API
    # Or model.serve_mcp() for a stdio MCP inference tool.
```

The OpenAI endpoint requires a token and rejects browser origins. It implements
non-streaming text completions and chat completions; it does not claim full
OpenAI API parity. MCP exposes one inference tool and does not itself configure
an agent's model provider. Repository content and model output remain untrusted.

An optional explicit `Client(peers=(Peer("https://cache.example", peer_token),))`
can use a peer cache. No discovery or LAN broadcasts occur. Private artifacts
always bypass peers. `superii.serving.create_cache_app` serves already-cached
public hashes only, after fresh canonical visibility checks. Deploy that optional
service with TLS and a separate strong peer credential; otherwise leave peers
unset. Outages, missing data and corrupted peer bytes fall back to the origin.

Canonical manifests are hashes, not publisher identity proofs. New automatic
publication also returns an Ed25519 policy attestation; verification and key
pinning are documented with the publication service. Historical releases retain
their historical evidence and are not silently relabeled.

## Measurements and acquisition research

`superii benchmark owner/model "Hello" --max-tokens 128` records first output,
generation time, approximate tokens per second, sampled process-tree peak RSS
and bytes acquired before inference. Batch adapters label first-output time
separately from token-streaming TTFT. RSS does not measure all GPU allocations.
Run cold and warm cache trials separately; the tool does not clear the OS cache.

`superii.experiments.tensor_ranges(snapshot)` indexes verified safetensors, and
`iter_tensor_bytes(snapshot, prefix="model.layers.0.")` performs bounded mmap
reads for layer or expert experiments. These are tested access primitives;
arbitrary models do not yet execute with partial weights. All files must pass
full verification first. Quantization/conversion, layer scheduling and MoE
expert selection require an architecture-specific implementation and benchmark.

Optional remote warm-start is explicit at each remote request:

```python
from superii.remote import RemoteModel

# This call sends the prompt to your chosen provider. Use its separate token.
# Local pull/load may run concurrently in your application's executor.
with RemoteModel("https://your-provider.example", "model-id", token=provider_token) as remote:
    answer = remote.generate("Hello")
# Switch to your completed local Model for later requests when you choose.
```

This adapter implements the provider's non-streaming `/v1/completions` contract.
It never reuses Super ii credentials, follows redirects, silently falls back to
remote execution, or asserts that remote and local model outputs are identical.

Sources: [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server),
[MLX LM](https://github.com/ml-explore/mlx-lm),
[vLLM](https://docs.vllm.ai/en/latest/),
[safetensors](https://huggingface.co/docs/safetensors/),
[MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk).

## Engineering recipes (0.2)

`superii pull owner/dataset --kind dataset --revision <commit>` extends the same
verified acquisition contract to datasets. Model acquisition remains compatible.

Create a project at https://superii.site/build or save a request JSON and run
`superii recipe request.json new-project`. The request selects `rag`, `api`, or
`sft`, and supplies `generator`, plus `embedding` for RAG or `dataset` for SFT.
Each input is an object containing `repository` and a full immutable `revision`.
The command writes verified text files to a new directory; it never installs or
executes the project. Source access is checked again when the project runs.

The `rag`, `train`, `serve`, and `observe` extras supply optional runtime packages.
Recipes use Python 3.12 and pin tested dependencies. CPU/Apple fixture tests cover
local embeddings, bounded FAISS retrieval, ingestion, evaluation, authenticated
APIs and CPU LoRA. Apple FAISS runs in an isolated local process to avoid the
PyTorch/FAISS OpenMP wheel conflict. GPU exports remain explicitly unverified.

`superii-recipe.json` binds exact input revisions, file selections, settings and
template versions with an RFC 8785 SHA-256. `superii-run.json` records actual local
execution and output hashes; it never creates an independently verified badge.
RAG citations are source references, not an independent truth or entailment test.
SFT uses a content-deduplicated held-out split and reports language-model loss,
not general task quality. JSONL rows accept `text` or `prompt`/`completion`, with
an optional string `id` (1–512 characters). IDs are ignored during training and
do not alter content deduplication or the held-out split, so a text dataset can
also retain its RAG document identifiers. Other fields remain rejected.
LoRA outputs use safetensors without pickled trainer
settings. `superii.recipes.training.load_adapter` checks the run artifacts before
attaching an adapter to its explicitly acquired base.

`publish.py` in a training export returns the recorded adapter to an existing
editable repository revision. It verifies destination bytes and attaches reported
lineage before optional central-policy submission. It requires a repository-bound
scoped token, current rights declarations and accessible lineage sources; it does
not create repositories or weaken publication policy.
