// Unified cross-platform `test`. Fixtures pick a platform driver from
// capabilities.platformName (iOS -> Safari bridge, Android -> Chrome) and never
// branch inline; each driver owns its connect/context/page specifics.
const { test: base, expect } = require('@playwright/test');

const { selectDriver } = require('./platforms');
const { defaultCapabilities, connectTimeoutMs } = require('./core/capabilities');
const { warnUnsupportedUseOptions } = require('./core/use-guard');

const test = base.extend({
  // Per-test override ('private' | 'public') that reopens `page` in a fresh tab
  // of that mode before the test body runs. iOS Safari only; ignored elsewhere.
  reopenInMode: [undefined, { option: true }],

  // Desired capabilities for this project/run. The orchestrator pool-matches a
  // free device against these. platformName selects the driver ('iOS' | 'Android')
  // and route; deviceName/deviceUuid/browsingMode pin the farm device. Set
  // per-project via `use: { capabilities }`.
  capabilities: [defaultCapabilities, { option: true, scope: 'worker' }],

  // Extra context options merged into the fixture context (iOS newContext /
  // Android launchBrowser), so tests needing recordHar / extraHTTPHeaders /
  // httpCredentials still use the shared page fixture. Set via `test.use(...)`.
  extraContextOptions: [{}, { option: true }],

  _driver: [async ({ capabilities }, use) => {
    await use(selectDriver(capabilities.platformName));
  }, { scope: 'worker' }],

  // Shared per worker: the platform connection (iOS Browser / Android AndroidDevice).
  // The explicit timeout keeps a slow container start off the test timeout.
  _connection: [async ({ capabilities, _driver }, use) => {
    const connection = await _driver.connect(capabilities);
    try {
      await use(connection);
    } finally {
      await _driver.disconnect(connection);
    }
  }, { scope: 'worker', timeout: connectTimeoutMs + 30_000 }],

  // Overrides Playwright's built-in browser, which would otherwise launch a local chromium.
  browser: [async ({ _driver, _connection }, use) => {
    await use(_driver.resolveBrowser(_connection));
  }, { scope: 'worker' }],

  // Android only: the AndroidDevice behind the run (UIAutomator selectors + adb
  // shell) for native UI the web context cannot reach. Throws on iOS and on a
  // local pre-flight run; a test that never requests it is unaffected.
  device: [async ({ _driver, _connection }, use) => {
    await use(_driver.resolveDevice(_connection));
  }, { scope: 'worker' }],

  deviceInfo: [async ({ capabilities, _driver }, use) => {
    await use(_driver.resolveDeviceInfo(capabilities));
  }, { scope: 'worker' }],

  devicePreset: [async ({ deviceInfo, _driver }, use) => {
    await use(_driver.resolvePreset(deviceInfo));
  }, { scope: 'worker' }],

  context: async ({ _driver, _connection, devicePreset, extraContextOptions, capabilities }, use, testInfo) => {
    const useOptions = (testInfo.project && testInfo.project.use) || {};
    warnUnsupportedUseOptions(useOptions, _driver.unsupportedUseOptions);
    const context = await _driver.createContext(_connection, {
      preset: devicePreset,
      extraContextOptions,
      capabilities,
      useOptions,
    });
    try {
      await use(context);
    } finally {
      // Driver-owned pre-close cleanup (Android prunes tabs); best-effort.
      if (typeof _driver.onContextTeardown === 'function') {
        try {
          await _driver.onContextTeardown(context, { capabilities });
        } catch {}
      }
      // Connection may already be gone; closing a dead context throws.
      try {
        await context.close();
      } catch {}
    }
  },

  page: async ({ _driver, context, deviceInfo, reopenInMode }, use, testInfo) => {
    const page = await _driver.createPage(context, { deviceInfo, reopenInMode, testInfo });
    try {
      await use(page);
    } finally {
      if (typeof _driver.onPageTeardown === 'function') {
        await _driver.onPageTeardown(page, testInfo);
      }
    }
  },
});

module.exports = { test, expect };
