'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  bridgeCall,
  setInputMode,
  withAppiumInputMode,
  withHitTestBypass,
  makeAppiumProxy,
} = require('../src/platforms/ios/appium');

const SENTINEL = '__pwm_bridge_call__:';

// A fake iOS bridge page: page.evaluate(sentinel) is the in-process RPC. The
// page tracks the current input mode and hit-test flag so setInputMode /
// setHitTestBypass can return the prior value the real bridge returns.
function fakeBridgePage({ evalError, failTimes = 0 } = {}) {
  const calls = [];
  let mode = 'js';
  let hitBypass = false;
  let remainingFailures = failTimes;
  return {
    calls,
    modeAt: [],
    async evaluate(payload) {
      if (evalError) {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw evalError;
        }
      }
      const request = JSON.parse(payload.slice(SENTINEL.length));
      calls.push(request);
      if (request.op === 'setInputMode') {
        const prev = mode;
        mode = request.args.mode;
        return prev;
      }
      if (request.op === 'setHitTestBypass') {
        const prev = hitBypass;
        hitBypass = request.args.on;
        return prev;
      }
      return { ok: true, op: request.op, modeSeen: mode };
    },
    currentMode() { return mode; },
    async waitForTimeout() {},
  };
}

test('bridgeCall serializes the op and args into the sentinel payload', async () => {
  const page = fakeBridgePage();
  const result = await bridgeCall(page, 'getSessionId', { detail: true });
  assert.deepEqual(result, { ok: true, op: 'getSessionId', modeSeen: 'js' });
  assert.deepEqual(page.calls, [{ op: 'getSessionId', args: { detail: true } }]);
});

test('bridgeCall retries a destroyed execution context, then succeeds', async () => {
  const destroyed = new Error('Execution context was destroyed, most likely because of a navigation');
  const page = fakeBridgePage({ evalError: destroyed, failTimes: 2 });
  assert.deepEqual(await bridgeCall(page, 'getSessionId'), { ok: true, op: 'getSessionId', modeSeen: 'js' });
});

test('bridgeCall propagates a non-retryable error such as a closed target', async () => {
  const closed = new Error('Target page, context or browser has been closed');
  const page = fakeBridgePage({ evalError: closed, failTimes: 1 });
  await assert.rejects(() => bridgeCall(page, 'getSessionId'), /has been closed/);
});

test('withAppiumInputMode flips to appium for the call and restores the prior mode', async () => {
  const page = fakeBridgePage();
  let modeDuringCall;
  const result = await withAppiumInputMode(page, async () => {
    modeDuringCall = page.currentMode();
    return 'body-result';
  });
  assert.equal(modeDuringCall, 'appium', 'the body runs with the appium input mode active');
  assert.equal(result, 'body-result');
  assert.deepEqual(
    page.calls.map((call) => call.args.mode),
    ['appium', 'js'],
    'the prior mode is restored after the body',
  );
});

test('withAppiumInputMode restores the mode even when the body throws', async () => {
  const page = fakeBridgePage();
  await assert.rejects(
    withAppiumInputMode(page, async () => { throw new Error('body failed'); }),
    /body failed/,
  );
  assert.deepEqual(page.calls.map((call) => call.args.mode), ['appium', 'js']);
});

test('withAppiumInputMode restores a non-js prior mode', async () => {
  const page = fakeBridgePage();
  await setInputMode(page, 'appium');
  page.calls.length = 0;
  await withAppiumInputMode(page, async () => {});
  assert.deepEqual(page.calls.map((call) => call.args.mode), ['appium', 'appium']);
});

test('withHitTestBypass enables the bypass and restores the prior flag', async () => {
  const page = fakeBridgePage();
  let bypassDuringCall;
  await withHitTestBypass(page, async () => {
    bypassDuringCall = page.calls[page.calls.length - 1];
  });
  assert.deepEqual(bypassDuringCall, { op: 'setHitTestBypass', args: { on: true } });
  assert.deepEqual(
    page.calls.map((call) => call.args.on),
    [true, false],
    'the bypass is turned off again after the body',
  );
});

test('makeAppiumProxy flips the mode around a forwarded method and nested namespaces', async () => {
  const page = fakeBridgePage();
  const modesSeen = [];
  const receiver = {
    async tap(...args) { modesSeen.push(['tap', page.currentMode()]); return args; },
    mouse: {
      async down() { modesSeen.push(['mouse.down', page.currentMode()]); return 'down'; },
    },
    label: 'not-a-function',
  };
  const proxy = makeAppiumProxy(receiver, page);

  assert.deepEqual(await proxy.tap({ force: true }), [{ force: true }]);
  assert.equal(await proxy.mouse.down(), 'down');
  assert.equal(proxy.label, 'not-a-function', 'non-function members pass through untouched');

  assert.deepEqual(modesSeen, [['tap', 'appium'], ['mouse.down', 'appium']]);
  assert.equal(page.currentMode(), 'js', 'the mode is restored after each call');
});
