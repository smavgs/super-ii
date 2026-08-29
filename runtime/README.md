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

- Content-addressed local filesystem storage under `objects/sha256/`; Xet is intentionally absent.
- Repository revisions, manifests, files, releases, tags, downloads, reviews, and inspection evidence in Postgres.
- Offline `safetensors`, Datasets, Transformers, Tokenizers, GGUF, and optional Diffusers inspection.
- llama.cpp GGUF generation/chat endpoints with no model-routing provider.
- Diffusers-generated PNG artifacts written atomically with private permissions and a configurable 24-hour retention window.
- Gradio-only Spaces in read-only, no-egress, capability-dropped, resource-limited containers, streamed through the authenticated website into a sandboxed app iframe.
- Local browser inference assets for Transformers.js, with remote models disabled in the website.
- Postgres full-text/trigram discovery plus community, collections, social, and lineage tables.

vLLM is deliberately disabled until Super ii owns dedicated GPU capacity. Text Embeddings Inference is deliberately disabled until measured Postgres search scale warrants semantic search.

The runtime image pins the official llama.cpp `b10516` Ubuntu CPU archives for amd64 and arm64 and verifies the SHA-256 digests published with that release before extracting them. Gitleaks is pinned and verified the same way.

## Development

Use the checked-in lockfile and Python 3.12:

```sh
uv sync --extra test --python 3.12
uv run pytest
uv run ruff check .
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

The dedicated `runtime.superii.site` connector runs from
`run-cloudflared-macos.sh` under the checked-in launch-agent definition. Its
remotely managed tunnel token belongs outside the repository at
`~/Library/Application Support/Super ii Runtime/cloudflared-token`, owned by
the runtime user with mode `0600`. The connector publishes only the loopback
runtime on port `8788`; keep that port closed to the LAN.

## Gradio Spaces

Build the pinned base image:

```sh
./scripts/build-space-image.sh
uv run python scripts/smoke-space.py
```

The initial Space contract supports one framework: a reviewed repository with `app.py` exporting a Gradio `Blocks` or `Interface` as `demo` or `app`. Custom dependency installation is intentionally disabled in this first format. The public website can start, stop, and stream only the exact latest published revision. Gradio receives its scoped website root path; the iframe omits `allow-same-origin`, and its response policy permits only Super ii assets and connections.

The untrusted app container is attached only to Docker's internal network and therefore has no egress. A second capability-dropped container runs trusted fixed-purpose TCP forwarding code, joins both that internal network and Docker's bridge, and publishes a dynamic port on `127.0.0.1` only. This preserves no-egress execution while allowing the host runtime to stream the app. Run the supervisor on a dedicated host with rootless Docker; do not mount a Docker socket into the public runtime container.
