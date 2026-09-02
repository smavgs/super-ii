# Super ii Runtime

Super ii Runtime is the self-hosted Linux data plane behind the Cloudflare/Astro website. It stores repository files, quarantines uploads, runs local security and AI-format inspection, and provides optional local inference. It never calls a commercial inference API.

## Security boundary

The public website is the control plane. The runtime is a separate authenticated service and should be reachable only through a TLS reverse proxy or private tunnel.

The upload state machine is:

```text
upload -> quarantine -> path and format policy -> ClamAV -> Gitleaks
       -> specialized offline inspection -> immutable SHA-256 object
       -> finalization -> human review -> PL/pgSQL publish gate
```

Missing, timed-out, or errored scanners leave a file quarantined. A positive malware, secret, unsafe-serialization, or invalid-format finding rejects the file. Publication requires both ClamAV and Gitleaks pass evidence for every file and an approved review.

## Implemented capabilities

- Content-addressed local filesystem storage under `objects/sha256/`; Xet is used only by the isolated Bridge downloader for compatible inbound provider transfer and is not the internal storage format.
- Repository revisions, manifests, files, releases, tags, downloads, reviews, and inspection evidence in Postgres.
- Offline `safetensors`, Datasets, Transformers, Tokenizers, GGUF, and optional Diffusers inspection.
- Conservative model compatibility inspection for architecture, parameters, quantization, tensor format, size, RAM, VRAM, CPU, CUDA, ROCm, Metal/MLX, llama.cpp, and browser use. Publisher declarations remain labeled and are never promoted to benchmark evidence.
- A TUS 1.0 resumable transfer path with 10 GiB policy ceiling, bounded chunks, checksums, expiry, termination, offset reconciliation, and atomic SHA-256 promotion through a loopback-only Rust sidecar.
- A Rust `superii` CLI for resumable push, ranged pull, complete-digest verification, and transfer inspection.
- Persistent llama.cpp GGUF generation/chat through one checksum-bound loopback server with continuous batching, warm reuse, lifecycle records, status, and unload controls.
- Explicit one-shot notebook execution for reviewed public notebooks in non-root, no-network, read-only, resource-bounded Docker sandboxes with no injected secrets and checksum-verified results.
- Diffusers-generated PNG artifacts written atomically with private permissions and a configurable 24-hour retention window.
- Gradio-only Spaces in read-only, no-egress, capability-dropped, resource-limited containers, streamed through the authenticated website into a sandboxed app iframe.
- Local browser inference assets for Transformers.js, with remote models disabled in the website.
- An authenticated, bounded DDGS web-search adapter for opt-in current-information lookups. It returns only normalized public titles, links, snippets, sources, and dates; it does not crawl result pages.
- Postgres full-text/trigram discovery plus community, collections, social, and lineage tables.
- A separate online Bridge worker for exact-revision Hugging Face imports through Xet-aware downloads, source checksum verification, quarantine scanning, offline analysis, immutable provenance, cancellation, recovery, and review-only completion.

vLLM is deliberately disabled until Super ii owns dedicated GPU capacity. Text Embeddings Inference is deliberately disabled until measured Postgres search scale warrants semantic search.

The runtime image pins the official llama.cpp `b10516` Ubuntu CPU archives for amd64 and arm64 and verifies the SHA-256 digests published with that release before extracting them. Gitleaks is pinned and verified the same way. Rust is pinned by `rust-toolchain.toml`; Cargo and uv lockfiles are required in CI.

## Development

Use the checked-in lockfile and Python 3.12:

```sh
uv sync --extra test --python 3.12
uv run pytest
uv run ruff check .
cargo test --locked --manifest-path ../rust/Cargo.toml
cargo clippy --locked --all-targets --manifest-path ../rust/Cargo.toml -- -D warnings
```

Create an ignored `.env` from `.env.example`. Generate a unique runtime token of at least 32 characters and use the same value as the Cloudflare `RUNTIME_TOKEN` secret. Never commit it.

Start directly on a trusted host:

```sh
uv run superii-runtime
```

Or build the containerized runtime and ClamAV service:

```sh
docker compose build
docker compose up -d
```

The Compose port is bound to `127.0.0.1:8788`. Put TLS or a private Cloudflare Tunnel in front of it. Do not expose port 8788 directly.

On an Apple-silicon development host that also supervises Docker Spaces, run
ClamAV from Compose and the authenticated runtime through
`scripts/run-runtime-macos.sh`. The host client streams file bytes to ClamAV on
localhost, so the antivirus container never receives a host filesystem path.
Runtime credentials are read from macOS Keychain and never stored in the
repository or a launch-agent property list.

