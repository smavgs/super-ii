from __future__ import annotations

import asyncio
import os

TARGET_HOST = os.environ.get("SUPERII_SPACE_TARGET_HOST", "")
if not TARGET_HOST.startswith("superii-space-"):
    raise SystemExit("SUPERII_SPACE_TARGET_HOST is invalid")


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(64 * 1024):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def forward(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    try:
        app_reader, app_writer = await asyncio.open_connection(TARGET_HOST, 7860)
    except (OSError, ConnectionError):
        client_writer.close()
        await client_writer.wait_closed()
        return
    await asyncio.gather(
        pipe(client_reader, app_writer),
        pipe(app_reader, client_writer),
        return_exceptions=True,
    )


async def main() -> None:
    server = await asyncio.start_server(forward, "0.0.0.0", 7860)
    async with server:
        await server.serve_forever()


asyncio.run(main())
