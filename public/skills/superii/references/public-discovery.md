# Public discovery

## Preferred interfaces

- MCP: `https://superii.site/mcp`
- Search: `GET https://superii.site/api/search`
- System state: `GET https://superii.site/system-state.json`
- Connector registry: `GET https://superii.site/agent-connectors.json`
- A2A Agent Card: `GET https://superii.site/.well-known/agent-card.json`

## Repository representations

For a canonical repository at `/{kind}/{owner}/{slug}`, request:

- `README.md` for the public card
- `agents.md` for repository-specific instructions
- `manifest.json` for the immutable release manifest
- `api` for the structured repository document
- `mcp` for its MCP resource descriptor
- `use.json`, `use.md`, `use.ipynb`, or `use.sh` for reviewed model-use guidance when available

The public MCP exposes narrow search and read tools. Prefer its structured filters for task, library, license, modality, author, size, recency, hardware, operating system, RAM, and VRAM.

## Download verification

1. Resolve the exact reviewed file and record its revision ID, path, size, and lowercase hexadecimal SHA-256.
2. Download from the returned Super ii URL.
3. Hash the completed bytes locally.
4. Reject and remove or quarantine mismatched bytes. Do not retry execution.
