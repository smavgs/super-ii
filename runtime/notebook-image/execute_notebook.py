from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath

import nbformat
from nbclient import NotebookClient


def bounded_path(raw: str) -> Path:
    relative = PurePosixPath(raw)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise ValueError("notebook path is unsafe")
    root = Path("/workspace").resolve(strict=True)
    target = (root / Path(*relative.parts)).resolve(strict=True)
    if not target.is_relative_to(root) or target.is_symlink() or target.suffix.lower() != ".ipynb":
        raise ValueError("notebook path is not a regular .ipynb file")
    return target


def bound_outputs(notebook: object) -> None:
    output_count = 0
    for cell in notebook.cells:
        if cell.cell_type != "code":
            continue
        outputs = list(cell.get("outputs", []))
        output_count += len(outputs)
        if output_count > 200:
            raise ValueError("notebook generated too many outputs")
        for output in outputs:
            if isinstance(output.get("text"), str) and len(output["text"]) > 100_000:
                output["text"] = output["text"][:100_000] + "\n[truncated by Super ii]"
            data = output.get("data")
            if isinstance(data, dict):
                for mime, value in list(data.items()):
                    encoded = json.dumps(value, ensure_ascii=False)
                    if len(encoded.encode("utf-8")) > 1_000_000:
                        data[mime] = "[output omitted by Super ii: item exceeds 1 MB]"


def main() -> None:
    notebook_path = bounded_path(os.environ["SUPERII_NOTEBOOK_PATH"])
    cell_timeout = int(os.environ.get("SUPERII_NOTEBOOK_CELL_TIMEOUT", "120"))
    result_max_bytes = int(os.environ.get("SUPERII_NOTEBOOK_RESULT_MAX_BYTES", "10485760"))
    if notebook_path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("input notebook exceeds 10 MB")
    notebook = nbformat.read(notebook_path, as_version=4)
    nbformat.validate(notebook)
    if sum(cell.cell_type == "code" for cell in notebook.cells) > 200:
        raise ValueError("notebook exceeds 200 code cells")
    client = NotebookClient(
        notebook,
        timeout=cell_timeout,
        interrupt_on_timeout=True,
        allow_errors=False,
        kernel_name="python3",
        resources={"metadata": {"path": str(notebook_path.parent)}},
    )
    client.execute()
    bound_outputs(notebook)
    output = nbformat.writes(notebook, version=4).encode("utf-8")
    if len(output) > result_max_bytes:
        raise ValueError("executed notebook exceeds the result size limit")
    target = Path("/output/executed.ipynb")
    target.write_bytes(output)
    print(
        json.dumps(
            {
                "status": "succeeded",
                "result_bytes": len(output),
                "result_sha256": hashlib.sha256(output).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
