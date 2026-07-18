// iOS Safari restriction tables. Only hard iOS limits are blocked. Implementation-in-progress
// gaps (clock, console/pageerror, evaluateHandle, exposeFunction, tracing, recordVideo,
// route/waitForResponse/networkidle/extraHTTPHeaders, requestGC, worker, accessibility,
// screenshot{clip}) are NOT blocked — they will become real support. addInitScript ships
// with a cross-origin after-load caveat warning rather than a block.

// BrowserContext methods that cannot work on a shared physical device.
// Page.setCookie also hard-bricks the WebProcess inspector pump, and the
// cookie jar is shared across all tests in a worker (no per-test wipe).
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

// Page methods that silently no-op on the physical device.
const UNSUPPORTED_PAGE_METHODS = {
  setViewportSize: 'physical device viewport — use device-pool selection instead',
  emulateMedia: 'iOS system-level setting — faked CSS would misreport Safari\'s real layout',
  hover: 'iOS Safari has no hover; touch devices fire pointer events on tap only',
  setInputFiles: 'native file picker is not driveable cleanly on a shared device',
};

// Locator methods that silently no-op on the physical device.
const UNSUPPORTED_LOCATOR_METHODS = {
  hover: 'iOS Safari has no hover; touch devices fire pointer events on tap only',
  setInputFiles: 'native file picker is not driveable cleanly on a shared device',
};

// Mouse methods that have no iOS input modality. Only wheel is blocked;
// down/move/up still drive the buffer-and-flush click path.
const UNSUPPORTED_MOUSE_METHODS = {
  wheel: 'iOS has no wheel/trackpad input modality — scroll via touch (scrollIntoViewIfNeeded / evaluate(scrollBy))',
};

// addInitScript works, but iOS Safari drops the before-load bootstrap across a
// cross-origin process swap (even on a paused provisional target), so the
// bridge replays the script into the committed document: before-load on
// same-origin navigations, after-load on the first cross-origin document.
const ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT =
  'addInitScript runs before-load only on same-origin navigations; ' +
  'after a cross-origin hop the script is replayed into the committed ' +
  'document and runs after-load on that first cross-origin page.';

module.exports = {
  UNSUPPORTED_CONTEXT_METHODS,
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_LOCATOR_METHODS,
  UNSUPPORTED_MOUSE_METHODS,
  ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT,
};
