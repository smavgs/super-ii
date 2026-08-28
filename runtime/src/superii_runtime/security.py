from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from .settings import Settings, get_settings


def require_runtime_auth(
    x_superii_runtime_token: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    try:
        expected = settings.require_runtime_token()
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="runtime authentication is not configured",
        ) from error
    supplied = x_superii_runtime_token or ""
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid runtime credential",
        )


RuntimeAuth = Annotated[None, Depends(require_runtime_auth)]
