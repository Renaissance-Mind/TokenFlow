# Login dialog design

Generated with the built-in imagegen tool. Reference: `reference.png`.

## Prompt

Use case: ui-mockup
Asset type: high fidelity TokenFlow desktop sign-in dialog design reference, 1536x1024 landscape.
Primary request: Design an elegant restrained sign-in modal for an existing token usage analytics desktop app. Center a compact 420px-wide white modal over a dimmed soft-gray dashboard. App uses understated blue accents (#3d79f3), graphite text, thin gray dividers, modern crisp sans-serif typography and generous spacing. Native macOS desktop feel. Top toolbar in background says Dashboard with small sign-in icon on left, refresh, cloud-sync and settings outline icons on right, all icon-only. Behind overlay subtle analytics, no distracting marketing content.
Modal: upper-right small X icon; small TokenFlow concentric arc logo at top in blue; heading exact text "Sign in to TokenFlow"; subtitle exact text "Your usage, across every device."; central two equal rounded-square outlined provider buttons side by side, black GitHub Octocat icon and multicolor Google G icon only, no text inside buttons. Small muted label above buttons "Continue with". Below generous whitespace thin divider, a small outlined browser icon and text "Secure sign-in opens in your browser."; bottom understated text action "Continue locally". No email fields, no password fields, no extra providers. Maintain visual hierarchy and legible text, subtle shadow, 20px corner radius, polished real implementable UI.
Constraints: a single composition, front-facing flat screen, no laptop frame, no hands, no 3D, no watermarks.

## Implementation and verification

The dialog is implemented with native HTML controls and inline SVG provider marks. The generated bitmap is a visual reference, not a runtime UI asset.

- `implemented-light.png`, `implemented-dark.png`, `implemented-zh.png`: real Electron screenshots using the isolated smoke-test profile and its empty local usage data.
- Desktop build and all 18 desktop unit/integration tests passed.
- Real Electron smoke passed: startup spinner hides placeholder statistics, completed empty data displays zero, icon labels, dialog focus containment and Escape/focus restoration, local continuation, English/Chinese, light/dark themes, and existing dashboard/settings/tray checks.
- GitHub/Google controls call the existing desktop OAuth bridge. External provider account authorization was not completed during this UI acceptance.
