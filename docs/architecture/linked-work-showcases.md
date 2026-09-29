# Linked work and public showcase architecture

This release adds two free public-profile benefits without weakening the
reviewed repository path.

## Two truthful origins

`Reviewed on Super ii` means the content is a native Super ii repository whose
files and exact revision passed the normal publication controls. `External ·
Hugging Face` means Super ii verified the owner namespace and re-read bounded
metadata for a public exact revision, while every file remains on Hugging
Face. External cards use an outbound provider link and separately labelled
provider metrics. They never become a Super ii release merely by appearing in
search or on a profile.

Personal cards require a connected Hugging Face identity whose username
matches the repository namespace or an existing verified personal namespace
claim. Organization cards additionally require a current Super ii
owner/admin/maintainer role and a verified provider organization claim. A
server-side reinspection prevents the browser from supplying a false revision,
visibility, owner, file count or size.

## Curated public images

A personal profile, organization or individual Robot scope has three fixed
positions. Uploads follow this sequence:

1. the browser decodes, center-crops and re-encodes the chosen image as JPEG;
2. the Worker enforces origin, account, rate and 600 KB body limits;
3. the Worker strips JPEG metadata again, validates dimensions and hashes the
   final bytes;
4. the immutable UUID object is written to the private `SHOWCASE_MEDIA` R2
   binding; and
5. a narrow Postgres function verifies the owner and atomically allocates one
   of three positions.

If metadata persistence fails, the Worker deletes the just-written object.
Deleting a showcase first removes the authorized database reference and then
best-effort deletes the R2 object. Public reads never accept a raw R2 key: the
image route asks `resolve_public_showcase_media`, which returns a key only while
the owning profile/organization is public or the owning Robot is both public
and published.

## Security and abuse boundaries

- Mutation requests require the canonical browser origin and current Clerk
  profile.
- JSON and image bodies, text fields, counts, URLs, dimensions and bytes are
  bounded in both TypeScript and PostgreSQL.
- Only complete HTTPS links without embedded credentials are accepted.
- RLS and narrow security-definer functions keep web access inside the signed
  request context; payment, publishing and runtime roles receive no showcase
  authority.
- External-card, image-upload, image-edit/removal and Robot-showcase actions
  have separate rate-limit buckets.
- Provider files, access tokens and arbitrary remote images are never served
  through the public image gateway.

The migration smoke test exercises verified and rejected namespaces, the
three-image ceiling, collision-safe reordering, fail-closed public resolution,
Robot metadata/links, unlinking and deletion under the least-privilege web
role. Static contracts, TypeScript/Astro checks and the production build are
also release requirements.
