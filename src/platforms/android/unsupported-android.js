/** Android Chrome restriction tables for physical-device limits. */

const UNSUPPORTED_PAGE_METHODS = {
  setViewportSize: 'physical device viewport — use device-pool selection instead',
};

// Context options that launchBrowser() cannot take.
const UNSUPPORTED_USE_OPTIONS = {
  storageState: 'launchBrowser() does not take it — restore the cookies yourself with context.addCookies(), which Android allows',
  clientCertificates: 'launchBrowser() does not take them',
  video: 'the farm records the session video — use extraContextOptions.recordVideo for a per-context recording',
};

module.exports = {
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_USE_OPTIONS,
};
