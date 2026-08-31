# Notebook security contract

Super ii treats every uploaded `.ipynb` as untrusted publisher data. Reading and execution are separate capabilities with separate trust boundaries.

## Static ingestion and reading

- Accept UTF-8 Jupyter `nbformat` 4 JSON only.
- Validate with pinned `nbformat` before publication review can pass.
- Enforce bounded file, notebook, cell, source, output, and embedded-image sizes.
- Store a normalized analysis document separately from the immutable original file.
- Opening the reader never imports repository modules, initializes a kernel, installs packages, resolves widgets, fetches remote assets, or executes a cell.
- Render Markdown with raw HTML disabled and code as escaped text.
- Permit only escaped text, JSON, PNG, JPEG, and WebP output representations.
- Drop HTML, JavaScript, SVG, widget state, custom MIME types, and Markdown attachments.
- Preserve the original only as an explicit reviewed attachment with its SHA-256 checksum.

## Explicit execution eligibility

Execution is never triggered by page load, preview, publication, analysis, MCP, or an automated reader. It requires all of these:

1. an authenticated same-origin request;
2. a database-backed rate-limit grant;
3. a published repository and exact published revision;
4. a reviewed `.ipynb` path from that immutable revision;
5. a ready trusted runtime and locally pinned executor image.

Official tutorial “Open in Colab” links remain external handoffs. They are not Super ii compute and appear only for checked-in tutorials with stable public source paths.

## One-shot execution boundary

The trusted host launches one disposable container per run with:

- an exact image digest recorded in Postgres;
- UID and GID `65532:65532`;
- no network namespace connectivity and no shared IPC;
- a read-only root filesystem and read-only immutable repository workspace;
- all Linux capabilities dropped and `no-new-privileges` enabled;
- no runtime, transfer, database, Clerk, payment, or user secrets in its environment;
- explicit CPU, memory, PID, open-file, per-cell, result-size, and wall-clock limits;
- a bounded writable `/tmp` and a session-scoped output mount only.

The executor validates the notebook again, refuses more than 200 code cells, fails on cell errors, truncates oversized text items, omits oversized rich items, limits total outputs, and rejects an oversized final notebook. The host verifies the result receipt and complete SHA-256 digest, locks the output read-only, and records the terminal session state transactionally.

Only the requesting profile can retrieve a successful result. Results are integrity-checked again before download and expire after 24 hours. Failed, missing, oversized, timed-out, or receipt-mismatched results remain unavailable.

## Claim boundary

This boundary materially reduces risk for reviewed public notebooks, but a same-kernel Docker container is not a hostile multi-tenant security boundary. Super ii does not advertise arbitrary package installation, privileged containers, user-selected images, notebook write-back, background kernels, widgets, custom renderers, or microVM-grade isolation. Hostile public-code execution requires a dedicated host plus a stronger sandbox such as a reviewed microVM design.
