# Contributing to Super ii

Thank you for helping build open intelligence together. Super ii accepts
contributions through reviewed pull requests. Public access to the source does
not grant production, billing, database, publication, or deployment authority.

## Before starting

- Use an issue or discussion for substantial product, protocol, schema, or
  security-boundary changes.
- Report vulnerabilities privately under [SECURITY.md](SECURITY.md); do not
  open a public issue for an undisclosed vulnerability.
- Never include credentials, personal data, private model or dataset content,
  production logs, or copied material without compatible rights.
- Keep claims evidence-based. A successful execution test is not automatically
  a model-quality, performance, safety, or universal-hardware claim.

## Development setup

Prerequisites are Node.js 24, Python 3.12 with `uv`, Go 1.26, Rust 1.97,
Docker, and PostgreSQL 17 for the complete verification path.

```sh
npm ci
npm run check
npm run validate
npm run db:check
npm run db:test
npm run runtime:verify
npm run build
```

CI also runs checksum-verified Gitleaks 8.30.1 across complete Git history.
Three immutable historical synthetic fixtures are identified by exact
fingerprints; new or changed findings fail closed.

Focused changes may run the relevant subset while developing, but the complete
required GitHub checks must pass before merge. Tests must not depend on private
production credentials or mutate production services.

## Pull-request workflow

1. Fork the repository and create a focused branch.
2. Make the smallest coherent change and add or update tests.
3. Run formatting, validation, tests, and the production build appropriate to
   the changed area.
4. Use `git commit -s` to add a Developer Certificate of Origin sign-off.
5. Open a pull request using the repository template.
6. Address review and keep the branch current. Direct pushes to `main` are not
   part of the contribution workflow.

The project may close changes that weaken fail-closed publication, blur verified
and declared evidence, expose private data, silently expand agent authority, or
introduce unsupported product claims.

## Developer Certificate of Origin

Every contribution must include a `Signed-off-by` trailer certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). The
sign-off records that you have the right to submit the contribution under the
repository license; it is not a copyright assignment.

## License and brand

Contributions are accepted under the [Super ii Modified MIT License](LICENSE).
The Super ii name and logo remain governed separately by
[TRADEMARKS.md](TRADEMARKS.md).
