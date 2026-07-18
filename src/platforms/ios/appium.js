// Appium input-mode commands. The bridge defaults Input.dispatch* and
// Page.goBack/goForward to JS injection; page.appium.<method>(...) and
// locator.appium.<method>(...) flip the bridge's input mode to "appium" for one
// call, then restore the prior mode. The flip is owned by Page (per tab), so
// locator.appium uses locator.page() as the mode target.

// In-process bridge RPC: page.evaluate of a sentinel string the bridge
// intercepts and routes to its op handler. Lives here as the shared primitive
// for both the appium input-mode proxy and the page.bridge.<op> proxy.
const BRIDGE_CALL_SENTINEL = '__pwm_bridge_call__:';
const { recordAction } = require('../../core/telemetry');

// A navigation can destroy the main-frame execution context mid-evaluate; the
// bridge state the sentinel targets survives it, so re-resolve and retry rather
// than fail. Terminal closes ("Target closed") are not matched and propagate.
const RETRYABLE_EVAL_ERROR = /Execution context was destroyed|Cannot find context with specified id|Execution context is not available|because of a navigation/i;

async function bridgeCall(page, op, args = {}) {
  const payload = `${BRIDGE_CALL_SENTINEL}${JSON.stringify({ op, args })}`;
  let lastErr;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await page.evaluate(payload);
    } catch (err) {
      if (!RETRYABLE_EVAL_ERROR.test(err && err.message ? err.message : String(err))) throw err;
      lastErr = err;
      await page.waitForTimeout(100);
    }
  }
  throw lastErr;
}

function setInputMode(page, mode) {
  return bridgeCall(page, 'setInputMode', { mode });
}

async function withAppiumInputMode(page, fn) {
  const prev = await setInputMode(page, 'appium');
  try {
    return await fn();
  } finally {
    await setInputMode(page, prev || 'js');
  }
}

function setHitTestBypass(page, on) {
  return bridgeCall(page, 'setHitTestBypass', { on });
}

// Disable bridge hit-test blocking while a forced JS pointer action runs.
async function withHitTestBypass(page, fn) {
  const prev = await setHitTestBypass(page, true);
  try {
    return await fn();
  } finally {
    await setHitTestBypass(page, prev === true || prev === 'true');
  }
}

// Same proxy shape for Page and Locator: forwarded methods stay bound to
// the original receiver; the wrap flips mode for the duration of the call.
// Nested namespaces (page.mouse, page.keyboard, page.touchscreen) are
// recursively wrapped so chained calls like page.appium.mouse.down() also
// flip the bridge's input mode.
function makeAppiumProxy(receiver, page, path = 'page.appium') {
  return new Proxy({}, {
    get(_, prop) {
      const target = receiver[prop];
      const methodPath = `${path}.${String(prop)}`;
      if (typeof target === 'function') {
        return (...args) =>
          recordAction('appium', methodPath, { args }, () =>
            withAppiumInputMode(page, () => target.apply(receiver, args)),
          );
      }
      if (target && typeof target === 'object') {
        return makeAppiumProxy(target, page, methodPath);
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
  setHitTestBypass,
  withHitTestBypass,
  makeAppiumProxy,
};
