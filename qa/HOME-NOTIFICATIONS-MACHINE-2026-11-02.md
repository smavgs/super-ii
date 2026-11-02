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
  instruction confirms success. A separate disposable local notification
  preview verifies grouping, explicit read state, attention filters and reload.
  It has no production database credentials.

## Production verification

- Migration 0045 is applied: four new columns, 15 event triggers, restricted
  helper execution and the additional resource-access policy. The nine existing
  notifications remain nine; no historical backfill or production fixtures.
- Initial Worker deployment: `c931635c-438f-4a46-a955-9e1cbd6fd588`, serving both
  domains. Subsequent release versions and final CI are recorded with PR #151
  and the local release evidence directory.
- All 30 read-only checks passed across `superii.site` and `www.superii.site`:
  home, Markdown/JSON negotiation, readable Machine view, hosted model/dataset,
  curated Ollama files, profile, selected robot, guides and static assets.
  Anonymous notifications return 401/private/no-store. Signed-out Workspace
  stays an HTML login gate with no Machine switch or private content.
- Signed-in Chrome loads nine real unread notifications; opening the panel
  does not mark them read. The bell is red and immediately before the theme
  button. At 390 px the panel spans x=12 through x=378, with no page overflow.
  Escape closes the panel and returns focus to the bell. The live headline has
  only black/grey gradient stops and 54 small pixels on yellow.
- Live review found nested card labels needed flattening for valid Markdown
  links. The Worker regression check now verifies the complete card destination
  and sentence separation across inline spans.

Build, database, CPU recipe, DCO, secret scanning, Rust security and CodeQL checks
passed on the feature revision. Release sign-off additionally requires green
checks on the final revision and after merge; see
[PR #151](https://github.com/smavgs/super-ii/pull/151).

Operator-local evidence is in the Documents folder
`superii-home-notifications-machine-2026-11-02/`.
Notifications refresh every 30 seconds while active and on focus/reconnection;
this is not browser push. Mutating event tests use disposable local data, not
the member's production work or read state. External email conversations and
actions outside Super ii are not represented as observed events.
