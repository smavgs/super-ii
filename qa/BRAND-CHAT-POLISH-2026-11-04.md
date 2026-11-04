# Brand, chat and wrapping corrections

## Intent

Restore the familiar Sii artwork and Source Sans type while retaining the yellow pixel controls. Keep the existing header, hero, footer and assistant destinations. The menu remains narrow with its current groups and links; words must not split arbitrarily.

## Changes

- Header, hero and footer use the same original, hashed Sii artwork. A square, centred close crop removes the old percentage-grid stretching and avoids a runtime image transformation request.
- The assistant keeps the approved yellow and its original natural width, font, padding and bottom-left placement. Its contents have equal horizontal padding. Opening the menu no longer hides the button; the existing inert background and keyboard focus handling remain.
- The assistant markup appears early in its three existing pages. Native view-transition opt-in is available in the initial head, and the UI font is preloaded. There is no client-side router or conversation/backend change.
- Directory columns adapt to available space, with full-width Russian links. The Russian hero uses its available column and a phone-sized font so `сверхинтеллект` stays whole.

## Verification

- `npm run check`: zero errors and warnings, five existing hints. Full `npm run build`, contract checks and release-file secret scan pass.
- Chrome render checks at 320, 390, 840 and 1440 CSS pixels: no horizontal overflow. Documentation occupies one line at every size; menu widths are 296, 366, 384 and 384 pixels. The Russian word occupies one line at every size.
- Desktop assistant: Source Sans 3 at 17px, natural width 130.05px, equal 17px left/right padding and the existing 16px bottom/left inset. Phone: 16px type, 125.76px width, 12px bottom/left inset, unchanged between Skills and Frontier AI.
- Thirteen captured Chrome frames during home-to-Skills navigation retain the launcher. The measured button region remains present, with no blank frame. This does not establish universal behavior on physical iOS or Android devices or browsers without native view transitions.
- Escape closes the directory and restores focus. The chat is still lazily initialized; no messages or production fixtures were submitted.
- The preceding PR #152 merged successfully. Its post-merge dependency install timed out in the ONNX download; rerunning the failed job completed successfully, without a dependency or workflow change.

Read-only browser evidence and frame captures are in the operator's Documents folder `superii-brand-chat-2026-11-04`. Native transition reference: https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
