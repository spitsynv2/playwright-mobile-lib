'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BRIDGE_CALL_SENTINEL,
  bridgeCall,
  makeBridgeProxy,
  ensureAndroidPrototypesPatched,
} = require('../src/platforms/android/bridge-proxy');
const { withConnectEnv } = require('./helpers/connect-env');

const FARM = { PLAYWRIGHT_MOBILE_HUB_URL: 'wss://farm:7465/sessions' };

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

function makeAndroidPage() {
  const calls = [];
  const locatorProto = {
    page() { return page; },
    async tap(options) { calls.push(['locator.tap', options]); return 'locator-tapped'; },
  };
  const locator = Object.create(locatorProto);
  const pageProto = {
    locator() { return locator; },
    async tap(options) { calls.push(['page.tap', options]); return 'tapped'; },
    async evaluate() { calls.push(['evaluate']); },
    async waitForTimeout() {},
  };
  const page = Object.create(pageProto);
  return { page, locator, calls };
}

test.describe('farm Android bridge RPC', { concurrency: 1 }, () => {
  test('makeBridgeProxy forwards the op and args through the sentinel evaluate', async () => {
    await withConnectEnv(FARM, async () => {
      const page = fakeChromePage();
      const result = await makeBridgeProxy(page).getDeviceInfo({ verbose: true });
      assert.deepEqual(result, { ok: true, op: 'getDeviceInfo', args: { verbose: true } });
      assert.ok(page.payloads[0].startsWith(BRIDGE_CALL_SENTINEL));
    });
  });

  test('bridgeCall retries when a navigation destroys the execution context', async () => {
    await withConnectEnv(FARM, async () => {
      const destroyed = new Error('Cannot find context with specified id because of a navigation');
      const page = fakeChromePage({ error: destroyed, failTimes: 3 });
      assert.deepEqual(await bridgeCall(page, 'getSessionId'), { ok: true, op: 'getSessionId', args: {} });
      assert.equal(page.waitCount, 3, 'it backs off once per failed attempt');
    });
  });

  test('bridgeCall gives up after ten attempts and throws the last error', async () => {
    await withConnectEnv(FARM, async () => {
      const destroyed = new Error('Execution context was destroyed');
      const page = fakeChromePage({ error: destroyed, failTimes: 50 });
      await assert.rejects(() => bridgeCall(page, 'getSessionId'), /Execution context was destroyed/);
      assert.equal(page.payloads.length, 10, 'it stops at the ten-attempt ceiling');
    });
  });

  test('bridgeCall propagates a non-retryable error immediately', async () => {
    await withConnectEnv(FARM, async () => {
      const closed = new Error('Target closed');
      const page = fakeChromePage({ error: closed, failTimes: 5 });
      await assert.rejects(() => bridgeCall(page, 'getSessionId'), /Target closed/);
      assert.equal(page.payloads.length, 1, 'a terminal error is not retried');
    });
  });
});

test('Android page.bridge on a local pre-flight throws a dedicated error and does not evaluate', async () => {
  await withConnectEnv({}, async () => {
    const page = fakeChromePage();
    await assert.rejects(() => makeBridgeProxy(page).getSessionId(), (err) => {
      assert.equal(err.name, 'BridgeUnavailableError');
      assert.match(err.message, /real-device bridge/);
      return true;
    });
    assert.equal(page.payloads.length, 0);
  });
});

test('Android page.appium and locator.appium forward as Playwright actions', async () => {
  const { page, locator, calls } = makeAndroidPage();
  ensureAndroidPrototypesPatched(page);

  assert.equal(await page.appium.tap({ force: true }), 'tapped');
  assert.equal(await locator.appium.tap(), 'locator-tapped');
  assert.deepEqual(calls, [['page.tap', { force: true }], ['locator.tap', undefined]]);
});
