# Super ii Governance

Super ii is publicly developed and maintainer-governed. The public repository
is the collaboration surface; production authority remains separate.

## Roles

- **Project lead** — sets product direction, appoints maintainers, controls the
  brand, production accounts, releases, billing, and emergency response.
- **Maintainers** — review pull requests, triage issues, uphold security and
  evidence standards, and merge changes within their assigned areas.
- **Contributors** — propose changes through issues and pull requests. A merged
  contribution does not automatically grant repository or production access.

The current project lead and required code owner is `@smavgs`.

## Decisions and merges

- `main` is protected. Changes use pull requests and required automated checks.
- External changes require approval from a code owner. Stale approvals are
  dismissed after material changes.
- Force pushes and branch deletion are disabled for `main`.
- Security, authentication, authorization, database, publication, payment,
  runtime, workflow, and deployment changes require explicit maintainer review.
- PyPI and production-verification workflows use protected environments and
  remain separate from ordinary contributor permissions.

Small reversible decisions are made in pull requests. Material architecture,
protocol, governance, license, privacy, or trust-boundary changes should begin
with a public proposal unless disclosure would expose an unresolved security
issue.

## Maintainer access

Write access is earned through sustained, high-quality reviewed contributions
and responsible handling of security boundaries. Access follows least
privilege, is reviewed periodically, and may be reduced or revoked. New
contributors should use forks; direct write access is not required to
participate.

## Conflicts and conduct

Maintainers must disclose material conflicts when reviewing a change. Everyone
participating in the project must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
