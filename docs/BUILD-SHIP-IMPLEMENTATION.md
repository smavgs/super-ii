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

## Verified release

SDK 0.2.2 and the generated projects are deployed. The complete live workflow
[34350858257](https://github.com/smavgs/super-ii/actions/runs/34350858257)
passed on 2026-09-09 from source `75dd10d95725e7e420cabf0f5081d183720b3cef`.
Both jobs succeeded: `verify-private-fixture` and `verify-generated-projects`.
The worker version was `b07726cf-1880-4063-8336-2e881945cbc8`.

The workflow installed the published SDK from the exported frozen dependency
lock and downloaded generated projects through the production API. It used
three private synthetic inputs: a tiny GPT-2 generator, a tiny BERT encoder and
20 distinct text rows. It verified:

- Exact GitHub OIDC credentials, rejected scope expansion and invalid signatures,
  rejected cross-repository access, and anonymous 404 responses for private data.
- Immutable, policy-published input acquisition with file hashes and signed SDK
  attestations. The previously published standalone dataset was safely reused.
- Generated API execution with loaded weights, authenticated readiness and
  predictions, and browser-origin rejection.
- RAG ingestion, FAISS retrieval, evaluation and authenticated serving.
- Actual API and RAG Docker builds and predictions, with UID 10001 and a loopback
  host binding. These checks loaded the private models inside the containers.
- One CPU LoRA training step, an 18/2 train/held-out split, and measured loss
  before and after training.
- TUS upload, exact artifact readback, base/dataset lineage, central-policy
  adapter publication, verified download and generation with the downloaded
  adapter attached to the exact acquired base model.

The published adapter revision is
`30f2f17fad6e58e7c12f70a79f4c2b0fb9714c75d2126b30a1bbcea44adaf06c`;
its manifest SHA-256 is
`9ac619eea3cd87684140e14e6d6477ac575e7d1a8f0896b0ea847895cf7b8213`.
The five test repositories remain private. The public model/dataset/app
catalogue was not populated with test material.

## Evidence and reproducibility

- `verification/build-ship-live.json` records workflow/source provenance and
  hashes of the exact downloaded job artifacts.
- `verification/build-ship-projects.json` contains actual project results,
  recipe IDs, input revisions, metrics and adapter identifiers.
- `verification/github-superii-publishing.json` preserves the first genuine
  dataset upload/publication result. `verification/github-superii-publishing-recheck.json`
  records its successful reuse in the complete workflow.
- `verification/sdk-0.2.2-release.json` records the PyPI publisher run and both
  distribution hashes. Public bytes match the tested artifacts. All 42 SDK
  tests pass on Python 3.12 and 3.13, including real CPU and Apple Metal fixtures.
- `verification/build-ship-browser.json` records the signed-in production
  export checked on 2026-09-10: preview, ZIP CRC and safe paths, Python syntax,
  recipe hash, SDK 0.2.2 wheel pin, and 390 px/832 px layouts without page overflow.
- `verification/build-ship-production-state.json` records the private fixture
  state, public catalogue count and exact adapter lineage from the database.

Projects include their resolved `uv.lock`, distribution hashes and frozen
installation instructions. Linux projects select official CPU PyTorch wheels.
Local checks also exercise LangChain, Gradio and observability extras,
source-credential isolation, malformed inputs, cross-language canonical hashes,
ZIP exports and existing Apple GGUF execution. Production builds and release
scanning pass. The scoped machine-access configuration is documented in
`operations/MACHINE-ACCESS.md`.

The SDK planner accepts the inspector's explicit built-in architecture class
names without relaxing configuration validation, safetensors, installed-runtime
or memory checks. SFT accepts bounded optional document IDs as metadata while
retaining content deduplication and the held-out split. These fixes preserve
one immutable text dataset across RAG and training.

## Verification limits

These results establish execution, authentication and artifact integrity with
small synthetic fixtures. They do not establish model quality or production
throughput. The tiny untrained encoder scored zero on the single retrieval test
case; the recorded metric is retained rather than presented as a quality result.
The one-step LoRA loss change is not a task benchmark. Evaluate the selected
models and user data against the intended task before relying on their answers.

NVIDIA QLoRA and vLLM exports have explicit opt-in scripts and separate
requirements; their dependencies resolve, but no NVIDIA host was available.
CUDA, ROCm and GPU-specific execution remain unverified. The 10 GiB transfer
policy ceiling is not a measured large-file performance claim. Hosted GPU
capacity, broad model benchmarks and GA operational maturity are not claimed.

Earlier SDK 0.2.0 and 0.2.1 receipts remain as release history. The passing live
workflow supersedes the earlier pending integration notes. Pricing, existing
onboarding, Use Model and Run/Code/Share remain in place.
