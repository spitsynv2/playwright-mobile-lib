/** Cross-platform test fixtures. capabilities.platformName selects the driver. */
const { test: base, expect } = require('@playwright/test');

const { selectDriver } = require('./platforms');
const { defaultCapabilities, connectTimeoutMs } = require('./core/capabilities');
const { warnUnsupportedUseOptions } = require('./core/use-guard');

// Extra time beyond the connect timeout for the worker to bring up its device session.
const WORKER_CONNECT_GRACE_MS = 30_000;

const test = base.extend({
  /** iOS only. Reopen page in this browsing mode before the test body. */
  reopenPageInModeBeforeTest: [undefined, { option: true }],

  /** Desired capabilities for this project. The orchestrator matches a free device. */
  capabilities: [defaultCapabilities, { option: true, scope: 'worker' }],

  /** Extra context options for the fixture context. */
  extraContextOptions: [{}, { option: true }],

  _driver: [async ({ capabilities }, use) => {
    await use(selectDriver(capabilities.platformName));
  }, { scope: 'worker' }],

  /** Shared platform connection for the worker. */
  // Timeout must cover a slow container start. Keep that wait off the test timeout.
  _connection: [async ({ capabilities, _driver }, use) => {
    const connection = await _driver.connect(capabilities);
    try {
      await use(connection);
    } finally {
      await _driver.disconnect(connection);
    }
  }, { scope: 'worker', timeout: connectTimeoutMs + WORKER_CONNECT_GRACE_MS }],

  /** Farm browser from the platform connection. */
  browser: [async ({ _driver, _connection }, use) => {
    await use(_driver.resolveBrowser(_connection));
  }, { scope: 'worker' }],

  /** Android device for native UI and ADB. This fixture throws on iOS and on a local pre-flight. */
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
      testInfo,
    });
    try {
      await use(context);
    } finally {
      if (typeof _driver.onContextTeardown === 'function') {
        try {
          await _driver.onContextTeardown(context, { capabilities });
        } catch {}
      }
      // The connection can already be gone. Close can throw.
      try {
        await context.close();
      } catch {}
    }
  },

  page: async ({ _driver, context, deviceInfo, reopenPageInModeBeforeTest }, use, testInfo) => {
    const page = await _driver.createPage(context, { deviceInfo, reopenPageInModeBeforeTest, testInfo });
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
