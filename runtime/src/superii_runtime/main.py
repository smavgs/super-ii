from __future__ import annotations

import uvicorn

from .settings import get_settings


def run() -> None:
    settings = get_settings()
    settings.require_runtime_token()
    settings.require_database_url()
    uvicorn.run(
        "superii_runtime.api:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=False,
        server_header=False,
        access_log=True,
    )


if __name__ == "__main__":
    run()
