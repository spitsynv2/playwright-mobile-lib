'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { devices } = require('@playwright/test');

const { selectDriver } = require('../src/platforms');
const { patchContextNewPage } = require('../src/core/context-patch');

const ENDPOINT_KEYS = ['IOS_WS_ENDPOINT', 'ANDROID_WS_ENDPOINT', 'PWM_ORCHESTRATOR'];

// resolveWsEndpoint reads process.env per call, so a farm/local switch is env-scoped.
function withEnv(vars, fn) {
  const saved = new Map();
  for (const key of ENDPOINT_KEYS) saved.set(key, process.env[key]);
  for (const key of ENDPOINT_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('iOS resolves `browser` to the connection itself', () => {
  const connection = { newContext() {} };
  assert.equal(selectDriver('iOS').resolveBrowser(connection), connection);
});

test('Android passes a local pre-flight Browser through', () => {
  const connection = { newContext() {} };
  assert.equal(selectDriver('Android').resolveBrowser(connection), connection);
});

test('Android rejects `browser` on a device run', () => {
  const androidDevice = { launchBrowser() {}, shell() {} };
  assert.throws(
    () => selectDriver('Android').resolveBrowser(androidDevice),
    /`browser` fixture is not available on an Android device run/,
  );
});

test('iOS falls back to a phone preset on a local run', () => {
  const driver = selectDriver('iOS');
  const expected = devices['iPhone 15 Plus'];
  for (const deviceName of ['', 'not a device']) {
    const preset = withEnv({}, () => driver.resolvePreset({ deviceName }));
    assert.equal(preset.viewport.width, expected.viewport.width);
    assert.equal(preset.isMobile, true);
    assert.equal(preset.hasTouch, true);
  }
});

test('iOS leaves the viewport to the device on a farm run', () => {
  const driver = selectDriver('iOS');
  for (const env of [{ IOS_WS_ENDPOINT: 'ws://farm:7777/safari' }, { PWM_ORCHESTRATOR: 'ws://farm:7777' }]) {
    assert.deepEqual(withEnv(env, () => driver.resolvePreset({ deviceName: 'not a device' })), {});
  }
});

test('iOS resolves a known device the same way on both run modes', () => {
  const driver = selectDriver('iOS');
  const local = withEnv({}, () => driver.resolvePreset({ deviceName: 'iphone xr' }));
  const farm = withEnv({ IOS_WS_ENDPOINT: 'ws://farm:7777/safari' }, () => driver.resolvePreset({ deviceName: 'iphone xr' }));
  assert.equal(local.userAgent, devices['iPhone XR'].userAgent);
  assert.equal(farm.userAgent, local.userAgent);
});

// launchBrowser() is the only surface that sees these options; the returned
// context stays minimal so createContext takes its non-incognito path.
function fakeAndroidDevice() {
  const calls = { launchOptions: null };
  const context = { pages: () => [] };
  return {
    calls,
    async shell() { return Buffer.from('versionName=140.0.7000.1'); },
    async launchBrowser(options) {
      calls.launchOptions = options;
      return context;
    },
  };
}

async function launchWith({ useOptions, capabilities, extraContextOptions } = {}) {
  const connection = fakeAndroidDevice();
  await selectDriver('Android').createContext(connection, {
    preset: {},
    extraContextOptions: extraContextOptions || {},
    capabilities: { platformName: 'Android', browsingMode: 'public', ...capabilities },
    useOptions,
  });
  return connection.calls.launchOptions;
}

test('Android forwards project `use` options into the device context', async () => {
  const options = await launchWith({
    useOptions: {
      baseURL: 'https://example.com',
      extraHTTPHeaders: { 'x-test': '1' },
      locale: 'en-GB',
      trace: 'on',
      storageState: 'playwright/.auth/user.json',
    },
  });
  assert.equal(options.baseURL, 'https://example.com');
  assert.deepEqual(options.extraHTTPHeaders, { 'x-test': '1' });
  assert.equal(options.locale, 'en-GB');
  assert.equal('trace' in options, false, 'trace is a reporter option, not a context option');
  assert.equal('storageState' in options, false, 'the launched Chrome context cannot take it');
});

test('Android reads the raw contextOptions escape hatch, top-level `use` winning', async () => {
  const options = await launchWith({
    useOptions: {
      locale: 'en-GB',
      contextOptions: { locale: 'de-DE', timezoneId: 'Europe/Berlin' },
    },
  });
  assert.equal(options.locale, 'en-GB');
  assert.equal(options.timezoneId, 'Europe/Berlin');
});

test('Android precedence runs use, then capabilities, then extraContextOptions', async () => {
  const options = await launchWith({
    useOptions: { baseURL: 'https://from-use.example', locale: 'en-GB' },
    capabilities: { baseURL: 'https://from-caps.example', userAgent: 'caps-ua' },
    extraContextOptions: { userAgent: 'extra-ua' },
  });
  assert.equal(options.baseURL, 'https://from-caps.example');
  assert.equal(options.userAgent, 'extra-ua');
  assert.equal(options.locale, 'en-GB');
});

test('Android tolerates a run with no project `use`', async () => {
  const options = await launchWith({});
  assert.ok(Array.isArray(options.args), 'the driver always sets its own launch args');
});

test('a consumer-created page is patched like the fixture page', async () => {
  const created = [];
  const page = { name: 'page' };
  const context = { async newPage() { return page; } };
  patchContextNewPage(context, (p) => created.push(p));
  assert.equal(await context.newPage(), page);
  assert.deepEqual(created, [page]);
});

test('patching newPage tolerates a context without one', () => {
  assert.doesNotThrow(() => patchContextNewPage({}, () => {}));
});
