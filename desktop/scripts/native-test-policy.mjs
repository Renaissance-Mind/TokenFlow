const isolated = process.env.GITHUB_ACTIONS === 'true' || process.env.TOKENFLOW_TEST_DISPLAY_ISOLATED === '1';
const foregroundApproved = process.env.TOKENFLOW_ALLOW_FOREGROUND_TESTS === '1';

if (!isolated && !foregroundApproved) {
  throw new Error('Native UI tests can activate windows and take desktop focus. Run on an isolated CI runner/display (TOKENFLOW_TEST_DISPLAY_ISOLATED=1), or set TOKENFLOW_ALLOW_FOREGROUND_TESTS=1 only after explicit approval for this foreground test.');
}
