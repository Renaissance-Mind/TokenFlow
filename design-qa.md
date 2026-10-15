# TokenFlow popup widget editor design QA

final result: passed

Date: 2026-10-15. Selected visual truth: `desktop/design/widget-editor/option-2-canvas.png`, the second generated image displayed to the user. This is an implementation in the existing Electron App and Settings window, not a separate website/prototype.

## Evidence and normalization

- Source: 1536 × 1024 PNG, normalized to 1440 × 960, saved locally as `desktop/test-results/widget-reference-normalized.png`.
- Implementation: `desktop/test-results/desktop-widget-editor-drag.png`, 1440 × 960 CSS/pixel capture, density 1, from the signed packaged App's isolated acceptance run. The same state has the library open, overview/trend/models selected, and models lifted above the trend insertion point.
- Full-view comparison: `desktop/test-results/widget-comparison-full.png`, 2880 × 960, source on the left and implementation on the right; inspected together in one image input.
- Focused comparison: `desktop/test-results/widget-comparison-detail.png`, two 500 × 500 crops of actual preview cards, labels, chart, insertion line, and lifted card. Inspected together.
- Resting editor: `desktop/test-results/desktop-widget-editor.png`. All three default cards and the component count fit at 1440 × 960.
- Responsive evidence: `desktop/test-results/desktop-widget-editor-1000.png` and `desktop-widget-editor-800.png`. At narrower sizes the library overlays the preview and can be closed; toolbar actions remain reachable without horizontal document overflow.
- Installed App: `/Applications/TokenFlow.app`, version 0.1.15, native capture `desktop/test-results/installed-widget-editor.png` (2880 × 1896 pixels at density 2, 1440 × 948 logical window). This is additional live synced-data verification, not the normalized visual comparison target. Personal native captures stay ignored/local.

## Findings

No remaining actionable P0/P1/P2 findings.

- **Fonts and typography:** preserved the App's macOS/PingFang settings typography and canonical Dashboard Inter/chart typography. Clear 25px editor title, 21px library title, 13px card names, 28px preview headline values, and muted supporting text. Labels and default controls do not wrap at desktop width. Canonical Dashboard headings/units intentionally retain the same definitions as the full Dashboard.
- **Spacing and layout rhythm:** light sidebar, focused narrow preview, controls outside each card, right drawer, and blue insertion line follow the selected layout. The drawer starts below the native toolbar. Toolbar stays compact and controls remain visible. Preview cards were compacted so the normal three-widget layout and its count fit. Additional widgets scroll inside the canvas; library scrolls independently.
- **Colors/tokens:** white/slate settings surfaces, blue actions and insertion marker, muted borders, teal Dashboard brand/source marker, and canonical blue/orange charts preserve the selected direction. The Settings shell stays light even when the preview is dark. Hover, keyboard focus, disabled/added, unsaved, saving, and saved states are visible.
- **Assets/icons/image quality:** retained the real TokenFlow brand and canonical Dashboard charts; new controls use vendored Feather SVG files with the MIT license. Library miniatures are real ECharts views of the brokered data, not decorative approximations. The lifted card uses a sharp capture of its real library chart and preserves the card's title/description. No rasterized page or generated illustration replaces interactive UI.
- **Copy/content:** App controls follow the shared English/Chinese preference immediately, including the editor and preview. The source mock's inconsistent English/Chinese labels and illustrative usage/model values are intentionally replaced by localized product controls and actual data. Zero values/empty charts in isolated tests are expected; the installed App displays synced real usage without another login.
- **Accessibility/interactions:** named native buttons, real search/select controls, visible focus indicators, arrow-key reorder, Escape cancellation, added-state disabling, and protection of the last remaining widget. The embedded preview is read-only and has no Electron credential/settings API. Editing controls remain in the parent Settings page.

## Comparison history

1. Initial native inspection found the Done action wrapping at desktop width, a drawer starting below the editor toolbar, and an off-center search icon (P2). Fixed explicit select/action widths, full-height drawer placement, and search icon alignment. Later packaged full-view evidence shows a single desktop toolbar row and aligned library header/search.
2. Initial pointer tests exposed native drag events being swallowed at the frame boundary (P1). Replaced native cross-frame drag with parent-owned pointer capture and parent-owned handles/drop feedback; canonical chart nodes stay in the unprivileged frame. Actual library-to-preview drag, reordering, cancellation, and keyboard equivalents pass.
3. The early preview had excessive section heading spacing and a permanently visible end drop zone, pushing the normal component count below the canvas (P2). Reduced heading/panel/spark/chart spacing, and show the end target only while dragging. Re-captured resting and drag states. The resting default layout now shows all three cards and its count; the drag state has a clear insertion line and lifted chart card.
4. Replaced an initial text-only drag label with a lifted component card (P2). The final focused comparison shows the real thumbnail chart, title, description, and elevation; the original slot dims while dragging.

## Validation

- `npm run build --prefix desktop`: passed (CLI 0.2.75, App 0.1.15).
- `npm test --prefix desktop`: 18 tests passed, including widget order/deduplication/migration.
- Source Electron smoke: passed. Packaged App smoke: passed after the final visual changes, using an isolated copy outside the repository.
- Acceptance exercises all eight widgets; adding/removing; actual pointer dragging from the library and within the preview; arrow keys; Escape cancel; English/Chinese updates while a draft exists; range/theme preview; saving; reloading; actual popup order; nonempty protection; and unchanged CLI configuration.
- Parent/preview renderer error checks passed. Bundled offline chart/assets and the narrow broker operate in the packaged App.
- Existing native full-screen/Spaces regression passed: popup stays interactive without activating the full Dashboard or switching Spaces. Source tests also passed placement checks on both connected displays.
- Installed App signature verified with `codesign --verify --deep --strict`. Live Settings shows version 0.1.15 and the existing shared CLI 0.2.75. Synced data appears in the actual preview. Existing App preferences and hashed CLI identity/credential/connection fields match the private backup.

## Follow-up polish

- Source mock uses a six-dot handle; Feather Move is the available consistent outline handle used here.
- Continuous edge scrolling while holding a pointer stationary can be refined later. Current drag moves scroll at the canvas edge, and the canvas can also be scrolled with a wheel/trackpad.

## Implementation checklist

- [x] Match the chosen editor composition in the existing window.
- [x] Use real Dashboard widgets/data and preserve existing preferences.
- [x] Complete add/remove/reorder/search/defaults/save/reload flows.
- [x] Verify responsive, loading, empty, language, theme, focus, and saved states.
- [x] Compare full and focused rendered evidence, fix P0/P1/P2 findings, and re-capture.
- [x] Build, sign, package-test, install, and launch the real App.
