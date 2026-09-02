'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BRIDGE_CALL_SENTINEL,
  bridgeCall,
  makeBridgeProxy,
} = require('../src/platforms/android/bridge-proxy');

// The Android bridge RPC is a sentinel string passed to page.evaluate, which
// the Go bridge intercepts. This fake records payloads and can fail a set
// number of evaluate calls before succeeding.
function fakeChromePage({ error, failTimes = 0 } = {}) {
  const payloads = [];
  let remaining = failTimes;
  return {
    payloads,
    waitCount: 0,
    async evaluate(payload) {
      payloads.push(payload);
      if (error && remaining > 0) {
        remaining -= 1;
        throw error;
      }
      const request = JSON.parse(payload.slice(BRIDGE_CALL_SENTINEL.length));
      return { ok: true, op: request.op, args: request.args };
    },
    async waitForTimeout() { this.waitCount += 1; },
  };
}

test('makeBridgeProxy forwards the op and args through the sentinel evaluate', async () => {
  const page = fakeChromePage();
  const result = await makeBridgeProxy(page).getDeviceInfo({ verbose: true });
  assert.deepEqual(result, { ok: true, op: 'getDeviceInfo', args: { verbose: true } });
  assert.ok(page.payloads[0].startsWith(BRIDGE_CALL_SENTINEL));
});

test('bridgeCall retries when a navigation destroys the execution context', async () => {
  const destroyed = new Error('Cannot find context with specified id because of a navigation');
  const page = fakeChromePage({ error: destroyed, failTimes: 3 });
  assert.deepEqual(await bridgeCall(page, 'getSessionId'), { ok: true, op: 'getSessionId', args: {} });
  assert.equal(page.waitCount, 3, 'it backs off once per failed attempt');
});

test('bridgeCall gives up after ten attempts and throws the last error', async () => {
  const destroyed = new Error('Execution context was destroyed');
  const page = fakeChromePage({ error: destroyed, failTimes: 50 });
  await assert.rejects(() => bridgeCall(page, 'getSessionId'), /Execution context was destroyed/);
  assert.equal(page.payloads.length, 10, 'it stops at the ten-attempt ceiling');
});

test('bridgeCall propagates a non-retryable error immediately', async () => {
  const closed = new Error('Target closed');
  const page = fakeChromePage({ error: closed, failTimes: 5 });
  await assert.rejects(() => bridgeCall(page, 'getSessionId'), /Target closed/);
  assert.equal(page.payloads.length, 1, 'a terminal error is not retried');
});
