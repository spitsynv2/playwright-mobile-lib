'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const driver = require('../src/platforms/ios/driver');
const { withConnectEnv } = require('./helpers/connect-env');

const FARM = { PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: 'wss://farm:7465/sessions' };

const SENTINEL = '__pwm_bridge_call__:';

// A full iOS page whose prototype chain ensureAppiumPrototypesPatched can probe.
// `evalImpl` drives the bridge RPC: default throws so the createPage handshake
// takes its best-effort (local-run) path.
function makeFullPage({ evalImpl } = {}) {
  let closed = false;
  const contextProto = { async addInitScript() {} };
  const context = Object.create(contextProto);
  context.waitForEvent = async () => ({ id: 'reopened' });
  const locatorProto = { page() { return page; } };
  const locator = Object.create(locatorProto);
  const pageProto = {
    async goto(url) { return url; },
    async reload() {},
    async goBack() {},
    async goForward() {},
    async screenshot() { return Buffer.from('\x89PNG'); },
    async addInitScript() {},
    context() { return context; },
    locator() { return locator; },
    async evaluate(payload) {
      const request = JSON.parse(payload.slice(SENTINEL.length));
      if (evalImpl) return evalImpl(request);
      throw new Error('bridge unavailable on a local run');
    },
    async waitForTimeout() {},
    isClosed() { return closed; },
    async close() { closed = true; },
  };
  const page = Object.create(pageProto);
  page.mouse = Object.create({});
  return page;
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  return { warnings, restore() { console.warn = original; } };
}

test('parseWebKitVersions reads the iOS and Safari versions Playwright WebKit reports', () => {
  // A real WebKit preset UA. The iOS token and the Safari Version token differ,
  // and both move between Playwright releases, so the pre-flight version must be
  // derived from this string rather than hard-coded.
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  assert.deepEqual(driver.parseWebKitVersions(ua), {
    osVersion: '17.5',
    browserVersion: '26.0',
  });
});

test('parseWebKitVersions returns empty strings for a missing or unparsable user agent', () => {
  assert.deepEqual(driver.parseWebKitVersions(undefined), { osVersion: '', browserVersion: '' });
  assert.deepEqual(driver.parseWebKitVersions('not a ua'), { osVersion: '', browserVersion: '' });
});

test('createContext merges preset and extra options and blocks device-only context APIs', async () => {
  let receivedOptions;
  const context = { async newPage() { return makeFullPage(); } };
  const browser = {
    async newContext(options) { receivedOptions = options; return context; },
  };

  const result = await driver.createContext(browser, {
    preset: { viewport: { width: 390, height: 844 }, userAgent: 'ua' },
    extraContextOptions: { locale: 'en-GB' },
  });

  assert.equal(result, context);
  assert.deepEqual(receivedOptions, {
    viewport: { width: 390, height: 844 },
    userAgent: 'ua',
    locale: 'en-GB',
  });
  assert.throws(() => context.cookies(), /BrowserContext\.cookies\(\) is unsupported/);
  assert.throws(() => context.setGeolocation({ latitude: 1, longitude: 2 }), /BrowserContext\.setGeolocation\(\) is unsupported/);
});

test('createContext patches consumer-opened pages with the bridge surface', async () => {
  const context = { async newPage() { return makeFullPage(); } };
  const browser = { async newContext() { return context; } };

  await driver.createContext(browser, { preset: {}, extraContextOptions: {} });
  const page = await context.newPage();

  assert.equal(typeof page.bridge, 'object', 'a page opened off the context gets page.bridge');
});

test('createPage returns the page when the bridge handshake is unavailable', async () => {
  const page = makeFullPage();
  const context = { async newPage() { return page; } };

  const result = await driver.createPage(context, {
    deviceInfo: { deviceName: 'iPhone XR', platformName: 'iOS', osVersion: '' },
    reopenPageInModeBeforeTest: undefined,
    testInfo: {},
  });

  assert.equal(result, page, 'a missing bridge does not crash the fixture');
});

test('createPage keeps the current page when reopenPageInModeBeforeTest has no farm bridge', async () => {
  await withConnectEnv({}, async () => {
    const page = makeFullPage();
    const context = { async newPage() { return page; } };
    const capture = captureWarnings();
    let result;
    try {
      result = await driver.createPage(context, {
        deviceInfo: { deviceName: '', platformName: 'iOS', osVersion: '' },
        reopenPageInModeBeforeTest: 'private',
        testInfo: {},
      });
    } finally {
      capture.restore();
    }

    assert.equal(result, page, 'a local pre-flight keeps the current page');
    assert.equal(
      capture.warnings.some((line) => /setBrowsingMode\(private\) unavailable/.test(line)),
      false,
      'a missing farm does not warn; setBrowsingMode returns the same page',
    );
  });
});

test('createPage reopens into the tab the bridge adopts when setBrowsingMode succeeds', async () => {
  await withConnectEnv(FARM, async () => {
    const page = makeFullPage({
      evalImpl(request) {
        if (request.op === 'getDeviceInfo') return JSON.stringify({ deviceName: 'iPhone XR', platformName: 'iOS', osVersion: '17.0' });
        if (request.op === 'getSessionId') return 'session-1';
        return 'ok';
      },
    });
    const context = { async newPage() { return page; } };

    const result = await driver.createPage(context, {
      deviceInfo: { deviceName: 'iPhone XR', platformName: 'iOS', osVersion: '' },
      reopenPageInModeBeforeTest: 'public',
      testInfo: {},
    });

    assert.deepEqual(result, { id: 'reopened' }, 'the adopted tab becomes the test page');
  });
});
