// Android Chrome restriction tables. Intentionally conservative for initial
// Android support: only hard physical-device limits are blocked. Everything the
// Playwright _android Chrome context supports is left untouched.

// Page methods that cannot work on a physical Android device.
const UNSUPPORTED_PAGE_METHODS = {
  setViewportSize: 'physical device viewport — use device-pool selection instead',
};

module.exports = {
  UNSUPPORTED_PAGE_METHODS,
};
