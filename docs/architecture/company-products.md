# Company and product home

Release candidate tested locally. Production verification is pending; see the release evidence before treating the feature as deployed.

## Approved experience

A visitor can understand a product, find its technical resources, contact the right person, and give the same published information to an AI agent. One Workspace journey combines company, first product, preview and sharing. Existing manufacturers can present commercial products without publishing their source code. Models, robots, components and hardware use appropriate product labels; the existing repository and Robot planning paths remain available.

The user explicitly retained the existing three-successful-image-uploads lifetime allowance and deferred mainland mobile/WeChat testing. Reusing an existing organization image does not consume another upload. No production demo companies, products, contacts or inquiries are seeded.

## Visual and interaction plan

Visual thesis: the manufacturer's product and name lead within Super ii's familiar yellow/navy frame, with generous spacing and clear bilingual typography.

Content plan: product image and purpose; documented specifications and resources; company and representative contact; a compact share/agent/print section. Workspace starts at the working surface, with one editor section open at a time and an adjacent preview on wide screens.

Interaction thesis: selecting a section reveals only its controls; edited text updates the preview immediately; save, publish and copy actions give explicit feedback. Transitions are short and respect reduced motion. No decorative motion or invented product imagery is needed.

## Data and authority

- Company pages extend existing Organizations. Products belong to an Organization, never to the representative's personal Card. Owner/admin membership authorizes editing and publication.
- Draft and published JSON snapshots are separate, bounded and validated. Saving never edits the public snapshot. Expected version checks reject stale edits. Publishing atomically updates the approved company and product presentations; unpublishing is reversible.
- New Organizations created in this flow remain private until publication. Existing organizations keep their public state and their current presentation until the owner publishes a change.
- Public product facts are company-provided. An optional DNS TXT challenge can establish control of the exact website hostname. It does not verify the legal company, product quality, compatibility, safety or certification.
- The existing showcase pipeline, storage ceiling and lifetime upload counter are reused. Product pages choose organization images; no second quota or new remote-image copying service is introduced.
- Contact uses the company's selected public channels and an explicitly linked active representative Card. Existing Card pause/rotation/privacy behavior stays in place. This is not a new shared CRM or a message-sending agent.

## Entry and sharing

Public HTTPS website metadata can supply editable, source-labelled suggestions. Fetching is bounded, redirect-checked, credential-free and limited to public hosts; extraction reads metadata only, never follows page instructions or executes code. Manual entry is always available. Authenticated drafts can be saved and resumed across devices. A visitor does not need an account to read a published product.

The share kit uses a stable product URL, QR, existing contact Card and a printable English/Chinese sheet. Company-supplied translations remain distinct from the translated interface. JSON, Markdown, REST and read-only MCP use the same published snapshot. Product Q&A retrieves matching published fields/resources and reports missing information; it does not invent technical claims or execute a robot/SDK.

## Verification and release

Test real PostgreSQL roles for ownership, draft isolation, public reads, stale writes, publication, withdrawal, cross-company media/Card references and challenge binding. Exercise URL/redirect/body limits, malicious content, source suggestions and bounded evidence answers. Check live UI behavior with local test fixtures, keyboard use, English/Chinese, narrow screens, sharing and print layout. Run the required build/security/CI checks before release. Verify the deployed paths separately from source tests. Mainland networks, WeChat mobile completion and real exhibitor outcomes remain unverified until those tests are performed.
