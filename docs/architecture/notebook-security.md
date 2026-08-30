# Static notebook security contract

Super ii treats every uploaded `.ipynb` file as untrusted publisher data. The public notebook reader is a static document viewer, not a kernel, sandbox, or execution service.

## Ingestion boundary

- Accept UTF-8 Jupyter `nbformat` 4 JSON only.
- Validate with pinned `nbformat` before publication review can pass.
- Enforce bounded file, notebook, cell, source, output, and embedded-image sizes.
- Never import repository modules, initialize a kernel, resolve widgets, fetch remote assets, or execute a cell.
- Store a normalized analysis document separately from the immutable original file.

## Rendering boundary

- Render Markdown with raw HTML disabled.
- Render code as escaped text; highlighting must not evaluate code.
- Permit only escaped text, JSON, PNG, JPEG, and WebP output representations.
- Drop HTML, JavaScript, SVG, widget state, custom MIME types, and Markdown attachments.
- Preserve the original file only as an explicit attachment download with its reviewed SHA-256 checksum.
- Keep repository notebooks inside the same content-security, human-review, and immutable-revision boundary as every other file.

## External execution

Super ii never labels external notebook execution as isolated Super ii compute. “Open in Colab” is offered only for checked-in official tutorials with stable public GitHub paths. Users leave Super ii, accept the external provider’s terms, and must review code before running it. User-uploaded notebooks do not receive a Colab link unless a future verified source mapping can prove the exact immutable content.

## Deliberate exclusions

There is no in-browser kernel, server kernel, arbitrary package installation, widget runtime, custom renderer, iframe output, notebook write-back, or trust flag. Adding any of those requires a new threat model and an isolation boundary stronger than this static reader.
