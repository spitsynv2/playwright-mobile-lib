/** Android Chrome page.bridge proxy and Page prototype patches. */
const { recordAction } = require('../../core/telemetry');
const { defineThrowing } = require('../../core/unsupported');
const { BRIDGE_CALL_SENTINEL, bridgeCall: farmBridgeCall } = require('../../core/bridge-rpc');
const { makeAppiumProxy } = require('../ios/appium');
const { UNSUPPORTED_PAGE_METHODS } = require('./unsupported-android');

/**
 * Sends a bridge operation through the shared Android RPC.
 */
function bridgeCall(page, op, args = {}) {
  return farmBridgeCall(page, op, args, 'Android');
}

/**
 * Returns a page.bridge proxy that sends each call to the Android bridge.
 */
function makeBridgeProxy(page) {
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      return (args = {}) => recordAction('bridge', `page.bridge.${prop}`, args, () => bridgeCall(page, prop, args));
    },
  });
}

const patchedAndroidPrototypes = new WeakSet();

/**
 * Patches Page and Locator prototypes with Android bridge and Appium accessors.
 */
function ensureAndroidPrototypesPatched(probePage) {
  const PageProto = Object.getPrototypeOf(probePage);
  if (patchedAndroidPrototypes.has(PageProto)) return;
  defineThrowing(PageProto, 'Page', UNSUPPORTED_PAGE_METHODS);
  Object.defineProperty(PageProto, 'bridge', {
    configurable: true,
    get() { return makeBridgeProxy(this); },
  });
  // Android has no Appium input-mode flip. locator.appium.tap() calls the Playwright action.
  Object.defineProperty(PageProto, 'appium', {
    configurable: true,
    get() { return makeAppiumProxy(this, this, 'page.appium', { appiumInputModeEnabled: false }); },
  });

  if (typeof probePage.locator === 'function') {
    const probeLocator = probePage.locator('html');
    const LocatorProto = Object.getPrototypeOf(probeLocator);
    Object.defineProperty(LocatorProto, 'appium', {
      configurable: true,
      get() { return makeAppiumProxy(this, this.page(), 'locator.appium', { appiumInputModeEnabled: false }); },
    });
  }
  patchedAndroidPrototypes.add(PageProto);
}

module.exports = {
  BRIDGE_CALL_SENTINEL,
  bridgeCall,
  makeBridgeProxy,
  ensureAndroidPrototypesPatched,
};
