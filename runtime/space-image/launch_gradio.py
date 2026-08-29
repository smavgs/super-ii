from __future__ import annotations

import os
import runpy
from pathlib import Path

os.environ.update(
    {
        "GRADIO_ANALYTICS_ENABLED": "False",
        "GRADIO_SERVER_NAME": "0.0.0.0",
        "GRADIO_SERVER_PORT": "7860",
        "HF_HUB_OFFLINE": "1",
        "HF_DATASETS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "TRANSFORMERS_OFFLINE": "1",
    }
)

workspace = Path("/workspace")
entrypoint = workspace / "app.py"
if not entrypoint.is_file():
    raise SystemExit("Super ii Gradio contract requires /workspace/app.py")

namespace = runpy.run_path(str(entrypoint), run_name="superii_space")
demo = namespace.get("demo") or namespace.get("app")
if demo is None or not hasattr(demo, "launch"):
    raise SystemExit("app.py must expose a Gradio Blocks or Interface as `demo` or `app`")

demo.launch(
    server_name="0.0.0.0",
    server_port=7860,
    root_path=os.environ.get("SUPERII_SPACE_ROOT_PATH"),
    share=False,
    show_error=False,
    allowed_paths=[str(workspace)],
    blocked_paths=["/etc", "/proc", "/sys", "/run", "/var/run"],
)
