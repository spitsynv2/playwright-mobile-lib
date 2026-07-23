// Android Chrome platform driver. With a farm endpoint it connects to the
// orchestrator (/playwright); with an explicit ADB serial it drives a connected
// device; otherwise it launches a local Chromium with the caps device preset
// (viewport emulation) for local pre-flight validation.
const { _android: android } = require('playwright');
const { chromium, devices } = require('@playwright/test');

const {
  resolveWsEndpoint,
  buildConnectHeaders,
  effectiveCapabilities,
  connectTimeoutMs,
  slowMoMs,
} = require('../../core/capabilities');
const { defineThrowing } = require('../../core/unsupported');
const { UNSUPPORTED_PAGE_METHODS } = require('./unsupported-android');
const { makeBridgeProxy } = require('./bridge-proxy');
const {
  attachTestSession,
  attachSessionCapabilities,
  attachDeviceLabel,
  buildSessionCapabilities,
} = require('../../core/reporting');

const adbHost = process.env.ADB_SERVER_HOST || '127.0.0.1';
const adbPort = parseInt(process.env.ADB_SERVER_PORT || '5037', 10);
const omitDriverInstall = process.env.ANDROID_OMIT_DRIVER_INSTALL === 'true';

// Fallback preset for local emulation when the caps device is unknown to Playwright.
const DEFAULT_LOCAL_ANDROID_DEVICE = 'Pixel 7';

// launchBrowser() option keys accepted from capabilities (a subset of
// BrowserContextOptions honored by the _android Chrome context).
const LAUNCH_BROWSER_KEYS = [
  'acceptDownloads', 'args', 'baseURL', 'bypassCSP',
  'colorScheme', 'contrast', 'deviceScaleFactor',
  'extraHTTPHeaders', 'forcedColors',
  'geolocation', 'hasTouch', 'httpCredentials',
  'ignoreHTTPSErrors', 'isMobile', 'javaScriptEnabled',
  'locale', 'offline', 'permissions', 'pkg', 'proxy',
  'recordHar', 'recordVideo', 'reducedMotion',
  'screen', 'serviceWorkers', 'strictSelectors',
  'timezoneId', 'userAgent', 'viewport',
];

function buildLaunchBrowserOptions(caps) {
  const opts = {};
  for (const key of LAUNCH_BROWSER_KEYS) {
    if (caps[key] !== undefined) opts[key] = caps[key];
  }
  return opts;
}

// Playwright device preset for local Chromium emulation, resolved from the caps
// device name (underscores tolerated). Falls back to a mobile default so a local
// run always emulates a phone viewport.
function resolveAndroidDevicePreset(deviceName) {
  const requested = String(deviceName || '').replace(/_/g, ' ').trim();
  if (requested && devices[requested]) return devices[requested];
  return devices[DEFAULT_LOCAL_ANDROID_DEVICE] || {};
}

// ADB is used only when explicitly requested (a serial pins a connected device).
// Otherwise a no-endpoint run means local Chromium emulation.
function useAdb(caps) {
  return Boolean(caps.serial || process.env.ANDROID_SERIAL || process.env.PWM_ANDROID_ADB === 'true');
}

async function connectAdb(caps) {
  const serial = caps.serial || process.env.ANDROID_SERIAL || '';
  const list = await android.devices({ host: adbHost, port: adbPort, omitDriverInstall });
  if (!list.length) {
    throw new Error(
      `No Android devices from ADB at ${adbHost}:${adbPort}. `
      + 'Ensure the device is authorized and `adb devices` lists it.',
    );
  }
  if (serial) {
    const match = list.find((d) => d.serial() === serial);
    if (!match) {
      throw new Error(
        `ANDROID_SERIAL=${serial} not found. Available: ${list.map((d) => d.serial()).join(', ')}`,
      );
    }
    for (const d of list) {
      if (d.serial() !== serial) await d.close();
    }
    return match;
  }
  if (list.length > 1) {
    throw new Error(
      `Multiple devices (${list.length}). Set ANDROID_SERIAL to one of: ${list.map((d) => d.serial()).join(', ')}`,
    );
  }
  return list[0];
}

const patchedAndroidPrototypes = new WeakSet();

function ensureAndroidPrototypesPatched(probePage) {
  const PageProto = Object.getPrototypeOf(probePage);
  if (patchedAndroidPrototypes.has(PageProto)) return;
  defineThrowing(PageProto, 'Page', UNSUPPORTED_PAGE_METHODS);
  Object.defineProperty(PageProto, 'bridge', {
    configurable: true,
    get() { return makeBridgeProxy(this); },
  });
  patchedAndroidPrototypes.add(PageProto);
}

