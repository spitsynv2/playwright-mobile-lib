/** Shared in-process bridge RPC for farm page.evaluate intercepts. */
const { resolveWsEndpoint } = require('./capabilities');

const BRIDGE_CALL_SENTINEL = '__pwm_bridge_call__:';

// Retry when a navigation destroys the evaluate context. Do not retry a closed target.
const RETRYABLE_EVAL_ERROR = /Execution context was destroyed|Cannot find context with specified id|Execution context is not available|because of a navigation/i;

function hasFarmBridge(platform) {
  return !!resolveWsEndpoint(platform);
}

function bridgeUnavailableError(op) {
  const name = op ? `page.bridge.${op}()` : 'a bridge call';
  const err = new Error(
    `${name} requires a real-device bridge — this worker is a local pre-flight.`,
  );
  err.name = 'BridgeUnavailableError';
  return err;
}

/** Send a farm bridge operation through page.evaluate. Throw when no farm is set. */
async function bridgeCall(page, op, args = {}, platform) {
  if (!platform) {
    throw new Error('bridgeCall requires a platform of "iOS" or "Android"');
  }
  if (!hasFarmBridge(platform)) {
    throw bridgeUnavailableError(op);
  }
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

module.exports = {
  BRIDGE_CALL_SENTINEL,
  hasFarmBridge,
  bridgeUnavailableError,
  bridgeCall,
};
