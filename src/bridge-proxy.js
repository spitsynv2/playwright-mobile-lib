// page.bridge.<op> proxy + one-time prototype patching that wires page.appium,
// page.bridge, page.setBrowsingMode, and the unsupported-API throwers onto the
// Playwright Page/Locator/Mouse/Context prototypes.
const { bridgeCall, makeAppiumProxy, withHitTestBypass } = require('./appium');
const { installForegroundScreenshotGate } = require('./screenshot-gate');
const { recordAction } = require('./telemetry');
const {
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_LOCATOR_METHODS,
  UNSUPPORTED_MOUSE_METHODS,
  ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT,
  defineThrowing,
  defineCaveatWarning,
} = require('./unsupported');

// Ops that leave the calling page's WebInspector WS dead (iOS Settings UI
// path terminates Safari's WebContent process). After such an op, any
// further command on the same page would sit on a dead pipe and time out
// (including the fixture's teardown goto about:blank). We close the page
// so teardown's live-page reset skips it and the next test gets a
// fresh context cleanly.
const PAGE_INVALIDATING_OPS = new Set(['clearSafariHistory']);

// A page-invalidating op kills the tab's WebContent process, so the bridge's
// "ok" can race the target teardown; page.evaluate then rejects with a close
// error instead of returning. For those ops the close IS the success signal.
const TARGET_CLOSED_ERROR = /Target (page, context or browser has been|closed)/i;
const WRAPPED_METHOD = Symbol('playwright-mobile-lib.wrapped-method');
const patchedPagePrototypes = new WeakSet();

// page.bridge.<op>(args?) forwards to the bridge's in-process op handler.
// Any op added in internal/handlers/bridge_call.go is auto-callable here —
// no per-op wiring needed in the fixture.
function makeBridgeProxy(page) {
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      return (args = {}) => recordAction('bridge', `page.bridge.${prop}`, args, async () => {
        const invalidating = PAGE_INVALIDATING_OPS.has(prop);
        let result;
        try {
          result = await bridgeCall(page, prop, args);
        } catch (err) {
          if (!invalidating || !TARGET_CLOSED_ERROR.test(err && err.message ? err.message : String(err))) throw err;
          result = 'ok';
        }
        if (invalidating) {
          try { await page.close(); } catch {}
        }
        return result;
      });
    },
  });
}

// Forced pointer actions temporarily bypass the bridge's hit-test block.
// The options object is last for both Page and Locator signatures.
const FORCE_CAPABLE_METHODS = ['click', 'dblclick', 'hover', 'tap', 'check', 'uncheck', 'setChecked'];
const NAVIGATION_METHODS = ['goto', 'reload', 'goBack', 'goForward'];

function wrapNavigationMethods(proto) {
  for (const name of NAVIGATION_METHODS) {
    const original = proto[name];
    if (typeof original !== 'function' || original[WRAPPED_METHOD]) continue;
    const wrapped = function (...args) {
      const params = name === 'goto' ? { url: args[0], options: args[1] } : { options: args[0] };
      return recordAction('playwright', `page.${name}`, params, () => original.apply(this, args));
    };
    Object.defineProperty(wrapped, WRAPPED_METHOD, { value: true });
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: wrapped,
    });
  }
}

function wrapForceCapableMethods(proto, resolvePage) {
  for (const name of FORCE_CAPABLE_METHODS) {
    const original = proto[name];
    if (typeof original !== 'function' || original[WRAPPED_METHOD]) continue;
    const wrapped = function (...args) {
      const opts = args[args.length - 1];
      const force = opts && typeof opts === 'object' && opts.force === true;
      if (!force) return original.apply(this, args);
      return withHitTestBypass(resolvePage(this), () => original.apply(this, args));
    };
    Object.defineProperty(wrapped, WRAPPED_METHOD, { value: true });
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: wrapped,
    });
  }
}

// Patched once per worker. Probes a real Page/Locator instance to grab
// their prototypes; the descriptor is reused by every later page +
// every locator drilled from any chain (locator.first()/.locator()/etc.).
function ensureAppiumPrototypesPatched(probePage) {
  const PageProto = Object.getPrototypeOf(probePage);
  if (patchedPagePrototypes.has(PageProto)) return;
  Object.defineProperty(PageProto, 'appium', {
    configurable: true,
    get() { return makeAppiumProxy(this, this); },
  });
  Object.defineProperty(PageProto, 'bridge', {
    configurable: true,
    get() { return makeBridgeProxy(this); },
  });
  // Switching tab groups spawns a fresh Safari tab the bridge adopts as a new
  // page; the switch can stale this page, so callers use the returned one.
  Object.defineProperty(PageProto, 'setBrowsingMode', {
    configurable: true,
    writable: true,
    value: function (mode, options = {}) {
      return recordAction('fixture', 'page.setBrowsingMode', { mode, options }, async () => {
        const timeout = options.timeout ?? 60_000;
        const [newPage] = await Promise.all([
          this.context().waitForEvent('page', { timeout }),
          bridgeCall(this, 'setBrowsingMode', { mode }),
        ]);
        return newPage;
      });
    },
  });
  wrapNavigationMethods(PageProto);
  wrapForceCapableMethods(PageProto, (page) => page);
  defineThrowing(PageProto, 'Page', UNSUPPORTED_PAGE_METHODS);
  defineCaveatWarning(PageProto, 'Page', 'addInitScript', ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT);
  installForegroundScreenshotGate(PageProto);

  const ContextProto = Object.getPrototypeOf(probePage.context());
  defineCaveatWarning(ContextProto, 'BrowserContext', 'addInitScript', ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT);

  const MouseProto = Object.getPrototypeOf(probePage.mouse);
  defineThrowing(MouseProto, 'Mouse', UNSUPPORTED_MOUSE_METHODS);

  const probeLocator = probePage.locator('html');
  const LocatorProto = Object.getPrototypeOf(probeLocator);
  Object.defineProperty(LocatorProto, 'appium', {
    configurable: true,
    get() { return makeAppiumProxy(this, this.page(), 'locator.appium'); },
  });
  wrapForceCapableMethods(LocatorProto, (locator) => locator.page());
  defineThrowing(LocatorProto, 'Locator', UNSUPPORTED_LOCATOR_METHODS);
  patchedPagePrototypes.add(PageProto);
}

module.exports = { makeBridgeProxy, ensureAppiumPrototypesPatched };
