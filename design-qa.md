# TokenFlow light Settings QA

final result: passed

## Evidence

- Source visual: `docs/assets/settings-light-reference.png`, generated with built-in imagegen; exact prompt in `docs/assets/settings-light-prompt.md`.
- Rendered implementation: `docs/assets/settings-light-reading.png`.
- Full-view comparison: `docs/assets/settings-light-comparison.png` (source left, implementation right).
- Focused comparison of fields, switches, spacing and update actions: `docs/assets/settings-light-detail.png`.
- Source: 1536 × 1024 pixels. Implementation: 1440 × 960 pixels, CSS viewport 1440 × 960, deviceScaleFactor 1. Source uniformly normalized to 1440 × 960 before comparison.
- State: English, light Settings, signed-in account, startup enabled, automatic sync enabled, real operation in progress. The reference illustrates pricing; the capture runs actual CLI reading. These saved reference captures document the original operation presentation; the current build uses measured reading/fetching progress in the same strip. Runtime server URL and CLI paths reflect the isolated real Worker/CLI rather than the design's example values.

## Comparison history

1. Initial capture: [P2] spacing pushed the last App update action below the native viewport; [P2] the indeterminate animation briefly moved its entire fill outside the track.
2. Fixed account and preference spacing, added a compact-height layout for native windows under 920 CSS pixels, and changed the animation to keep a visible fill throughout the cycle.
3. Recaptured the implementation and inspected the full-view and focused comparison together with the generated reference. Both update actions fit in the native 1440 × 916 viewport. The color strip is visible in the revised active-state capture. No actionable P0/P1/P2 differences remain.

## Required fidelity surfaces

- Typography: native system/SF stack, 36px main title, 22px section headings, 14–16px controls; hierarchy, readable secondary text and line wrapping match the reference. Native font rasterization differs slightly from generated typography (P3).
- Spacing/layout: 252px navigation rail, main content starting at x310, open rows, two equal form columns and fine separators; reference and implementation section boundaries align within a few pixels after normalization. At 760px, navigation becomes a horizontal row and fields stack without horizontal overflow.
- Colors: fixed white light page, pale gray navigation/progress backgrounds, charcoal text, muted gray secondary text and restrained blue actions/progress. Settings remains light independently of Dashboard theme.
- Asset quality: the reference contains no illustrations or photos to reproduce. The wordmark is editable text, switches are functional controls and selects use native affordances. No rasterized interface, decorative stand-ins or image placeholders are used.
- Copy: labels and action names follow the reference; identity, server and CLI location remain real runtime values. Save is disabled during collection, as required by the shared CLI lock. The active operation label follows the real phase.

## Interaction and verification

- Same native BrowserWindow ID and bounds before/after opening Settings; Settings uses an embedded WebContentsView.
- Returning to Dashboard retains the same DOM and existing chart/filter state.
- While Settings is open, the covered Dashboard body is inert and hidden from accessibility; returning restores its controls. This was also checked after the native accessibility inspection.
- Section navigation, shared preference save, language change, login/logout/account switch and token configuration remain functional.
- Real scan displays processed/total files, bytes read and a measured progressbar. Native App 0.1.7 was observed at 303/1576 files, 968.4 MB and 19%, then completed all 1576 files. HTTP progress was checked against real streamed, compressed, length-known and chunked responses, plus failures and cancellation; download percentages retain the updater measurement.
- Progress disappears after the real operation completes; pending requests return to zero after authorization changes.
- Light theme, 1440 × 960 reference viewport, 1440 × 916 native height and 760 × 916 compact layout checked. No renderer errors in the design interaction check.
- Desktop unit suite, standalone/local smoke, real Worker/D1 authorization smoke and settings-design check passed.

## Follow-up polish

- [P3] Minor native text rasterization and switch-shadow differences from the generated bitmap.

## Implementation checklist

- [x] Generated reference saved with its prompt.
- [x] Light settings recreated in the original main window.
- [x] Real operation progress added to Settings, Dashboard and tray.
- [x] Full and focused comparisons inspected after the fixes.
- [x] Primary interactions, responsive layout and renderer errors checked.
