'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  gateFlag,
  effectiveCapabilities,
  resolveWsEndpoint,
  buildConnectHeaders,
  resolveClientId,
} = require('../src/core/capabilities');

const CONNECT_ENV = [
  'PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT',
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

function endpointWithCredentials(username, password) {
  const endpoint = new URL('wss://orch.example.com:7465/sessions');
  endpoint.username = username;
  endpoint.password = password;
  return endpoint.toString();
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

test('passes a non-negative integer sessionIdleTimeoutMs through to the header', () => {
  assert.equal(effectiveCapabilities({ platformName: 'iOS', sessionIdleTimeoutMs: 60000 }).sessionIdleTimeoutMs, 60000);
  assert.equal(effectiveCapabilities({ sessionIdleTimeoutMs: 0 }).sessionIdleTimeoutMs, 0);
});

test('leaves an unset sessionIdleTimeoutMs to the orchestrator default', () => {
  assert.doesNotThrow(() => effectiveCapabilities({ platformName: 'iOS' }));
  assert.doesNotThrow(() => effectiveCapabilities({ sessionIdleTimeoutMs: undefined }));
  assert.doesNotThrow(() => effectiveCapabilities({ sessionIdleTimeoutMs: null }));
});

test('rejects a negative or non-integer sessionIdleTimeoutMs instead of dropping it server-side', () => {
  for (const bad of [-1, 1.5, '1000', NaN, Infinity]) {
    assert.throws(
      () => effectiveCapabilities({ platformName: 'iOS', sessionIdleTimeoutMs: bad }),
      /sessionIdleTimeoutMs must be a non-negative integer/,
    );
  }
});

test('uses PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT for every platform', () => {
  withConnectEnv({
    PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: endpointWithCredentials('test-user', 'test-password'),
  }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/sessions');
    assert.equal(decodeBasic(buildConnectHeaders({}).Authorization), 'test-user:test-password');
  });
});

test('percent-decodes userinfo so reserved characters survive the URL', () => {
  withConnectEnv({
    PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: endpointWithCredentials('test-user', 'test-p@ss:word'),
  }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(decodeBasic(buildConnectHeaders({}).Authorization), 'test-user:test-p@ss:word');
  });
});

test('sends no Authorization when no credentials are configured', () => {
  withConnectEnv({
    PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: 'wss://orch.example.com:7465/sessions',
  }, () => {
    assert.equal(buildConnectHeaders({}).Authorization, undefined);
  });
  withConnectEnv({}, () => {
    assert.equal(resolveWsEndpoint('iOS'), '');
    assert.equal(buildConnectHeaders({}).Authorization, undefined);
  });
});

test('does not append a platform path to PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT', () => {
  withConnectEnv({
    PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: 'wss://orch.example.com:7465/sessions',
  }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/sessions');
  });
  withConnectEnv({ PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: 'wss://orch.example.com:7465/' }, () => {
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/');
  });
});

test('PLAYWRIGHT_MOBILE_CLIENT_ID overrides auto identity', () => {
  assert.equal(resolveClientId({ PLAYWRIGHT_MOBILE_CLIENT_ID: 'run-fixed' }, 42), 'run-fixed');
  assert.equal(resolveClientId({ IOS_CLIENT_ID: 'legacy' }, 42), 'legacy');
});

test('Playwright parallel index is stable across worker recycle', () => {
  const env = { TEST_PARALLEL_INDEX: '0', TEST_WORKER_INDEX: '1' };
  assert.equal(resolveClientId(env, 1001), 'pwm-p0-r1001');
  // Same parallel slot + same runner after a failed-test worker restart.
  assert.equal(resolveClientId({ TEST_PARALLEL_INDEX: '0', TEST_WORKER_INDEX: '7' }, 1001), 'pwm-p0-r1001');
  assert.equal(resolveClientId({ TEST_PARALLEL_INDEX: '1' }, 1001), 'pwm-p1-r1001');
  assert.equal(resolveClientId({ TEST_PARALLEL_INDEX: '0' }, 2002), 'pwm-p0-r2002');
});

test('without parallel index falls back to a unique id', () => {
  const a = resolveClientId({ TEST_WORKER_INDEX: '3' }, 1);
  const b = resolveClientId({ TEST_WORKER_INDEX: '3' }, 1);
  assert.match(a, /^pwm-w3-/);
  assert.match(b, /^pwm-w3-/);
  assert.notEqual(a, b);
  assert.match(resolveClientId({}, 1), /^pwm-/);
});
