# Home, notifications and machine view

## Design intent

Visual thesis: preserve the yellow opening poster and Super ii's pixel controls;
add small charcoal/grey pixels and a black-to-grey headline, with no blue in
either effect. The headline, logo, content and hero dimensions stay familiar.

Content plan: keep the public homepage hierarchy; put a compact notification
bell immediately before the theme control; offer Human / Machine as two views
of the same public page. Private work stays within authenticated work tools.

Interaction thesis: slow, stepped pixel movement behind the hero; a brief bell
ring for new unread activity; direct navigation between human and readable
machine content. Reduced motion stops decorative animation. No permanent ring,
automatic read-on-open, sound, or copied private content in public views.

## Verification

Local verification completed:

- Astro check: zero errors/warnings (five existing hints).
- Full build/validation: passed, including Worker conversion tests and release
  security/secret scans.
- All 45 migrations applied twice to disposable PostgreSQL 17; the complete
  agent connection, creator, sharing, Ollama, product, Workroom, communications,
  robot and notification integration suite passed.
- New notification checks cover exact inquiry retries, explicit read vs pending
  work, foreign-user denial, removed membership and admin demotion, Workroom
  state, private helper invocation denial and 37-event cursor pagination.
- Chrome: 54 monochrome pixels animate on yellow, the headline uses only
  black/grey stops, and both Human/Machine views render. At 390×844 neither view
  overflows; the switch is separated from the assistant control. Copy agent
  instruction confirms success. The anonymous local preview has no production
  database credentials; signed-in bell and real catalogue checks remain part
  of deployment verification.

Release status: migration, Worker deployment, signed-in live review and final
GitHub checks are pending. No production fixtures were created.
