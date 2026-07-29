// Warn-once check over the `use.*` options the connected device cannot honor.
// Local pre-flight runs warn too: pre-flight exists to predict the device run.

// True on both platforms: the farm owns browser selection and launch.
const UNSUPPORTED_LAUNCH_OPTIONS = {
  browserName: 'the device browser follows capabilities.platformName',
  defaultBrowserType: 'the device browser follows capabilities.platformName',
  headless: 'a device browser is always headed',
  channel: 'the device runs its installed browser build',
  launchOptions: 'the farm launches the device browser — use capabilities.args on Android',
  connectOptions: 'the library owns the connection — point PWM_ORCHESTRATOR at the farm instead',
};

const warnedOptions = new Set();

function collect(source, prefix, table, flagged) {
  if (!source || typeof source !== 'object') return;
  for (const [key, alternative] of Object.entries(table)) {
    if (source[key] === undefined) continue;
    flagged.push({ option: `${prefix}${key}`, alternative });
  }
}

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
