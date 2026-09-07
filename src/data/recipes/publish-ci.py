import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from superii.recipes import Recipe
from superii.recipes.publication import publish

if __name__ == '__main__':
    recipe = Recipe.read()
    records = [p for p in Path('runs').glob('*/superii-run.json')
               if (r := json.loads(p.read_text())).get('recipe_sha256') == recipe.sha256
               and r.get('stage') == 'train' and r.get('status') == 'completed']
    if len(records) != 1:
        raise ValueError('Use exactly one completed training record from this CI job')
    url = urlsplit(os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'])
    if url.scheme != 'https' or not url.hostname.endswith('.actions.githubusercontent.com'):
        raise ValueError('Expected the GitHub Actions OIDC endpoint')
    query = dict(parse_qsl(url.query)); query['audience'] = 'https://superii.site'
    repository_id = os.environ['SUPERII_DESTINATION_ID']
    with httpx.Client(trust_env=False, follow_redirects=False, timeout=60) as http:
        response = http.get(urlunsplit(url._replace(query=urlencode(query))),
                            headers={'authorization': 'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
        response.raise_for_status()
        oidc = response.json()['value']
        response = http.post('https://superii.site/api/trusted-publishing/github/exchange',
                             headers={'authorization': 'Bearer '+oidc},
                             json={'repository_id': repository_id, 'scopes': ['repository:read', 'repository:upload', 'repository:commit', 'repository:submit']})
        response.raise_for_status()
        token = response.json()['access_token']
    print(json.dumps(publish(recipe, records[0], repository_id, token=token, submit=True), indent=2))
