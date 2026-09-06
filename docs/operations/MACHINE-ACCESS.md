# Machine access configuration

The approved Cloudflare configuration rule is active in the `superii.site` zone:

- Name: `Super ii machine routes - browser integrity exception v1`
- Rule ID: `099f15f878fe40aea5807eb4841c5abc`
- Only setting: **Browser Integrity Check off** for matching requests.
- Authentication, rate limits, WAF, DDoS and other controls remain active.

The initial API/MCP exception was completed on 2026-09-06 after default Python
requests showed Error 1010 on discovery documents, A2A and the signed Skill
bundle. Both the canonical domain and its `www` alias need the same machine
paths because the public handoff links through `www`.

Current expression:

```text
(http.host in {"superii.site" "www.superii.site"} and (
  starts_with(http.request.uri.path, "/api/")
  or http.request.uri.path eq "/mcp"
  or starts_with(http.request.uri.path, "/mcp/")
  or starts_with(http.request.uri.path, "/a2a/")
  or starts_with(http.request.uri.path, "/.well-known/")
  or starts_with(http.request.uri.path, "/schemas/")
  or starts_with(http.request.uri.path, "/skills/superii/")
  or http.request.uri.path in {"/llms.txt" "/llms-full.txt" "/robots.txt" "/sitemap-index.xml" "/sitemap.xml" "/runtime-registry.json" "/openapi.json" "/docs.json" "/system-state.json" "/system-state.md" "/agent-connectors.json" "/siiwebskill.md"}
  or ends_with(http.request.uri.path, "/manifest.json")
  or ends_with(http.request.uri.path, "/use.json")
  or ends_with(http.request.uri.path, "/README.md")
  or ends_with(http.request.uri.path, "/agents.md")
  or ends_with(http.request.uri.path, "/use.md")
  or ends_with(http.request.uri.path, "/use.ipynb")
  or ends_with(http.request.uri.path, "/use.sh")
  or ends_with(http.request.uri.path, "/profile.json")
  or ends_with(http.request.uri.path, "/api")
  or ends_with(http.request.uri.path, "/mcp")
))
```

Verify with `python3 tools/check_machine_access.py` after each website release.
This reads discovery, performs public MCP/A2A reads and confirms a protected Work
read is denied without a token. It creates no repository or content fixture.

Rollback: disable this named rule in Cloudflare **Rules → Overview**. This
restores the zone's browser check on these paths and may block ordinary clients
again. The expression grants no repository or publication authority.
