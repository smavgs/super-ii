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
- Every required automated check, including full-history Gitleaks scanning,
  must pass before merge. Known historical findings are limited to exact,
  reviewed fingerprints; paths, rules, and future matches are never broadly
  exempted.

While `@smavgs` is the only trusted maintainer, the project lead may use the
repository administrator merge path only after every required automated check
is green and the pull-request evidence is retained. This narrow exception is
needed because a pull-request author cannot independently approve their own
change; it does not authorize direct pushes or bypass failed checks. After a
second trusted maintainer is appointed, Super ii will require independent
approval from that maintainer, enforce the rule for administrators, and require
signed commits.

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
