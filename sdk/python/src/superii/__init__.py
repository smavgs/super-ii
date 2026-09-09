"""Super ii: inspect, plan, verify and run immutable local models."""

from __future__ import annotations

from .client import Client, Peer, Snapshot
from .errors import IntegrityError, PlanError, SuperiiError
from .hardware import Hardware, hardware
from .manifest import Manifest
from .model import Model
from .planner import Plan
from .planner import plan as _plan

__version__ = "0.2.2"
__all__ = [
    "Client",
    "Peer",
    "Snapshot",
    "IntegrityError",
    "PlanError",
    "SuperiiError",
    "Hardware",
    "hardware",
    "Manifest",
    "Model",
    "Plan",
    "inspect",
    "plan",
    "pull",
    "apull",
    "verify",
    "load",
]


def inspect(
    repository: str, *, revision: str | None = None, kind: str = "model", **client_options
) -> Manifest:
    with Client(**client_options) as client:
        return client.inspect(repository, revision=revision, kind=kind)


def plan(
    repository: str | Manifest,
    *,
    machine: Hardware | None = None,
    runtime: str | None = None,
    context_size: int = 4096,
    revision: str | None = None,
    **client_options,
) -> Plan:
    manifest = (
        repository
        if isinstance(repository, Manifest)
        else inspect(repository, revision=revision, **client_options)
    )
    return _plan(manifest, machine or hardware(), runtime=runtime, context_size=context_size)


def pull(
    repository: str,
    *,
    revision: str | None = None,
    kind: str = "model",
    files: tuple[str, ...] | None = None,
    **client_options,
) -> Snapshot:
    with Client(**client_options) as client:
        return client.pull(repository, revision=revision, kind=kind, files=files)


async def apull(
    repository: str,
    *,
    revision: str | None = None,
    kind: str = "model",
    files: tuple[str, ...] | None = None,
    **client_options,
) -> Snapshot:
    with Client(**client_options) as client:
        return await client.apull(repository, revision=revision, kind=kind, files=files)


def verify(snapshot: Snapshot) -> bool:
    return snapshot.verify()


def load(
    repository: str,
    *,
    revision: str | None = None,
    runtime: str | None = None,
    context_size: int = 4096,
    lazy_weights: bool = False,
    **client_options,
) -> Model:
    with Client(**client_options) as client:
        manifest = client.inspect(repository, revision=revision)
        selected = _plan(manifest, hardware(), runtime=runtime, context_size=context_size)
        snapshot = client.pull(repository, revision=selected.revision, files=selected.files)
    return Model(snapshot, selected, lazy_weights=lazy_weights)
