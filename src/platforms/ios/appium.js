/** Sets Appium input mode for one `page.appium` or `locator.appium` call. */
const { recordAction } = require('../../core/telemetry');
const {
  BRIDGE_CALL_SENTINEL,
  hasFarmBridge,
  bridgeCall: farmBridgeCall,
} = require('../../core/bridge-rpc');

/** Sends one bridge RPC for this iOS page. */
function bridgeCall(page, op, args = {}) {
  return farmBridgeCall(page, op, args, 'iOS');
}

function setInputMode(page, mode) {
  return bridgeCall(page, 'setInputMode', { mode });
}

/**
 * Sets Appium input mode for one call, then restores the prior mode.
 */
async function withAppiumInputMode(page, fn) {
  if (!hasFarmBridge('iOS')) return fn();
  const prev = await setInputMode(page, 'appium');
  try {
    return await fn();
  } finally {
    await setInputMode(page, prev || 'js');
  }
}

function setHitTestBypassEnabled(page, enabled) {
  return bridgeCall(page, 'setHitTestBypassEnabled', { enabled });
}

/** Disables the bridge hit-test block for one forced pointer action. */
async function withHitTestBypass(page, fn) {
  if (!hasFarmBridge('iOS')) return fn();
  const prev = await setHitTestBypassEnabled(page, true);
  try {
    return await fn();
  } finally {
    await setHitTestBypassEnabled(page, prev === true || prev === 'true');
  }
}

/**
 * Forwards Page or Locator methods. Optionally sets Appium input mode for each call.
 * @param {boolean} [options.appiumInputModeEnabled=true] Set false to skip the input-mode flip.
 */
function makeAppiumProxy(receiver, page, path = 'page.appium', { appiumInputModeEnabled = true } = {}) {
  return new Proxy({}, {
    get(_, prop) {
      const target = receiver[prop];
      const methodPath = `${path}.${String(prop)}`;
      if (typeof target === 'function') {
        return (...args) =>
          recordAction('appium', methodPath, { args }, () =>
            appiumInputModeEnabled
              ? withAppiumInputMode(page, () => target.apply(receiver, args))
              : target.apply(receiver, args),
          );
      }
      if (target && typeof target === 'object') {
        return makeAppiumProxy(target, page, methodPath, { appiumInputModeEnabled });
      }
      return target;
    },
  });
}

module.exports = {
  BRIDGE_CALL_SENTINEL,
  bridgeCall,
  setInputMode,
  withAppiumInputMode,
  setHitTestBypassEnabled,
  withHitTestBypass,
  makeAppiumProxy,
};
