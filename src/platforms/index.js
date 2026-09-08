/** Map capabilities.platformName to a platform driver. */

/** Return the driver for platformName. Default is iOS. */
function selectDriver(platformName) {
  const platform = String(platformName || '').toLowerCase();
  if (platform === 'android') return require('./android/driver');
  if (platform === 'ios' || platform === '') return require('./ios/driver');
  throw new Error(
    `Unsupported capabilities.platformName='${platformName}'. Expected 'iOS' or 'Android'.`,
  );
}

module.exports = { selectDriver };
