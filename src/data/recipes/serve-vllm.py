import argparse
import os
from dataclasses import replace
from pathlib import Path

from superii import Client, hardware
from superii.model import Model
from superii.planner import plan
from superii.recipes import Recipe
from superii.recipes.contracts import canonical, digest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Unverified NVIDIA vLLM; base generator only')
    parser.add_argument('--enable-unverified-gpu', action='store_true', required=True)
    parser.parse_args()
    token = os.environ.get('SUPERII_APP_TOKEN', '')
    if len(token) < 32:
        raise ValueError('Set a random application token of 32+ characters')
    machine = hardware()
    if machine.accelerator != 'cuda':
        raise ValueError('An available NVIDIA CUDA host is required')
    value = Recipe.read().document
    value['outcome'] = 'api'
    value['template']['id'] = 'superii-api-vllm'
    value['inputs']['embedding'] = None
    value['inputs']['dataset'] = None
    value['target'] = {'accelerator': 'cuda', 'python': '3.12', 'runtime': 'vllm'}
    value['dependencies'] = {'superii-sdk': '0.2.0', 'vllm': '0.28.0', 'torch': '2.13.0'}
    value['verification']['hardware'] = []
    value['recipe_sha256'] = digest({k: v for k, v in value.items() if k != 'recipe_sha256'})
    recipe = Recipe(value)
    record = Path('superii-vllm-recipe.json')
    if record.exists():
        raise ValueError('Use a new directory for a new GPU experiment')
    with Client() as client:
        manifest = recipe.inspect('generator', client)
        allowed = recipe.document['inputs']['generator']['files']
        manifest = replace(manifest, files=tuple(f for f in manifest.files if f.path in allowed))
        selected = plan(manifest, machine, runtime='vllm', context_size=recipe.config['context_size'])
        snapshot = recipe.acquire('generator', client, selected_files=selected.files)
        record.write_bytes(canonical(value) + b'\n')
        record.chmod(0o600)
        with Model(snapshot, selected) as model:
            model.serve(port=8765, token=token)
