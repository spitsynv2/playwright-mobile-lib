'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  gateFlag,
  effectiveCapabilities,
  resolveWsEndpoint,
  buildConnectHeaders,
} = require('../src/core/capabilities');

const CONNECT_ENV = [
  'PWM_ORCHESTRATOR',
  'IOS_WS_ENDPOINT',
  'ANDROID_WS_ENDPOINT',
  'PWM_AUTH_HEADER',
  'PWM_AUTH_TOKEN',
  'PWM_AUTH_USER',
  'PWM_AUTH_PASSWORD',
];

function withConnectEnv(values, run) {
  const saved = Object.fromEntries(CONNECT_ENV.map((key) => [key, process.env[key]]));
  for (const key of CONNECT_ENV) delete process.env[key];
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const key of CONNECT_ENV) delete process.env[key];
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
  }
}

function decodeBasic(header) {
  return Buffer.from(header.replace(/^Basic /, ''), 'base64').toString();
}

test('resolves booleans unchanged', () => {
  assert.equal(gateFlag(true), true);
  assert.equal(gateFlag(false), false);
});

test('resolves the string forms the orchestrator accepts', () => {
  assert.equal(gateFlag('true'), true);
  assert.equal(gateFlag('TRUE'), true);
  assert.equal(gateFlag(' true '), true);
  assert.equal(gateFlag('1'), true);
  assert.equal(gateFlag('false'), false);
  assert.equal(gateFlag('False'), false);
  assert.equal(gateFlag('0'), false);
});

test('treats unset and unparseable values as unset', () => {
  assert.equal(gateFlag(undefined), undefined);
  assert.equal(gateFlag(null), undefined);
  assert.equal(gateFlag(''), undefined);
  assert.equal(gateFlag('maybe'), undefined);
});

test('accepts every browsing mode the servers recognize', () => {
  for (const mode of ['public', 'private', 'single-tab-public', 'single-tab-private', 'single-tab']) {
    assert.equal(effectiveCapabilities({ platformName: 'iOS', browsingMode: mode }).browsingMode, mode);
  }
  assert.equal(effectiveCapabilities({ browsingMode: ' Private ' }).browsingMode, ' Private ');
});

test('leaves an unset browsing mode to the server default', () => {
  assert.deepEqual(effectiveCapabilities(undefined), {});
  assert.doesNotThrow(() => effectiveCapabilities({ platformName: 'iOS' }));
  assert.doesNotThrow(() => effectiveCapabilities({ browsingMode: '' }));
  assert.doesNotThrow(() => effectiveCapabilities({ browsingMode: undefined }));
});

test('rejects an unknown browsing mode instead of silently defaulting', () => {
  assert.throws(
    () => effectiveCapabilities({ platformName: 'iOS', browsingMode: 'incognito' }),
    /unknown capabilities.browsingMode 'incognito'/,
  );
});

test('moves endpoint userinfo into the Authorization header', () => {
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://alice:secret@orch.example.com:7465' }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/safari');
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/playwright');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:secret');
  });
});

test('percent-decodes userinfo so reserved characters survive the URL', () => {
  withConnectEnv({ IOS_WS_ENDPOINT: 'wss://alice:s%40c%3Aret@orch.example.com:7465/safari' }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/safari');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:s@c:ret');
  });
});

test('prefers explicit auth env over endpoint userinfo', () => {
  const endpoint = 'wss://alice:secret@orch.example.com:7465';
  withConnectEnv({ PWM_ORCHESTRATOR: endpoint, PWM_AUTH_TOKEN: 'tok' }, () => {
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, 'Bearer tok');
  });
  withConnectEnv({ PWM_ORCHESTRATOR: endpoint, PWM_AUTH_HEADER: 'Basic raw' }, () => {
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, 'Basic raw');
  });
  withConnectEnv({ PWM_ORCHESTRATOR: endpoint, PWM_AUTH_USER: 'bob', PWM_AUTH_PASSWORD: 'pw' }, () => {
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'bob:pw');
  });
});

test('keeps basic auth from env on an endpoint without userinfo', () => {
  withConnectEnv({
    PWM_ORCHESTRATOR: 'wss://orch.example.com:7465',
    PWM_AUTH_USER: 'alice',
    PWM_AUTH_PASSWORD: 'secret',
  }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/safari');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:secret');
  });
});

test('sends no Authorization when no credentials are configured', () => {
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://orch.example.com:7465' }, () => {
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, undefined);
  });
  withConnectEnv({}, () => {
    assert.equal(resolveWsEndpoint('iOS'), '');
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, undefined);
  });
});

test('resolves credentials per platform endpoint', () => {
  withConnectEnv({
    IOS_WS_ENDPOINT: 'wss://ios:pw1@orch.example.com:7465/safari',
    ANDROID_WS_ENDPOINT: 'wss://android:pw2@orch.example.com:7465/playwright',
  }, () => {
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'ios:pw1');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'Android').Authorization), 'android:pw2');
  });
});
