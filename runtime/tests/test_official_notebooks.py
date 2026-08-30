from __future__ import annotations

from pathlib import Path

import nbformat
import pytest

ROOT = Path(__file__).parents[2]
NOTEBOOKS = {
    "api": ROOT / "notebooks" / "getting-started" / "super-ii-api-and-mcp.ipynb",
    "dataset": ROOT / "notebooks" / "repositories" / "create-and-verify-a-dataset.ipynb",
    "evaluation": ROOT / "notebooks" / "evaluation" / "reproducible-model-evaluation.ipynb",
}
pytestmark = pytest.mark.skipif(
    not all(path.is_file() for path in NOTEBOOKS.values()),
    reason="official website notebooks are outside the standalone runtime deployment",
)


def code_cells(path: Path) -> list[str]:
    notebook = nbformat.read(path, as_version=4)
    nbformat.validate(notebook)
    return [cell.source for cell in notebook.cells if cell.cell_type == "code"]


def test_every_official_notebook_has_valid_python_syntax() -> None:
    for path in NOTEBOOKS.values():
        for index, source in enumerate(code_cells(path)):
            compile(source, f"{path.name}:cell-{index}", "exec")


def test_local_official_notebooks_execute_without_paid_services(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    for name in ("dataset", "evaluation"):
        namespace = {"__name__": f"superii_notebook_{name}"}
        for index, source in enumerate(code_cells(NOTEBOOKS[name])):
            exec(compile(source, f"{name}:cell-{index}", "exec"), namespace)
