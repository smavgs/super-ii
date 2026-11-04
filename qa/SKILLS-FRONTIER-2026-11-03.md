# Skills, Frontier AI and shared navigation

## Design intent

Visual thesis: carry Workspace's yellow, navy, cyan and violet pixel controls into two compact, practical agent-tool pages, with original provider marks and readable prompt previews.

Content plan: put search and useful jobs first on Skills; put the actual connection path and three setup steps first on Frontier AI. Keep the directory's existing contents in a narrow dropdown.

Interaction thesis: show details only after selection, open the chosen tool during the click, preserve the complete prompt, and explain when a paste or installed desktop app is needed.

## Source and handoff boundaries

- The operator supplied the `agent skills` collection in Documents: 1,642 use cases across 11 categories, collected 2026-10-27. Prompts are content, never executed during import. Each imported entry retains its source link. Reported use cases are not independent execution tests.
- Cursor documents its HTTPS prompt bridge at https://prod.cursor.com/docs/reference/deeplinks. VS Code documents its agents/new draft and vscode.dev/redirect bridge at https://code.visualstudio.com/docs/configure/command-line, but the actual browser handoff returned “The request is blocked.” during review. It was removed from the picker.
- The installed Codex app's deep-link parser accepts codex://new?prompt=, also observed on Parallel's onboarding dropdown. This is locally verified app behavior, not a documented universal web contract. Mobile and long prompts use the Codex web destination plus the complete clipboard prompt.
- Prompt links open drafts or provider pages. Super ii cannot guarantee a provider account, installed app, integration permission or task result. Clipboard failure and popup blocking retain a manual full-prompt fallback.
- Native same-origin view transitions keep the assistant launcher visually stable in supporting browsers; ordinary navigation remains the fallback. Reduced motion disables the transition. No SPA router or conversation transport changes are needed.

## Verification

- Supplied-source SHA-256: `e2acb07659dd40b84d3e3eb3eda5a70eb36da12f00fafb972f3d09d6994339a3`. All 1,642 source prompts and source URLs match the served catalog. Trailing hyphens in nine source slugs are normalized for the existing route contract.
- The local Worker returns 2,021 skills: 258 upstream, 121 existing packaged entries, and 1,642 sourced use cases. Search covers all entries; initial rendering is 48 cards, Show more adds another 48 and focuses the first new card, and empty search recovers through Clear search.
- Initial live verification exposed a returning-browser stale catalog (379 items), while both origin APIs already returned 2,021. The client now uses a versioned catalog request to avoid reusing the previous release's browser cache. Public `/api/skills` remains unchanged.
- 28,208 packaged skill/tool/device plans and 32,336 plans over the complete current catalog preserve exact prompt text or select a full-prompt clipboard fallback. Tests include Unicode, long encoded URLs, denied/delayed clipboard, blocked popups and safe source URLs. API tests exercise fresh, hit, stale and packaged-only fallback without production data.
- Eight retained tools: ChatGPT, Claude, Grok, Gemini, Microsoft Copilot, DeepSeek, Codex and Cursor. Cursor's real bridge displayed the exact complete prompt. Gemini's copy-and-open opened its composer and left submission to the user. DeepSeek's composer and Copilot's sign-in page also loaded. VS Code's documented bridge returned a blocked page and was removed. Provider task execution is not claimed; Codex's native route was inspected locally, not used to start an unrelated task.
- Rendered Chrome review at 840, 390 and 1,728 CSS pixels: no horizontal page overflow; menu width 384 pixels on desktop and 366 pixels at 390, original groups/links retained, Escape restores focus. The original header icon renders from the static 192-square asset at a square display size.
- Mobile dark mode uses navy Workspace surfaces. The full-prompt dialog and two Code choices fit the viewport. Navigation between Frontier AI and Skills keeps the same launcher label and 152-pixel mobile box; reduced motion retains normal navigation. Physical iOS/Android and every browser's transition behavior are not independently verified.
- Frontier's single-open setup disclosure, `/connect` clipboard command, device-local progress persistence and reset were exercised without requesting a provider key or calling its model. Local preview is anonymous and lacks Clerk client keys; member access will be checked through the existing production session.
- `npm run check`: zero errors and zero warnings, with five existing hints. Full build, existing contract checks, new launch/API checks and release-file secret scan pass.

Release and live evidence is kept in the operator's Documents folder `superii-skills-frontier-2026-11-03`. No production fixtures, messages, credentials or task submissions were created.
