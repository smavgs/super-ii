from pathlib import Path

from superii_runtime.benchmarks import benchmark_storage


def test_storage_benchmark_has_bounded_provenance(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"benchmark bytes")
    result = benchmark_storage(source, 2)

    assert result["category"] == "storage"
    assert result["parameters"]["iterations"] == 2
    assert result["provenance"]["network_used"] is False
    assert len(result["provenance"]["source_sha256"]) == 64
    assert result["claim_scope"] == "local measurement only"
