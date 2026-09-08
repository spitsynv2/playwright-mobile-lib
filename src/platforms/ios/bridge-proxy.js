/** Proxies `page.bridge` calls and patches Page, Locator, and Mouse prototypes. */
const { bridgeCall, makeAppiumProxy, withHitTestBypass } = require('./appium');
const { hasFarmBridge } = require('../../core/bridge-rpc');
const { installForegroundScreenshotGate } = require('./screenshot-gate');
const { recordAction } = require('../../core/telemetry');
const { defineThrowing, defineCaveatWarning } = require('../../core/unsupported');
const {
  UNSUPPORTED_PAGE_METHODS,
  UNSUPPORTED_LOCATOR_METHODS,
  UNSUPPORTED_MOUSE_METHODS,
  ADDINITSCRIPT_CROSS_ORIGIN_CAVEAT,
} = require('./unsupported-ios');

// These ops kill the tab WebContent process. Close the page after the call.
const PAGE_INVALIDATING_OPS = new Set(['clearSafariHistory']);

// The bridge can ack before Settings closes the tab. Treat a close error as success.
const TARGET_CLOSED_ERROR = /Target (page, context or browser has been|closed)|has been closed/i;
const WRAPPED_METHOD = Symbol('playwright-mobile-lib.wrapped-method');
const patchedPagePrototypes = new WeakSet();

async function closeInvalidatedPage(page) {
  if (typeof page.isClosed === 'function' && page.isClosed()) return;
  try {
    await page.close();
  } catch {}
}

/**
 * Forwards `page.bridge.<op>` to the bridge. A new bridge op is callable here.
 */
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
          await closeInvalidatedPage(page);
        }
        return result;
      });
    },
  });
}

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
      // The options object is last for Page and Locator signatures.
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

/**
 * Patches Page and Locator prototypes once per worker from a live page.
 */
function ensureAppiumPrototypesPatched(probePage) {
  const PageProto = Object.getPrototypeOf(probePage);
  if (patchedPagePrototypes.has(PageProto)) return;
  Object.defineProperty(PageProto, 'appium', {
    configurable: true,
    get() { return makeAppiumProxy(this, this, 'page.appium'); },
  });
  Object.defineProperty(PageProto, 'bridge', {
    configurable: true,
    get() { return makeBridgeProxy(this); },
  });
  // `setBrowsingMode` can stale this page. Use the returned page.
  Object.defineProperty(PageProto, 'setBrowsingMode', {
    configurable: true,
    writable: true,
    value: function (mode, options = {}) {
      return recordAction('fixture', 'page.setBrowsingMode', { mode, options }, async () => {
        if (!hasFarmBridge('iOS')) return this;
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
