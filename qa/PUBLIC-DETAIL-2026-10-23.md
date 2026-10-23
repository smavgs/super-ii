# Public profile and repository detail refresh

## Scope

Public member profiles and model/dataset repository templates now share Workspace's pixel controls, compact spacing and yellow/navy palette. Profiles open on searchable published work, with type filters and separate sections for showcase, linked work and proposals. Repositories open on an overview beside release facts; full cards, files/versions, tools/data, evidence and community remain available through real anchors.

No database, authorization, publication, upload or execution contract changes. App repository layouts retain their existing navigation. The dependency lock also updates transitive `ip-address` from 10.7.1 to 10.7.4 for GHSA-rxp7-6hxx-x8q5, which the required npm audit discovered during release verification.

## Local verification

- `npm run check`: 0 errors, 0 warnings, 3 existing deprecation hints.
- `npm run build`: full repository validation, Astro build, built security check and release secret scan passed.
- `npm audit --omit=dev`: zero advisories after the compatible transitive patch.
- `git diff --check`: passed.
- Chrome rendered a disposable local preview using public repository documents for MiniCPM-V, LFM2.5 and MMMLU. Its database clients returned null; no credentials or production bindings were copied. The profile used representative public metadata with a placeholder avatar.
- Model and dataset navigation reveals the selected section. Direct `#files`, `#analysis`, `#card` and `#compatibility` links work; browser Back restores the preceding section. Keyboard section activation moves focus to its heading.
- Use Model focuses its heading; Build & Ship closes Use Model; closing Build & Ship returns focus to its opener. Selecting Files closes the open tool panel. Existing file download targets retain the file IDs and receive descriptive accessible names.
- Profile type and search filters return the correct cards; unmatched searches show a clear empty result. Proposals opens through keyboard activation.
- Dataset preview shows 10 rows at a time from the existing bounded 100-row preview. First, next and final pages work; end controls disable and move focus to the remaining enabled control. The table has its own bounded scrolling area, preserving multilingual cell direction and source text.
- No page overflow at 1366px desktop, 768px tablet and 320px mobile for the dataset viewer; the full model card and profile also fit at 320px. Light/dark layouts were inspected, including 390px mobile layouts.
- Russian profile and Chinese dataset labels render correctly; dynamic filter/page status is localized. Repository titles, member content and dataset cells keep their original language.
- With JavaScript disabled, every dataset section and all 100 preview rows remain available; pagination controls stay hidden. JavaScript was restored after the check.

## Boundaries

The default overview is compact. Full author-written cards can still be long when selected; nothing is truncated or discarded. These checks do not claim a full accessibility certification or revalidate model inference, paid services, downloads, or account mutations. Public showcase/linked-work components retain their existing rendering and data paths.

Release and production evidence is recorded separately after merge/deployment. No production test records were created.
