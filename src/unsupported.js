// Platform-restriction APIs throw loudly instead of silently acking `{}` at
// the bridge (which would let a test pass while the action did nothing). Only
// hard iOS limits are blocked here. Implementation-in-progress gaps (clock,
// console/pageerror, evaluateHandle, exposeFunction,
// tracing, recordVideo, route/waitForResponse/networkidle/extraHTTPHeaders,
// requestGC, worker, accessibility, screenshot{clip}) are NOT blocked — they
// have tracking issues + tripwire specs and will become real support, so
// blocking them at the fixture would fight a future fix. addInitScript ships
// with a cross-origin after-load caveat warning (see defineCaveatWarning).

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

function defineThrowing(target, kind, methods) {
  for (const [name, why] of Object.entries(methods)) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: false,
      value: () => {
        throw new Error(`${kind}.${name}() is unsupported on iOS Safari — ${why}.`);
      },
    });
  }
}

// addInitScript works, but iOS Safari drops the before-load bootstrap across a
// cross-origin process swap (even on a paused provisional target), so the
// bridge replays the script into the committed document: before-load on
// same-origin navigations, after-load on the first cross-origin document. Warn
// once per worker so a test relying on strict before-load timing across origins
// knows why it may observe post-load state. Does not block — the API is real.
const ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT =
  'addInitScript runs before-load only on same-origin navigations; ' +
  'after a cross-origin hop the script is replayed into the committed ' +
  'document and runs after-load on that first cross-origin page.';

function defineCaveatWarning(proto, kind, name, why) {
  const original = proto[name];
  if (typeof original !== 'function' || original.__iosCaveatWrapped) return;
  let warned = false;
  const wrapped = function (...args) {
    if (!warned) {
      warned = true;
      console.warn(`${kind}.${name}() on iOS Safari — ${why}`);
    }
    return original.apply(this, args);
  };
  wrapped.__iosCaveatWrapped = true;
  Object.defineProperty(proto, name, { configurable: true, writable: true, value: wrapped });
}

function blockUnsupportedContextAPIs(context) {
  defineThrowing(context, 'BrowserContext', UNSUPPORTED_CONTEXT_METHODS);
}

module.exports = {
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_LOCATOR_METHODS,
  UNSUPPORTED_MOUSE_METHODS,
  ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT,
  defineThrowing,
  defineCaveatWarning,
  blockUnsupportedContextAPIs,
};
