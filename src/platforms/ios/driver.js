// iOS Safari platform driver: connects WebKit to the orchestrator (/safari) or
// launches locally, creates the context/page, and wires the bridge/appium/
// unsupported prototypes + Zebrunner session handshake.
const { webkit, devices } = require('@playwright/test');

const { resolveIOSDevicePreset } = require('./custom-devices');
const {
  attachTestSession,
  attachSessionCapabilities,
  buildSessionCapabilities,
} = require('../../core/reporting');
const {
  resolveWsEndpoint,
  buildConnectHeaders,
  effectiveCapabilities,
  slowMoMs,
  connectTimeoutMs,
} = require('../../core/capabilities');
const { blockUnsupportedContextAPIs } = require('../../core/unsupported');
const { UNSUPPORTED_CONTEXT_METHODS } = require('./unsupported-ios');
const { ensureAppiumPrototypesPatched } = require('./bridge-proxy');
const { recordAction } = require('../../core/telemetry');

const driver = {
  name: 'iOS',

  // Connects to the bridge, or launches WebKit locally when no farm endpoint is set.
  async connect(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    const wsEndpoint = resolveWsEndpoint('iOS');
    if (!wsEndpoint) {
      return webkit.launch({ slowMo: slowMoMs });
    }
    return webkit.connect(wsEndpoint, {
      timeout: connectTimeoutMs,
      slowMo: slowMoMs,
      headers: buildConnectHeaders(caps),
    });
  },

  async disconnect(browser) {
    if (!browser) return;
    try {
      if (typeof browser.isConnected !== 'function' || browser.isConnected()) {
        await browser.close();
      }
    } catch {}
  },

  // Requested device metadata used until the bridge reports the selected device.
  // deviceName is required for farm runs (pool-matching + reporting); a local
  // webkit.launch run has no device pool, so it is optional there.
  resolveDeviceInfo(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    if (resolveWsEndpoint('iOS') && !caps.deviceName) {
      throw new Error(
        'capabilities.deviceName is required for device runs — set it in the project '
        + 'capabilities (playwright.config.js).',
      );
    }
    return {
      deviceName: caps.deviceName || '',
      platformName: caps.platformName || 'iOS',
      osVersion: caps.osVersion || '',
    };
  },

  // Playwright device preset (viewport/userAgent metadata) for the resolved device.
  // On a real device the viewport is cosmetic (setViewportSize is blocked); the
  // userAgent feeds reporting capabilities.
  resolvePreset(deviceInfo) {
    return resolveIOSDevicePreset(deviceInfo.deviceName, devices) || {};
  },

  async createContext(browser, { preset, extraContextOptions }) {
    const context = await browser.newContext({ ...preset, ...extraContextOptions });
    blockUnsupportedContextAPIs(context, UNSUPPORTED_CONTEXT_METHODS);
    return context;
  },

  async createPage(context, { deviceInfo, reopenInMode, testInfo }) {
    let page = await recordAction('fixture', 'fixture.page.create', {}, () => context.newPage());
    ensureAppiumPrototypesPatched(page);

    // Handshake: pull the bridge's per-test session id at test start and push it to
    // Zebrunner. The agent reporter registers a test session with this id in onTestEnd;
    // farm artifacts (video.mp4, session.log) stay on S3 and are not fetched by the test.
    // Capabilities are attached here so Browser/Platform populate even on a hang/timeout retry.
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
      const reportingCapabilities = buildSessionCapabilities('iOS', resolvedDeviceInfo);
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

    return page;
  },
};

module.exports = driver;
