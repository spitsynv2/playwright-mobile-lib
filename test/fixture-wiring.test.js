'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { devices } = require('@playwright/test');

const { selectDriver } = require('../src/platforms');
const { patchContextNewPage, patchContextClose } = require('../src/core/context-patch');

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

test('Android resolves `device` to the AndroidDevice on a device run', async () => {
  const calls = [];
  const androidDevice = {
    launchBrowser() {},
    serial: () => 'ABC123',
    input: { tap(point) { calls.push(['input.tap', point]); } },
    async tap(selector) { calls.push(['tap', selector]); return 'tapped'; },
    async shell(command) { calls.push(['shell', command]); return Buffer.from(''); },
  };
  const device = selectDriver('Android').resolveDevice(androidDevice);

  assert.equal(await device.tap({ text: 'Allow' }), 'tapped');
  await device.shell('pm grant com.android.chrome android.permission.ACCESS_FINE_LOCATION');
  await device.input.tap({ x: 1, y: 2 });
  assert.deepEqual(calls, [
    ['tap', { text: 'Allow' }],
    ['shell', 'pm grant com.android.chrome android.permission.ACCESS_FINE_LOCATION'],
    ['input.tap', { x: 1, y: 2 }],
  ]);
  assert.equal(device.serial(), 'ABC123', 'sync members are not wrapped into a promise');
});

test('Android blocks fixture-owned lifecycle calls on `device`', () => {
  const device = selectDriver('Android').resolveDevice({ launchBrowser() {}, close() {} });
  for (const name of ['close', 'launchBrowser']) {
    assert.throws(() => device[name](), /is not available from a test/);
  }
  assert.doesNotThrow(() => String(device), 'inherited members are neither blocked nor recorded');
});

test('Android rejects `device` on a local pre-flight run', () => {
  assert.throws(
    () => selectDriver('Android').resolveDevice({ newContext() {} }),
    /`device` fixture requires an Android device run/,
  );
});

