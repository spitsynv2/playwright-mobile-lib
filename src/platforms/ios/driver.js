/** Connects WebKit to the orchestrator or launches it locally. */
const { webkit, devices } = require('@playwright/test');

const { resolveIOSDevicePreset } = require('./custom-devices');
const {
  attachSessionCapabilities,
  attachDeviceLabel,
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
const { patchContextNewPage } = require('../../core/context-patch');
const { preflightVideoOptions, installPreflightVideoCapture } = require('../../core/preflight-video');
const { UNSUPPORTED_CONTEXT_METHODS, UNSUPPORTED_USE_OPTIONS } = require('./unsupported-ios');
const { ensureAppiumPrototypesPatched } = require('./bridge-proxy');
const { recordAction } = require('../../core/telemetry');

// Fallback Playwright preset when the requested device name is unknown.
const DEFAULT_LOCAL_IOS_DEVICE = 'iPhone 16 Plus';

/** Parse the iOS and Safari versions from a WebKit user agent. */
function parseWebKitVersions(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const osMatch = /OS (\d+(?:_\d+)+)/.exec(ua);
  const safariMatch = /Version\/(\d+(?:\.\d+)*)/.exec(ua);
  return {
    osVersion: osMatch ? osMatch[1].replace(/_/g, '.') : '',
    browserVersion: safariMatch ? safariMatch[1] : '',
  };
}

const driver = {
  name: 'iOS',

  unsupportedUseOptions: UNSUPPORTED_USE_OPTIONS,

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

  /**
   * Returns requested device data until the bridge reports the selected device.
   */
  resolveDeviceInfo(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    // A farm run requires deviceName or deviceUuid. A local launch does not.
    if (resolveWsEndpoint('iOS') && !caps.deviceName && !caps.deviceUuid) {
      throw new Error(
        'capabilities.deviceName or capabilities.deviceUuid is required for device runs — '
        + 'set one (or both) in the project capabilities (playwright.config.js).',
      );
    }
    return {
      deviceName: caps.deviceName || '',
      platformName: caps.platformName || 'iOS',
      osVersion: '',
    };
  },

  // On a real device the viewport is cosmetic. `setViewportSize` is blocked.
  resolvePreset(deviceInfo) {
    const preset = resolveIOSDevicePreset(deviceInfo.deviceName, devices);
    if (preset) return preset;
    if (resolveWsEndpoint('iOS')) return {};
    return resolveIOSDevicePreset(DEFAULT_LOCAL_IOS_DEVICE, devices) || {};
  },

  resolveBrowser(connection) {
    return connection;
  },

  /**
   * Throws. iOS has no device handle. Use `page.bridge` or `page.appium`.
   */
  resolveDevice() {
    throw new Error(
      'The `device` fixture is Android-only — it exposes the AndroidDevice (UIAutomator over adb). '
      + 'On iOS use `page.bridge.acceptAlert` / `page.bridge.nativeInput` for native dialogs, or '
      + '`page.appium.*` / `withAppiumInputMode(page, fn)` for native input.',
    );
  },

  async createContext(browser, { preset, extraContextOptions, useOptions, testInfo }) {
    const video = preflightVideoOptions('iOS', useOptions, extraContextOptions, testInfo);
    const context = await browser.newContext({
      ...preset,
      ...(video ? { recordVideo: video.recordVideo } : {}),
      ...extraContextOptions,
    });
    blockUnsupportedContextAPIs(context, UNSUPPORTED_CONTEXT_METHODS);
    patchContextNewPage(context, ensureAppiumPrototypesPatched);
    if (video) installPreflightVideoCapture(context, testInfo, video.mode);
    return context;
  },

  async createPage(context, { deviceInfo, reopenInMode }) {
    let page = await recordAction('fixture', 'fixture.page.create', {}, () => context.newPage());
    ensureAppiumPrototypesPatched(page);

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

    // A device reports the OS version through the bridge. A pre-flight has none,
    // so report the WebKit version as the platform version to match the shape.
    if (!resolvedDeviceInfo.osVersion) {
      const preset = resolveIOSDevicePreset(resolvedDeviceInfo.deviceName, devices)
        || resolveIOSDevicePreset(DEFAULT_LOCAL_IOS_DEVICE, devices);
      const { browserVersion } = parseWebKitVersions(preset && preset.userAgent);
      if (browserVersion) {
        resolvedDeviceInfo = { ...resolvedDeviceInfo, osVersion: browserVersion };
      }
    }

    // Attach on device and pre-flight; sessionId is empty on a pre-flight.
    const reportingCapabilities = buildSessionCapabilities('iOS', resolvedDeviceInfo);
    attachSessionCapabilities(sessionId, reportingCapabilities);
    attachDeviceLabel(resolvedDeviceInfo.deviceName);

    // If `setBrowsingMode` fails, keep the current page.
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
module.exports.parseWebKitVersions = parseWebKitVersions;
