# Build & Ship implementation

Approved on 2026-09-06 following the engineering recipes discussion.
Baseline: `0dea6279b9d0657b161733e5bd52562541912a73`.

## Product and interface

Visual thesis: use the existing quiet repository surface, typography and accent
to make the selected outcome and exact source revision clear.
Content plan: choose an outcome, choose supported inputs and execution settings,
review the generated files, download a project and follow its local README.
Interaction thesis: a short panel reveal, dependent field transitions and clear
generation/download feedback; honor reduced motion and restore keyboard focus.

Build & Ship extends model and dataset pages. It does not create a second
repository, user database, training service or hosted GPU offering. Existing
Use Model clients and the intentionally empty public catalogue are preserved.

## Delivery and acceptance

1. Versioned recipe and run schemas bind immutable inputs, template/dependency
   versions, environment, parameters, status, measured results and output hashes.
   User-reported measurements are distinct from independently verified evidence.
2. Extend SDK acquisition to immutable datasets and add explicit embedding and
   training support. Preserve model acquisition, canonical authentication,
   revision checks, cache isolation and publication attestations.
3. Deliver a complete local RAG project: bounded document ingestion, stable
   document/chunk identities, FAISS retrieval, source citations, context limits,
   abstention, evaluation, authenticated FastAPI, Docker, tests and run records.
   User documents and indexes stay in the user's application.
4. Deliver supported SFT with LoRA: validated immutable datasets, training
   preflight, PEFT/TRL/Accelerate, an adapter output, evaluation and explicit
   return through the existing publication and lineage system. QLoRA is enabled
   only for a validated backend; inference memory estimates do not qualify it.
5. Add compatible framework, serving and observability exports with pinned
   dependencies and execution evidence. Gradio export is separate from eligibility
   for the existing protected Apps host. Hardware-dependent kits must state their
   verification scope; unverified combinations are not called tested.
6. Complete and verify GitHub-to-Super ii trusted publication separately from the
   SDK's GitHub-to-PyPI release. Project metric gates do not override central policy.
7. Verify archive contents, generated project execution, bad-input behavior,
   responsive browser flows, publication authorization and current upstream
   compatibility. Merge and deploy through normal CI. Release the SDK when its
   new public interfaces are verified.

GRPO, DeepSpeed, orchestration engines, GitLab identity integration and additional
hosted application frameworks remain later work, as agreed in the proposal.

## Verification record

Local verification on 2026-09-07:

- 39 SDK tests pass, including real tiny-model CPU LoRA training, held-out loss,
  verified adapter reload, embedding and FAISS retrieval, HTTP authentication,
  source credential isolation and Apple Metal GGUF RAG execution.
- Generated RAG, API and SFT archives pass cross-language canonical hashes,
  JSON schemas, ZIP CRC/path checks and Python syntax validation.
- Browser checks cover generation, file preview, ZIP download, SFT input rules,
  dark theme and a 390 px viewport without page overflow.
- Website validation and production build pass; release artifact scanning finds
  no bundled private local values. Astro check reports no errors or warnings.
- GPU vendor dependencies resolve for Linux/Python 3.12. QLoRA and vLLM have
  explicit opt-in scripts and separate recipe hashes; NVIDIA execution is unverified.

SDK 0.2.0 was published on 2026-09-08 through the existing scoped PyPI trusted
publisher. The public wheel hash matches the clean Python 3.12 artifact that
passed all 39 tests. Release receipts are in `verification/sdk-0.2.0-release.json`.

Projects include the resolved `uv.lock`, distribution hashes and frozen install
commands. A fresh generated project installs from PyPI with the requested
LangChain, Gradio and observability extras. Linux projects select official CPU
PyTorch wheels. Local fixture archives remain distinct from live verification.

The manual GitHub verification workflow is bound to fixed private synthetic
fixtures. It checks OIDC scope/signature rejection, independent publication,
private authenticated acquisition, actual generated API/RAG/SFT execution and
adapter return. The website was deployed from `b42391d` on 2026-09-08 and its
production Build & Ship interface was checked in Chrome. Live GitHub execution
is still pending: the first attempt hit Cloudflare Bot Fight Mode; after the
approved setting change, the request reached Super ii and exposed a mismatch
with GitHub's newer immutable subject format. The compatibility fix preserves
exact subjects and independently compares embedded owner/repository IDs with
the signed claims. Fixture execution does not establish model quality.
