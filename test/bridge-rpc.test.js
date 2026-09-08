'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BRIDGE_CALL_SENTINEL,
  hasFarmBridge,
  bridgeUnavailableError,
  bridgeCall,
} = require('../src/core/bridge-rpc');
const { withConnectEnv } = require('./helpers/connect-env');

function fakePage() {
  const payloads = [];
  return {
    payloads,
    waitCount: 0,
    async evaluate(payload) {
      payloads.push(payload);
      const request = JSON.parse(payload.slice(BRIDGE_CALL_SENTINEL.length));
      return { ok: true, op: request.op, args: request.args };
    },
    async waitForTimeout() { this.waitCount += 1; },
  };
}

test('hasFarmBridge follows the platform endpoint', async () => {
  await withConnectEnv({}, () => {
    assert.equal(hasFarmBridge('iOS'), false);
    assert.equal(hasFarmBridge('Android'), false);
  });
  await withConnectEnv({ PWM_ORCHESTRATOR: 'wss://farm:7465/sessions' }, () => {
    assert.equal(hasFarmBridge('iOS'), true);
    assert.equal(hasFarmBridge('Android'), true);
  });
});

test('bridgeCall throws a dedicated error on a local pre-flight and does not evaluate', async () => {
  const page = fakePage();
  await withConnectEnv({}, async () => {
    await assert.rejects(() => bridgeCall(page, 'getSessionId', {}, 'iOS'), (err) => {
      assert.equal(err.name, 'BridgeUnavailableError');
      assert.match(err.message, /page\.bridge\.getSessionId\(\) requires a real-device bridge/);
      return true;
    });
  });
  assert.equal(page.payloads.length, 0, 'the sentinel string never reaches page.evaluate');
});

test('bridgeCall serializes the op through the sentinel on a farm run', async () => {
  const page = fakePage();
  await withConnectEnv({ PWM_ORCHESTRATOR: 'wss://farm:7465/sessions' }, async () => {
    const result = await bridgeCall(page, 'getDeviceInfo', { verbose: true }, 'Android');
    assert.deepEqual(result, { ok: true, op: 'getDeviceInfo', args: { verbose: true } });
  });
  assert.ok(page.payloads[0].startsWith(BRIDGE_CALL_SENTINEL));
});

test('bridgeUnavailableError names the op', () => {
  const err = bridgeUnavailableError('acceptAlert');
  assert.equal(err.name, 'BridgeUnavailableError');
  assert.match(err.message, /page\.bridge\.acceptAlert\(\)/);
});
