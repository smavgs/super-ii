# Machine access configuration

The approved Cloudflare configuration rule is active in the `superii.site` zone:

- Name: `Super ii machine routes - browser integrity exception v1`
- Rule ID: `099f15f878fe40aea5807eb4841c5abc`
- Only setting: **Browser Integrity Check off** for matching requests.
- Authentication, rate limits, WAF and DDoS protections remain active.

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

## Bot Fight Mode

On 2026-09-08, a real GitHub Actions request to
`/api/trusted-publishing/github/exchange` received a Managed Challenge from
**Bot Fight Mode** (Ray `a37b3fca88c1c090`). The GitHub publishing verification
stopped before a successful token exchange. This was a separate edge protection
from the scoped Browser Integrity Check rule.

[Cloudflare documents](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
that Free-plan Bot Fight Mode cannot exclude API routes or be skipped by WAF
custom rules. After explicit user approval, Bot Fight Mode was turned off for
the `superii.site` zone. A dashboard reload confirmed the setting remained off;
Browser Integrity Check remained enabled with its existing scoped exception,
and managed WAF rules and HTTP DDoS protection remained active. Repository
authentication, scopes, central publication policy and application rate limits
were unchanged.

Rollback: turn **Security → Settings → Bot fight mode** on. This may challenge
legitimate software clients again. Rerun the manual GitHub publication workflow
as well as the local machine-access check after any change: success from one
network alone does not establish access from hosted automation.
