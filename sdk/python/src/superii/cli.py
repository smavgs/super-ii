from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path


def main() -> None:
    from . import Client, hardware, load, plan
    from .experiments import benchmark

    parser = argparse.ArgumentParser(prog="superii")
    parser.add_argument("--base-url", default="https://superii.site")
    parser.add_argument("--cache-dir")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("hardware")
    recipe_command = commands.add_parser("recipe")
    recipe_command.add_argument("request_file", type=Path)
    recipe_command.add_argument("destination", type=Path)
    for name in ("inspect", "plan", "pull", "generate", "benchmark", "mcp", "serve"):
        sub = commands.add_parser(name)
        sub.add_argument("repository")
        sub.add_argument("--revision")
        if name in {"inspect", "pull"}:
            sub.add_argument("--kind", choices=["model", "dataset"], default="model")
        if name in {"plan", "generate", "benchmark", "mcp", "serve"}:
            sub.add_argument("--runtime", choices=["llama.cpp", "mlx", "transformers", "vllm"])
            sub.add_argument("--context-size", type=int, default=4096)
        if name in {"generate", "benchmark"}:
            sub.add_argument("prompt")
            sub.add_argument("--max-tokens", type=int, default=128)
        if name == "serve":
            sub.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.command == "hardware":
        print(json.dumps(asdict(hardware()), indent=2))
        return
    options = {"base_url": args.base_url, "cache_dir": args.cache_dir}
    if args.command == "recipe":
        from .recipes.exports import export_project

        if args.request_file.stat().st_size > 16384:
            parser.error("Recipe request exceeds 16 KiB")
        with Client(**options) as client:
            print(
                export_project(
                    json.loads(args.request_file.read_text()),
                    destination=args.destination,
                    client=client,
                )
            )
        return
    if args.command in {"inspect", "pull"}:
        with Client(**options) as client:
            result = getattr(client, args.command)(
                args.repository, revision=args.revision, kind=args.kind
            )
        print(json.dumps(asdict(result), indent=2, default=str))
    elif args.command == "plan":
        print(
            json.dumps(
                asdict(
                    plan(
                        args.repository,
                        revision=args.revision,
                        runtime=args.runtime,
                        context_size=args.context_size,
                        **options,
                    )
                ),
                indent=2,
            )
        )
    else:
        with load(
            args.repository,
            revision=args.revision,
            runtime=args.runtime,
            context_size=args.context_size,
            **options,
        ) as model:
            if args.command == "mcp":
                model.serve_mcp()
            elif args.command == "serve":
                import os

                token = os.environ.get("SUPERII_SERVING_TOKEN", "")
                if len(token) < 32:
                    parser.error(
                        "Set SUPERII_SERVING_TOKEN to a random local token (32+ characters)"
                    )
                model.serve(port=args.port, token=token)
            elif args.command == "benchmark":
                print(
                    json.dumps(benchmark(model, args.prompt, max_tokens=args.max_tokens), indent=2)
                )
            else:
                print(model.generate(args.prompt, max_tokens=args.max_tokens))
