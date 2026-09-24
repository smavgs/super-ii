# Member Workspace

The `/account` page opens on the member's work. Its five sections are Your work,
AI setup, Agents, Agent commerce, and Account. The shared website navigation and
footer remain the entry points for the wider product.

The visual direction retains the existing yellow/navy palette, typography and
controls, with a compact title and readable work list. The content order is
existing work and activity first, optional setup second, detailed configuration
on request. Navigation selection, native disclosure expansion and restrained
hover/focus feedback provide the interaction cues; reduced-motion preferences
remove decorative transitions.

## Existing behavior, focused presentation

`MemberWorkspace.astro` renders the existing account data and components. The
page still authenticates through Clerk and reads through the existing contextual
database client. No storage schema, API permission, publication, agent-token or
payment policy changes are needed for this layout.

`workspace.ts` shows one section at a time without unmounting forms. Switching
sections preserves unsaved field values during the current visit; it does not
provide account-wide draft persistence. Browser history, direct section links,
AI Worker onboarding and Clerk's nested identity routes remain supported.

Repositories show their titles, identifiers, types and current revision status.
Search and type filters apply to the existing query's latest 50 repositories.
Six results appear initially, with more on request. Activity initially shows
three of the latest 20 notifications. Dates and read states remain visible;
historical notifications are not represented as current service-health checks.

Agent Starter and AI Worker share an exclusive disclosure group. Account settings
and configuration forms use the same native on-demand interaction. Existing
agents, submissions and commerce delegations appear before their creation forms.
Agent identity and job forms remain disabled until the existing organizations
API returns an organization the member owns or administers.

Desktop uses section links; narrow screens use a labelled native selector.
Section changes update the current navigation item and move focus to the section
heading when chosen by the member. With JavaScript disabled, all sections remain
available through ordinary anchors and native details elements.

## Personal product panels

The existing personal components are rendered in authenticated sections of their
product pages, with `Cache-Control: private, no-store` on signed-in responses:

| Previous Workspace destination | Current destination |
| --- | --- |
| `#robots` | `/robot#my-robots` |
| `#hardware` | `/robot#hardware` |
| `#robot-maintenance` | `/robot#robot-maintenance` |
| `#transparent` | `/transparent#my-reports` |
| `#organizations` | `/organizations#my-organizations` |

The robot plan gates, contextual database actor, ownership predicates and
existing mutation endpoints are retained. A data-load error is distinguished
from an empty personal list. These panels are not rendered for signed-out
visitors. The small `personal-work.ts` helper opens the containing disclosure
when an authenticated member follows a saved destination.

## Verification

`tools/check-workspace.mjs` exercises old bookmarks, safe fragment fallbacks,
onboarding, Clerk routes, and Unicode/type filtering. The normal build validation
includes these checks and retains the existing commerce, robot, transparency,
responsive-layout, localization and security contracts. Browser verification
covers section switching, native expansion, filtering, no-result states,
show-more controls, retained form inputs, prerequisite states and narrow layouts.
