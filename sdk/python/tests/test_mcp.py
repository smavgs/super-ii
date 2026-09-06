from __future__ import annotations

import asyncio
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def test_stdio_mcp_initialization_discovery_and_bounded_inference_tool():
    # Real protocol/transport; inference itself is independently smoke-tested.
    program = """
from superii.serving import serve_mcp
class LocalModel:
    def generate(self, prompt, max_tokens=256):
        return 'local:' + prompt[:max_tokens]
serve_mcp(LocalModel())
"""

    async def exercise():
        async with stdio_client(
            StdioServerParameters(
                command=sys.executable,
                args=["-c", program],
            )
        ) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                tools = await session.list_tools()
                assert [tool.name for tool in tools.tools] == ["generate"]
                result = await session.call_tool("generate", {"prompt": "hello", "max_tokens": 3})
                assert not result.isError
                assert result.content[0].text == "local:hel"
                invalid = await session.call_tool("generate", {"max_tokens": 3})
                assert invalid.isError

    asyncio.run(asyncio.wait_for(exercise(), timeout=15))
