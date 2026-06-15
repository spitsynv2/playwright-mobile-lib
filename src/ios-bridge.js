// Main connection-to-bridge entry. Composes the Playwright `test` object bound
// to the iOS Safari bridge: connects the browser to the orchestrator WS, wires
// per-test reporting, and patches the bridge/appium/unsupported prototypes.
const { test: base, expect, webkit, devices } = require('@playwright/test');

const { resolveIOSDevicePreset } = require('./custom-devices');
const {
  attachTestSession,
  attachSessionCapabilities,
  buildIOSCapabilities,
} = require('./reporting');
const {
  wsEndpoint,
  defaultCapabilities,
  effectiveCapabilities,
  slowMoMs,
  connectTimeoutMs,
  clientId,
} = require('./capabilities');
const { blockUnsupportedContextAPIs } = require('./unsupported');
const { withAppiumInputMode } = require('./appium');
const { ensureAppiumPrototypesPatched } = require('./bridge-proxy');
const { recordAction } = require('./telemetry');

const test = base.extend({
  // Per-test override ('private' | 'public') that reopens `page` in a fresh tab
  // of that mode before the test body runs. This is a swap (extra tab-open) on
  // top of the bridge's default; the connection-level default comes from the
  // project's `browsingMode` capability. Leave unset to use that default
  // directly with no swap.
  reopenInMode: [undefined, { option: true }],

  // Desired capabilities for this project/run. The orchestrator pool-matches a
  // free device against these. platformName is required; osVersion/deviceName/
  // browsingMode are optional filters. Set per-project via `use: { capabilities }`.
  capabilities: [defaultCapabilities, { option: true, scope: 'worker' }],

  // Extra browser.newContext() options merged into the fixture context, so tests
  // that need recordHar / extraHTTPHeaders / httpCredentials still use the shared
  // page fixture (and its reporting session handshake). Set via `test.use(...)`.
  extraContextOptions: [{}, { option: true }],

  // Shared per worker: connects to the bridge, or launches WebKit locally.
  // The explicit timeout keeps a slow container start off the test timeout.
  browser: [async ({ capabilities }, use) => {
    const caps = effectiveCapabilities(capabilities);
    if (!wsEndpoint) {
      const browser = await webkit.launch({ slowMo: slowMoMs });
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
      return;
    }
    const headers = { 'x-pwm-capabilities': JSON.stringify(caps) };
    if (clientId) {
      headers['x-pwm-client-id'] = clientId;
    }
    const browser = await webkit.connect(wsEndpoint, {
      timeout: connectTimeoutMs,
      slowMo: slowMoMs,
      headers,
    });
    try {
      await use(browser);
    } finally {
      try {
        if (browser.isConnected()) await browser.close();
      } catch {}
    }
  }, { scope: 'worker', timeout: connectTimeoutMs + 30_000 }],

  // Requested device metadata used until the bridge reports the selected device.
  deviceInfo: [async ({ capabilities }, use) => {
    const caps = effectiveCapabilities(capabilities);
    // Required only for real device/farm runs (pool-matching + reporting). A
    // local webkit.launch run has no device pool, so don't crash without it.
    if (wsEndpoint && !caps.deviceName) {
      throw new Error(
        'capabilities.deviceName is required for device runs — set it in the project '
        + 'capabilities (playwright.config.js).',
      );
    }
    await use({
      deviceName: caps.deviceName || '',
      platformName: caps.platformName || 'iOS',
      osVersion: caps.osVersion || '',
    });
  }, { scope: 'worker' }],

  // Playwright device preset (viewport/userAgent metadata) for the resolved
  // device. On a real device the viewport is cosmetic (setViewportSize is
  // blocked); the userAgent feeds reporting capabilities.
  devicePreset: [async ({ deviceInfo }, use) => {
    await use(resolveIOSDevicePreset(deviceInfo.deviceName, devices) || {});
  }, { scope: 'worker' }],

  context: async ({ browser, devicePreset, extraContextOptions }, use) => {
    const contextOptions = { ...devicePreset, ...extraContextOptions };
    const context = await browser.newContext(contextOptions);
    blockUnsupportedContextAPIs(context);
    try {
      await use(context);
    } finally {
      // Connection may already be gone; closing a dead context throws.
      try {
        await context.close();
      } catch {}
    }
  },

  page: async ({ context, deviceInfo, reopenInMode }, use, testInfo) => {
    let page = await recordAction('fixture', 'fixture.page.create', {}, () => context.newPage());
    ensureAppiumPrototypesPatched(page);

    // Handshake: pull the bridge's per-test session id at test start and push it to
    // Zebrunner so logs + <sessionId>.mp4 are findable by session. The agent reporter
    // presigns + downloads video/logs from this label in onTestEnd, off the test clock,
    // so artifact I/O can never hang or abort the test. Capabilities are attached here
    // (decoupled from video) so Browser/Platform populate even on a hang/timeout retry.
    let sessionId = '';
    let resolvedDeviceInfo = deviceInfo;
    try {
      const rawDeviceInfo = await page.bridge.getDeviceInfo();
      const bridgeDeviceInfo = typeof rawDeviceInfo === 'string'
        ? JSON.parse(rawDeviceInfo)
        : rawDeviceInfo;
      if (bridgeDeviceInfo && typeof bridgeDeviceInfo === 'object') {
        resolvedDeviceInfo = {
          deviceName: bridgeDeviceInfo.deviceName || deviceInfo.deviceName,
          platformName: bridgeDeviceInfo.platformName || deviceInfo.platformName,
          osVersion: bridgeDeviceInfo.osVersion || deviceInfo.osVersion,
        };
      }
    } catch {}
    try {
      sessionId = await page.bridge.getSessionId();
    } catch {}
    if (sessionId) {
      const reportingCapabilities = buildIOSCapabilities(resolvedDeviceInfo);
      testInfo.annotations.push({ type: 'sessionId', description: sessionId });
      attachTestSession(sessionId);
      attachSessionCapabilities(sessionId, reportingCapabilities);
    }

    // Reopen the page in a fresh tab of the requested mode; the returned tab becomes
    // the test's page. Best-effort: a missing/unsupported bridge (e.g. a local
    // webkit.launch run) must not crash the test — keep the current page.
    const mode = reopenInMode && String(reopenInMode).toLowerCase();
    if (mode === 'private' || mode === 'public') {
      try {
        page = await page.setBrowsingMode(mode);
      } catch (err) {
        console.warn(
          `ios-bridge: setBrowsingMode(${mode}) unavailable; continuing with the current page: ${err && err.message}`,
        );
      }
    }

    // No teardown here on purpose: the bridge resets the page (about:blank + keyboard
    // dismiss) on Playwright.deleteContext, so a hung/killed test can't strand the
    // device in a dirty state, and artifact presign/upload is owned by the agent
    // reporter. Keeping teardown out of the test scope means it can't add to or
    // exceed the test timeout.
    await use(page);
  },
});

module.exports = { test, expect, withAppiumInputMode };