// The Chrome build the launched context runs on, read from the device package
// manager over adb so Zebrunner reporting shows the real browserVersion.
const contextBrowserVersion = new WeakMap();

async function readBrowserVersion(connection, pkg) {
  try {
    const out = (await connection.shell(`dumpsys package ${pkg} | grep versionName`)).toString();
    const match = out.match(/versionName=(\S+)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

const driver = {
  name: 'Android',

  async connect(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    const wsEndpoint = resolveWsEndpoint('Android');
    if (wsEndpoint) {
      return android.connect(wsEndpoint, {
        timeout: connectTimeoutMs,
        slowMo: slowMoMs,
        headers: buildConnectHeaders(caps),
      });
    }
    if (useAdb(caps)) {
      return connectAdb(caps);
    }
    return chromium.launch({ slowMo: slowMoMs });
  },

  async disconnect(connection) {
    if (!connection) return;
    try {
      await connection.close();
    } catch {}
  },

  resolveDeviceInfo(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    return {
      deviceName: caps.deviceName || '',
      platformName: caps.platformName || 'Android',
      osVersion: caps.osVersion || '',
    };
  },

  resolvePreset(deviceInfo) {
    return resolveAndroidDevicePreset(deviceInfo.deviceName);
  },

  async createContext(connection, { preset, extraContextOptions, capabilities }) {
    const caps = effectiveCapabilities(capabilities);
    // A real device (farm or ADB) exposes launchBrowser; local Chromium exposes newContext.
    if (typeof connection.launchBrowser === 'function') {
      const pkg = caps.pkg || 'com.android.chrome';
      await connection.shell(`am force-stop ${pkg}`);
      const context = await connection.launchBrowser({ ...buildLaunchBrowserOptions(caps), ...extraContextOptions });
      contextBrowserVersion.set(context, await readBrowserVersion(connection, pkg));
      return context;
    }
    return connection.newContext({ ...preset, ...extraContextOptions });
  },

  async createPage(context, { deviceInfo, testInfo } = {}) {
    const page = await context.newPage();
    ensureAndroidPrototypesPatched(page);

    // Handshake: pull the bridge's per-test session id and device metadata at test
    // start and push them to Zebrunner. On a local/ADB run (no bridge) the sentinel
    // evaluate throws and is swallowed, leaving sessionId empty.
    let sessionId = '';
    let resolvedDeviceInfo = deviceInfo || { platformName: 'Android' };
    try {
      const rawDeviceInfo = await page.bridge.getDeviceInfo();
      const bridgeDeviceInfo = typeof rawDeviceInfo === 'string'
        ? JSON.parse(rawDeviceInfo)
        : rawDeviceInfo;
      if (bridgeDeviceInfo && typeof bridgeDeviceInfo === 'object') {
        resolvedDeviceInfo = {
          deviceName: bridgeDeviceInfo.deviceName || resolvedDeviceInfo.deviceName,
          platformName: bridgeDeviceInfo.platformName || resolvedDeviceInfo.platformName,
          osVersion: bridgeDeviceInfo.osVersion || resolvedDeviceInfo.osVersion,
        };
      }
    } catch {}
    const browserVersion = contextBrowserVersion.get(context) || '';
    if (browserVersion) resolvedDeviceInfo = { ...resolvedDeviceInfo, browserVersion };
    try {
      sessionId = await page.bridge.getSessionId();
    } catch {}
    if (sessionId && testInfo) {
      const reportingCapabilities = buildSessionCapabilities('Android', resolvedDeviceInfo);
      testInfo.annotations.push({ type: 'sessionId', description: sessionId });
      attachTestSession(sessionId);
      attachSessionCapabilities(sessionId, reportingCapabilities);
      attachDeviceLabel(resolvedDeviceInfo.deviceName);
    }
    return page;
  },

  // On a farm/bridge run the bridge owns the artifact rail (video + session.log on
  // S3 via the recording marker); a local or direct-ADB run has none, so capture a
  // failure screenshot there instead.
  async onPageTeardown(page, testInfo) {
    if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
    if (resolveWsEndpoint('Android')) return;
    try {
      const screenshotPath = testInfo.outputPath('failure.png');
      const buffer = await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10_000 });
      await testInfo.attach('failure-screenshot', { body: buffer, contentType: 'image/png' });
    } catch {}
  },
};

module.exports = driver;
