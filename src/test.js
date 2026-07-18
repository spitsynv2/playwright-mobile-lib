// Unified cross-platform `test`. Fixtures pick a platform driver from
// capabilities.platformName (iOS -> Safari bridge, Android -> Chrome) and never
// branch inline; each driver owns its connect/context/page specifics.
const { test: base, expect } = require('@playwright/test');

const { selectDriver } = require('./platforms');
const { defaultCapabilities, connectTimeoutMs } = require('./core/capabilities');

const test = base.extend({
  // Per-test override ('private' | 'public') that reopens `page` in a fresh tab
  // of that mode before the test body runs. iOS Safari only; ignored elsewhere.
  reopenInMode: [undefined, { option: true }],

  // Desired capabilities for this project/run. The orchestrator pool-matches a
  // free device against these. platformName selects the driver ('iOS' | 'Android')
  // and route; deviceName/osVersion/browsingMode are optional filters. Set
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

  deviceInfo: [async ({ capabilities, _driver }, use) => {
    await use(_driver.resolveDeviceInfo(capabilities));
  }, { scope: 'worker' }],

  devicePreset: [async ({ deviceInfo, _driver }, use) => {
    await use(_driver.resolvePreset(deviceInfo));
  }, { scope: 'worker' }],

  context: async ({ _driver, _connection, devicePreset, extraContextOptions, capabilities }, use) => {
    const context = await _driver.createContext(_connection, {
      preset: devicePreset,
      extraContextOptions,
      capabilities,
    });
    try {
      await use(context);
    } finally {
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
