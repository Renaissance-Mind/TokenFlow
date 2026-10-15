// Dashboard and Settings share the same native frame and control safe area.
export function renderWindowChrome(state) {
  document.documentElement.dataset.platform = state.windowChrome.platform;
  document.documentElement.dataset.fullScreen = String(state.windowChrome.fullScreen);
}
