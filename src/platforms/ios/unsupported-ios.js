/** Restriction tables for iOS Safari APIs that the physical device cannot honor. */

const UNSUPPORTED_CONTEXT_METHODS = {
  cookies: 'shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump',
  addCookies: 'shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump',
  clearCookies: 'shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump',
  storageState: 'includes cookies from the shared device jar — no per-context isolation to read or restore',
  grantPermissions: 'permissions are owned by iOS Settings + system prompts, not per-context on a shared device',
  clearPermissions: 'permissions are owned by iOS Settings + system prompts, not per-context on a shared device',
  setGeolocation: 'real GPS — override needs physical movement or an Xcode dev profile',
  setOffline: 'only airplane mode toggles offline, which kills the inspector WebSocket',
};

const UNSUPPORTED_PAGE_METHODS = {
  setViewportSize: 'physical device viewport — use device-pool selection instead',
  emulateMedia: 'iOS system-level setting — faked CSS would misreport Safari\'s real layout',
  hover: 'iOS Safari has no hover; touch devices fire pointer events on tap only',
  setInputFiles: 'native file picker is not driveable cleanly on a shared device',
};

const UNSUPPORTED_LOCATOR_METHODS = {
  hover: 'iOS Safari has no hover; touch devices fire pointer events on tap only',
  setInputFiles: 'native file picker is not driveable cleanly on a shared device',
};

// This table blocks only `wheel`. `down`, `move`, and `up` still drive the click path.
const UNSUPPORTED_MOUSE_METHODS = {
  wheel: 'iOS has no wheel/trackpad input modality — scroll via touch (scrollIntoViewIfNeeded / evaluate(scrollBy))',
};

// Playwright injects `use` into every `newContext` call. The fixture reports these.
const UNSUPPORTED_USE_OPTIONS = {
  storageState: 'the shared device cookie jar cannot be read or restored — sign in through the UI or inject a token in the test',
  httpCredentials: 'Emulation.setAuthCredentials is a bridge stub — send extraHTTPHeaders: { Authorization } for preemptive Basic auth',
  proxy: 'the device reaches the network on its own path',
  ignoreHTTPSErrors: 'Safari owns certificate trust on the device',
  javaScriptEnabled: 'Safari owns this in iOS Settings',
  bypassCSP: 'the bridge cannot disable CSP on the device',
  acceptDownloads: 'an iOS download is a native flow, not a Playwright download',
  viewport: 'the device owns its viewport — select a device with capabilities.deviceName',
  screen: 'the device owns its screen — select a device with capabilities.deviceName',
  deviceScaleFactor: 'the device owns its scale factor — select a device with capabilities.deviceName',
  isMobile: 'the device is already mobile — select a device with capabilities.deviceName',
  hasTouch: 'the device is already touch-driven — select a device with capabilities.deviceName',
  userAgent: 'Safari owns its user agent — select a device with capabilities.deviceName',
  locale: 'set the language in iOS Settings',
  timezoneId: 'set the time zone in iOS Settings',
  geolocation: 'real GPS — an override needs physical movement or an Xcode dev profile',
  permissions: 'permissions are owned by iOS Settings and system prompts',
  offline: 'only airplane mode takes the device offline, which drops the inspector WebSocket',
  colorScheme: 'set appearance in iOS Settings',
  reducedMotion: 'set motion preferences in iOS Settings',
  forcedColors: 'set accessibility colors in iOS Settings',
  contrast: 'set contrast in iOS Settings',
  video: 'the farm records the session video and attaches it to the report',
  recordVideo: 'the farm records the session video and attaches it to the report',
};

/** Warning text for `addInitScript` after a cross-origin navigation. */
const ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT =
  'addInitScript runs before-load only on same-origin navigations; ' +
  'after a cross-origin hop the script is replayed into the committed ' +
  'document and runs after-load on that first cross-origin page.';

module.exports = {
  UNSUPPORTED_CONTEXT_METHODS,
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_LOCATOR_METHODS,
  UNSUPPORTED_MOUSE_METHODS,
  UNSUPPORTED_USE_OPTIONS,
  ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT,
};
