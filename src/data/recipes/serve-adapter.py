import argparse
import os
from pathlib import Path

import uvicorn
from superii import Client
from superii.recipes import Recipe
from superii.recipes.project import Project, create_app
from superii.recipes.training import load_adapter

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Serve a recorded CPU LoRA adapter locally')
    parser.add_argument('run_record', type=Path)
    args = parser.parse_args()
    recipe = Recipe.read()
    with Client() as client:
        project = Project(recipe, client=client)
        try:
            project.generator = load_adapter(recipe, client, args.run_record)
            app = create_app(project, token=os.environ.get('SUPERII_APP_TOKEN', ''), load_on_start=False)
            uvicorn.run(app, host='127.0.0.1', port=8000)
        finally:
            project.close()