The Bridge worker is deliberately a separate launch service. The main runtime
keeps `HF_HUB_OFFLINE=1`; only `run-bridge-macos.sh` can reach the provider. It
reads the database URL, runtime service token, and AES-256-GCM Bridge key from
macOS Keychain, never logs provider tokens, downloads an exact provider commit,
verifies its advertised Git/LFS checksums, and sends verified files through the
same quarantine and offline analysis gates as direct uploads. Imports stop in
review. Automatic checks are opt-in and limited to public provider sources.

Preserve the production inference and Spaces extras when installing or updating
the shared host environment:

```sh
uv sync --frozen --no-dev --extra diffusion --extra spaces
```

Run it directly on a configured development host with:

```sh
uv run superii-bridge
```

The dedicated `runtime.superii.site` connector runs from
`run-cloudflared-macos.sh` under the checked-in launch-agent definition. Its
remotely managed tunnel token belongs outside the repository at
`~/Library/Application Support/Super ii Runtime/cloudflared-token`, owned by
the runtime user with mode `0600`. The connector publishes only the loopback
runtime on port `8788`; keep that port closed to the LAN.

## Lightweight web search

`POST /v1/search` is an authenticated control-plane endpoint, not a public search API. It accepts a bounded query, general/news category, optional freshness window, SafeSearch setting, and at most eight results. The website currently requests at most five. Results are normalized and URL-checked before returning; the runtime does not fetch, crawl, or summarize destination pages. User identity, plan allowance, and daily rate limiting stay in the website control plane.

## Resumable transfers

Run `superii-transferd` only on loopback. The Python runtime is the sole trusted caller; Cloudflare never receives its service token. Browser clients receive an expiring, repository/revision/profile/size/checksum-bound capability and send independent 8 MiB chunks through same-origin Astro routes. Every chunk is streamed, offset-checked, and checksum-checked before the Rust service durably advances state. Commit rechecks the complete SHA-256 digest; scanning and human review still remain mandatory after upload.

The CLI resumes from a mode-0600 local state file containing the short-lived transfer capability. It never logs that capability, and removes the state file after a successful commit. Protect or delete an abandoned state file before its expiry. Its basic commands are `superii push`, `superii pull`, `superii verify`, and `superii inspect`; use `superii --help` for required URL, capability, checksum, and output arguments.

## Persistent llama.cpp

The runtime materializes an immutable revision into a manifest-keyed, read-only persistent workspace and verifies every source object on first use. Compatible GGUF requests share one loopback-only `llama-server`; changing revision, path, or SHA-256 unloads the old process. The server disables its web UI, uses continuous batching, records its cold start and request lifecycle, and may be explicitly unloaded through the authenticated control plane. The default idle policy is 15 minutes.

This improves warm-request latency without creating a GPU-cloud claim. Availability and performance still depend on the exact reviewed model and operator hardware; vLLM remains disabled.

## Notebook execution

The static reader never executes code. A separate authenticated action can execute an exact reviewed public `.ipynb` revision in the pinned `superii/notebook-executor:0.1.0` image. Build it with:

```sh
./scripts/build-notebook-image.sh
```

Each run is one-shot and non-root with `--network=none`, `--ipc=none`, a read-only root and repository, all capabilities dropped, `no-new-privileges`, no secret environment, and explicit CPU, memory, PID, file-descriptor, cell, output, and wall-time bounds. Only the requesting profile can retrieve the private result, whose complete SHA-256 digest is checked at rest. Sessions expire after 24 hours. This is a reviewed-code Docker boundary, not a hostile multi-tenant or microVM claim.

Do not mount the Docker socket into the public runtime container. Notebook execution is enabled when the runtime is supervised directly on the trusted host; a containerized runtime needs a separately designed host executor rather than a Docker-socket escape hatch.

## Gradio Spaces

Build the pinned base image:

```sh
./scripts/build-space-image.sh
uv run python scripts/smoke-space.py
```

The initial Space contract supports one framework: a reviewed repository with `app.py` exporting a Gradio `Blocks` or `Interface` as `demo` or `app`. Custom dependency installation is intentionally disabled in this first format. The public website can start, stop, and stream only the exact latest published revision. Gradio receives its scoped website root path; the iframe omits `allow-same-origin`, and its response policy permits only Super ii assets and connections.

The untrusted app container is attached only to Docker's internal network and therefore has no egress. A second capability-dropped container runs trusted fixed-purpose TCP forwarding code, joins both that internal network and Docker's bridge, and publishes a dynamic port on `127.0.0.1` only. This preserves no-egress execution while allowing the host runtime to stream the app. Run the supervisor on a dedicated host with rootless Docker; do not mount a Docker socket into the public runtime container.
