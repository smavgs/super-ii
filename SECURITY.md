# Super ii Security Policy

## Report a vulnerability privately

Use the [Super ii security contact](https://superii.site/contact?interest=security)
or GitHub private vulnerability reporting. Do not include an undisclosed
vulnerability, exploit, credential, private user data, or production log in a
public issue or pull request.

Include the affected surface, reproduction steps, expected impact, and the
smallest safe evidence needed to verify the report. Do not access another
person's account or data, perform denial-of-service testing, transfer funds,
publish content, or persist access while testing.

We will acknowledge reports as capacity permits, investigate them in good
faith, and coordinate remediation and disclosure. This policy does not promise
a bounty or authorize activity prohibited by law or the Service terms.

## Supported versions

Security fixes target the current `main` branch and the current production
deployment. Historical commits, local forks, and third-party deployments are
not maintained by Super ii.

## Security boundaries

- Secrets belong in Cloudflare secrets, macOS Keychain, provider secret stores,
  or ignored local environment files—never Git.
- Browser identity is not trusted as authorization. Clerk identity, ownership,
  role, scope, expiry, revocation, target binding, and request origin are checked
  server-side.
- Uploads remain quarantined until path, size, checksum, malware, secret,
  serialization, format, provenance, and publication-policy checks complete.
- Unknown, missing, timed-out, or failed security evidence blocks publication.
- Agent, Social, Work, and commerce credentials are separate, hash-at-rest,
  expiring, revocable, and bounded to explicit authority.
- The public verification key, manifest format, checksums, and policy contract
  are intentionally public. Private signing keys and service credentials are not.
- Public source code is not production access. Deployment, database ownership,
  payment configuration, signing, and incident-response authority remain
  separately controlled.

The checked-in controls are defense in depth, not a claim that any online system
is perfectly secure. The staged database credential separation is documented in
[`docs/security/DATABASE-LEAST-PRIVILEGE.md`](docs/security/DATABASE-LEAST-PRIVILEGE.md).
See `SYSTEM-STATE.md` for evidence status and known limits.
