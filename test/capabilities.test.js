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

test('passes a non-negative integer idleTimeoutMs through to the header', () => {
  assert.equal(effectiveCapabilities({ platformName: 'iOS', idleTimeoutMs: 60000 }).idleTimeoutMs, 60000);
  assert.equal(effectiveCapabilities({ idleTimeoutMs: 0 }).idleTimeoutMs, 0);
});

test('leaves an unset idleTimeoutMs to the orchestrator default', () => {
  assert.doesNotThrow(() => effectiveCapabilities({ platformName: 'iOS' }));
  assert.doesNotThrow(() => effectiveCapabilities({ idleTimeoutMs: undefined }));
  assert.doesNotThrow(() => effectiveCapabilities({ idleTimeoutMs: null }));
});

test('rejects a negative or non-integer idleTimeoutMs instead of dropping it server-side', () => {
  for (const bad of [-1, 1.5, '1000', NaN, Infinity]) {
    assert.throws(
      () => effectiveCapabilities({ platformName: 'iOS', idleTimeoutMs: bad }),
      /idleTimeoutMs must be a non-negative integer/,
    );
  }
});

test('uses PWM_ORCHESTRATOR as the full session endpoint for every platform', () => {
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://alice:secret@orch.example.com:7465/sessions' }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/sessions');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:secret');
  });
});

test('percent-decodes userinfo so reserved characters survive the URL', () => {
  withConnectEnv({ IOS_WS_ENDPOINT: 'wss://alice:s%40c%3Aret@orch.example.com:7465/sessions' }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:s@c:ret');
  });
});

test('prefers explicit auth env over endpoint userinfo', () => {
  const endpoint = 'wss://alice:secret@orch.example.com:7465/sessions';
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
    PWM_ORCHESTRATOR: 'wss://orch.example.com:7465/sessions',
    PWM_AUTH_USER: 'alice',
    PWM_AUTH_PASSWORD: 'secret',
  }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'alice:secret');
  });
});

test('sends no Authorization when no credentials are configured', () => {
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://orch.example.com:7465/sessions' }, () => {
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, undefined);
  });
  withConnectEnv({}, () => {
    assert.equal(resolveWsEndpoint('iOS'), '');
    assert.equal(buildConnectHeaders({}, 'iOS').Authorization, undefined);
  });
});

test('resolves credentials per platform endpoint override', () => {
  withConnectEnv({
    IOS_WS_ENDPOINT: 'wss://ios:pw1@orch.example.com:7465/sessions',
    ANDROID_WS_ENDPOINT: 'wss://android:pw2@orch.example.com:7465/sessions',
  }, () => {
    assert.equal(decodeBasic(buildConnectHeaders({}, 'iOS').Authorization), 'ios:pw1');
    assert.equal(decodeBasic(buildConnectHeaders({}, 'Android').Authorization), 'android:pw2');
  });
});

test('does not append a platform path to PWM_ORCHESTRATOR', () => {
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://orch.example.com:7465/sessions' }, () => {
    assert.equal(resolveWsEndpoint('iOS'), 'wss://orch.example.com:7465/sessions');
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/sessions');
  });
  withConnectEnv({ PWM_ORCHESTRATOR: 'wss://orch.example.com:7465/' }, () => {
    assert.equal(resolveWsEndpoint('Android'), 'wss://orch.example.com:7465/');
  });
});

test('PWM_CLIENT_ID overrides auto identity', () => {
  assert.equal(resolveClientId({ PWM_CLIENT_ID: 'run-fixed' }, 42), 'run-fixed');
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
