// Android Chrome restriction tables. Intentionally conservative for initial
// Android support: only hard physical-device limits are blocked. Everything the
// Playwright _android Chrome context supports is left untouched.

// Page methods that cannot work on a physical Android device.
const UNSUPPORTED_PAGE_METHODS = {
  setViewportSize: 'physical device viewport — use device-pool selection instead',
};

// Context options the launched Chrome context cannot take. Everything else the
// driver forwards from `use`, so a device run honors it like default Playwright.
const UNSUPPORTED_USE_OPTIONS = {
  storageState: 'launchBrowser() does not take it — restore the cookies yourself with context.addCookies(), which Android allows',
  clientCertificates: 'launchBrowser() does not take them',
  video: 'the farm records the session video — use extraContextOptions.recordVideo for a per-context recording',
};

module.exports = {
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_USE_OPTIONS,
};
