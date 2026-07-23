// page.bridge.<op> proxy for the Android Chrome bridge. page.evaluate of a
// sentinel string is intercepted by the Go bridge and routed to its op handler,
// so any op added in internal/handlers/bridge_call.go is auto-callable here.
const { recordAction } = require('../../core/telemetry');

const BRIDGE_CALL_SENTINEL = '__pwm_bridge_call__:';

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

// page.bridge.<op>(args?) forwards to the bridge's in-process op handler.
function makeBridgeProxy(page) {
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      return (args = {}) => recordAction('bridge', `page.bridge.${prop}`, args, () => bridgeCall(page, prop, args));
    },
  });
}

module.exports = { BRIDGE_CALL_SENTINEL, bridgeCall, makeBridgeProxy };
