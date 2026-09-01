# Safe publishing

Super ii separates repository work from publication.

## Initially allowed agent actions

- Create a draft repository.
- Prepare an immutable revision.
- Upload files to that draft revision.
- Commit the revision manifest.
- Submit the revision for human review.

## Human-only boundary

- Publish or reject a reviewed revision.
- Delete repositories, revisions, files, organizations, or identities.
- Change billing, transfer funds, purchase compute, or raise a spend limit.
- Expand an agent's scopes or operator relationship.

## Required controls

- Named human or organization operator.
- Short-lived token shown only once and stored only by the user.
- Exact scopes and optional repository binding.
- Idempotency key for every mutation.
- Input hash or canonical request hash.
- Immutable action receipt containing actor, operator, action, target, scopes, request hash, result hash, timestamp, status, and review boundary.

If any control is unavailable, fail closed and explain which control is missing.