test('iOS rejects `device` outright', () => {
  assert.throws(
    () => selectDriver('iOS').resolveDevice({ newContext() {} }),
    /`device` fixture is Android-only/,
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
function fakeAndroidDevice(context = { pages: () => [] }) {
  const calls = { launchOptions: null, shell: [], launches: 0 };
  return {
    calls,
    async shell(command) {
      calls.shell.push(command);
      return Buffer.from('versionName=140.0.7000.1');
    },
    async launchBrowser(options) {
      calls.launchOptions = options;
      calls.launches += 1;
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

test('Android enables touch on a device context unless it is explicitly disabled', async () => {
  assert.equal((await launchWith({})).hasTouch, true);
  assert.equal((await launchWith({ useOptions: { hasTouch: false } })).hasTouch, false);
  assert.equal((await launchWith({ capabilities: { hasTouch: 'false' } })).hasTouch, false);
});

// Android tab hygiene. launchBrowser() adds a tab per test and Android
// context.close() closes none, so every path below has to end at zero strays.
class FakePage {
  constructor(url = 'https://example.com/', onClose) {
    this._url = url;
    this._closed = false;
    this._onClose = onClose;
    this.bridgeOps = [];
  }

  url() { return this._url; }

  context() { return this._context; }

  isClosed() { return this._closed; }

  async goto(url) { this._url = url; }

  // Stands in for the Go bridge answering the page.bridge.<op> sentinel.
  async evaluate(expression) {
    const { op } = JSON.parse(String(expression).replace('__pwm_bridge_call__:', ''));
    this.bridgeOps.push(op);
    if (op === 'startSession') return `session-${this.bridgeOps.length}`;
    if (op === 'endSession') return 'ended';
    throw new Error(`FakePage: unsupported bridge op ${op}`);
  }

  async close() {
    if (this._onClose) await this._onClose();
    this._closed = true;
  }
}

function fakeContext(pages = []) {
  const all = [...pages];
  const context = {
    closeCalls: 0,
    pagesAtClose: null,
    pages: () => all.filter((page) => !page.isClosed()),
    async newPage() {
      const page = new FakePage('about:blank');
      page._context = context;
      all.push(page);
      return page;
    },
    // Stands in for the incognito tab the private-mode intent opens.
    async waitForEvent(event) {
      return event === 'page' ? context.newPage() : null;
    },
    async close() {
      context.closeCalls += 1;
      context.pagesAtClose = context.pages().length;
    },
  };
  for (const page of all) page._context = context;
  return context;
}

async function launchContext(context, capabilities) {
  const driver = selectDriver('Android');
  await driver.createContext(fakeAndroidDevice(context), {
    preset: {},
    extraContextOptions: {},
    capabilities: { platformName: 'Android', browsingMode: 'public', ...capabilities },
  });
  return driver;
}

test('Android sweeps the tabs Chrome restored when it launches the browser', async () => {
  const launched = new FakePage('about:blank');
  const restored = [new FakePage('https://a.example/'), new FakePage('https://b.example/')];
  const context = fakeContext([restored[0], launched, restored[1]]);

  await launchContext(context);

  assert.deepEqual(context.pages(), [launched], 'only the tab launchBrowser() opened survives');
});

test('Android teardown closes every tab the test left open', async () => {
  const context = fakeContext([new FakePage('about:blank')]);
  const driver = await launchContext(context);
  const popup = await context.newPage();

  await driver.onContextTeardown(context);

  assert.equal(popup.isClosed(), true, 'a popup is not left behind');
  assert.equal(context.pages().length, 0);
});

test('Android hands the test the launch tab instead of opening a second one', async () => {
  for (const browsingMode of ['public', 'single-tab-public']) {
    const launched = new FakePage('about:blank');
    const context = fakeContext([launched]);
    const driver = await launchContext(context, { browsingMode });

    const page = await driver.createPage(context, {});

    assert.equal(page, launched, `${browsingMode} drives the tab launchBrowser() opened`);
    assert.equal(context.pages().length, 1, `${browsingMode} leaves no stranded about:blank`);
  }
});

// One test of a single-tab worker: reuse the context, drive the managed tab,
// then run the teardown the fixture would.
async function runSingleTabTest(driver, connection, browsingMode) {
  const context = await driver.createContext(connection, {
    preset: {},
    extraContextOptions: {},
    capabilities: { platformName: 'Android', browsingMode },
  });
  const page = await driver.createPage(context, {});
  await driver.onPageTeardown(page, { project: {} });
  await driver.onContextTeardown(context);
  await driver.closeContext(context);
  return { context, page };
}

test('Android single-tab launches Chrome once and hands every test the same tab', async () => {
  const launched = new FakePage('about:blank');
  const context = fakeContext([launched]);
  const connection = fakeAndroidDevice(context);
  const driver = selectDriver('Android');

  const first = await runSingleTabTest(driver, connection, 'single-tab-public');
  const second = await runSingleTabTest(driver, connection, 'single-tab-public');

  assert.equal(connection.calls.launches, 1, 'the second test reuses the launched Chrome');
  assert.equal(second.context, first.context, 'the worker keeps the context it launched');
  assert.equal(second.page, first.page, 'both tests drive the same tab');
  assert.equal(context.closeCalls, 0, 'the fixture never closes a single-tab context');
});

test('Android single-tab brackets each test with its own bridge session', async () => {
  const launched = new FakePage('about:blank');
  const connection = fakeAndroidDevice(fakeContext([launched]));
  const driver = selectDriver('Android');

  await runSingleTabTest(driver, connection, 'single-tab-public');
  await runSingleTabTest(driver, connection, 'single-tab-public');

  assert.deepEqual(
    launched.bridgeOps.filter((op) => op !== 'getDeviceInfo'),
    ['startSession', 'endSession', 'startSession', 'endSession'],
  );
});

test('Android single-tab resets the reused tab before the next test runs', async () => {
  const launched = new FakePage('about:blank');
  const connection = fakeAndroidDevice(fakeContext([launched]));
  const driver = selectDriver('Android');

  await runSingleTabTest(driver, connection, 'single-tab-public');
  launched._url = 'https://example.com/checkout';
  await runSingleTabTest(driver, connection, 'single-tab-public');

  assert.equal(launched.url(), 'about:blank', 'the previous test\'s document does not leak in');
});

test('Android single-tab keeps its tab at teardown and prunes only what a test opened', async () => {
  for (const browsingMode of ['single-tab-public', 'single-tab-private', 'single-tab']) {
    const context = fakeContext([new FakePage('about:blank')]);
    const driver = selectDriver('Android');
    await driver.createContext(fakeAndroidDevice(context), {
      preset: {},
      extraContextOptions: {},
      capabilities: { platformName: 'Android', browsingMode },
    });
    const managed = context.pages()[0];
    const popup = await context.newPage();

    await driver.onContextTeardown(context);

    assert.equal(popup.isClosed(), true, `${browsingMode} still prunes a stray tab`);
    assert.deepEqual(context.pages(), [managed], `${browsingMode} carries one tab into the next test`);
  }
});

test('a test that closes the context itself sweeps its tabs first', async () => {
  const context = fakeContext([new FakePage('about:blank')]);
  await launchContext(context);
  await context.newPage();

  await context.close();

  assert.equal(context.closeCalls, 1, 'the real close still runs');
  assert.equal(context.pagesAtClose, 0, 'no tab reaches the close that would strand it');
});

test('Android leaves tabs alone when closeTabAfterTest is off', async () => {
  const launched = new FakePage('about:blank');
  const restored = new FakePage('https://a.example/');
  const context = fakeContext([restored, launched]);

  const driver = await launchContext(context, { closeTabAfterTest: 'false' });
  await driver.onContextTeardown(context);
  await context.close();

  assert.deepEqual(context.pages(), [restored, launched]);
});

test('Android clears browser data before launch only when asked', async () => {
  const cleared = async (capabilities) => {
    const device = fakeAndroidDevice(fakeContext([new FakePage('about:blank')]));
    await selectDriver('Android').createContext(device, {
      preset: {},
      extraContextOptions: {},
      capabilities: { platformName: 'Android', browsingMode: 'public', ...capabilities },
    });
    return device.calls.shell.some((command) => command.startsWith('pm clear'));
  };

  assert.equal(await cleared(), false, 'the profile survives by default');
  assert.equal(await cleared({ resetBrowserData: 'true' }), true);
});

test('a tab whose close never settles does not block the rest of the sweep', async () => {
  const saved = process.env.PWM_TAB_CLOSE_TIMEOUT_MS;
  process.env.PWM_TAB_CLOSE_TIMEOUT_MS = '50';
  try {
    const launched = new FakePage('about:blank');
    const hung = new FakePage('https://hung.example/', () => new Promise(() => {}));
    const context = fakeContext([launched, hung]);
    const driver = await launchContext(context);
    const popup = await context.newPage();

    await driver.onContextTeardown(context);

    assert.equal(popup.isClosed(), true, 'a wedged tab does not strand the others');
    assert.equal(hung.isClosed(), false, 'the wedged tab is reported, not waited on');
  } finally {
    if (saved === undefined) delete process.env.PWM_TAB_CLOSE_TIMEOUT_MS;
    else process.env.PWM_TAB_CLOSE_TIMEOUT_MS = saved;
  }
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

test('patching close tolerates a context without one, and a failing hook', async () => {
  assert.doesNotThrow(() => patchContextClose({}, () => {}));

  let closed = false;
  const context = { async close() { closed = true; } };
  patchContextClose(context, async () => { throw new Error('sweep exploded'); });
  await context.close();
  assert.equal(closed, true, 'a broken sweep never blocks the close it precedes');
});
