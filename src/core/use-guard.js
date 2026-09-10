/** Guard for Playwright use options that a device cannot apply. */
// Warn on a local pre-flight as well. Pre-flight must predict the device run.

/** Launch options the farm owns on iOS and Android. */
const UNSUPPORTED_LAUNCH_OPTIONS = {
  browserName: 'the device browser follows capabilities.platformName',
  defaultBrowserType: 'the device browser follows capabilities.platformName',
  headless: 'a device browser is always headed',
  channel: 'the device runs its installed browser build',
  launchOptions: 'the farm launches the device browser — use capabilities.args on Android',
  connectOptions: 'the library owns the connection — point PLAYWRIGHT_MOBILE_HUB_URL at the farm instead',
};

const warnedOptions = new Set();

function collect(source, prefix, table, flagged) {
  if (!source || typeof source !== 'object') return;
  for (const [key, alternative] of Object.entries(table)) {
    if (source[key] === undefined) continue;
    flagged.push({ option: `${prefix}${key}`, alternative });
  }
}

/** Warn once for each use option that a connected device cannot apply. */
function warnUnsupportedUseOptions(use, unsupportedContextOptions = {}) {
  const flagged = [];
  collect(use, 'use.', { ...UNSUPPORTED_LAUNCH_OPTIONS, ...unsupportedContextOptions }, flagged);
  collect(use && use.contextOptions, 'use.contextOptions.', unsupportedContextOptions, flagged);
  for (const { option, alternative } of flagged) {
    if (warnedOptions.has(option)) continue;
    warnedOptions.add(option);
    console.warn(
      `playwright-mobile-lib: ${option} is ignored on a real device run — ${alternative}.`,
    );
  }
  return flagged.map((entry) => entry.option);
}

module.exports = { UNSUPPORTED_LAUNCH_OPTIONS, warnUnsupportedUseOptions };
