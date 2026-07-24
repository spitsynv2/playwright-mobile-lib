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

// Default mirrors the iOS bridge (`private`); on Android this is best-effort
// (--incognito may be ignored). See android_browsing_modes plan for parity.
const DEFAULT_ANDROID_BROWSING_MODE = 'private';
const BROWSING_MODES = new Set([
  'public', 'private', 'single-tab-public', 'single-tab-private',
]);

// Prepended to launchBrowser args so a relaunched Chrome does not restore the
// previous test's growing tab set (support varies by Chrome build).
const SESSION_RESTORE_DISABLE_ARGS = [
  '--disable-restore-session-state',
  '--no-restore-session-state',
];

function normalizeBrowsingMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'single-tab') return 'single-tab-public';
  return BROWSING_MODES.has(v) ? v : DEFAULT_ANDROID_BROWSING_MODE;
}

function isSingleTab(mode) {
  return mode === 'single-tab-public' || mode === 'single-tab-private';
}

function isPrivateMode(mode) {
  return mode === 'private' || mode === 'single-tab-private';
}

// Chrome activity that opens an incognito tab; the only CDP-visible incognito
// path on Android (there is no launch/newPage incognito flag).
const INCOGNITO_LAUNCHER = 'org.chromium.chrome.browser.incognito.IncognitoTabLauncher';
const INCOGNITO_PAGE_TIMEOUT_MS = 10_000;

// Open an incognito tab and adopt it as the context's sole page. Returns the
// incognito Page, or null when it never surfaced (caller falls back to the
// normal profile so private mode degrades gracefully instead of failing).
async function openIncognitoPage(connection, context, pkg) {
  const before = new Set(context.pages());
  const arrival = context.waitForEvent('page', { timeout: INCOGNITO_PAGE_TIMEOUT_MS }).catch(() => null);
  try {
    await connection.shell(`am start -n ${pkg}/${INCOGNITO_LAUNCHER}`);
  } catch {
    return null;
  }
  let incognito = await arrival;
  if (!incognito) incognito = context.pages().find((p) => !before.has(p)) || null;
  if (!incognito) return null;
  for (const p of context.pages()) {
    if (p !== incognito) await p.close().catch(() => {});
  }
  return incognito;
}

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
  // Private isolation is handled post-launch via IncognitoTabLauncher (Chrome for
  // Android has no CDP incognito flag), not through launch args.
  opts.args = [...SESSION_RESTORE_DISABLE_ARGS, ...(Array.isArray(caps.args) ? caps.args : [])];
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

// Resolved browsing mode per context, so createPage can decide tab reuse without
// re-reading capabilities from the fixture.
const contextBrowsingMode = new WeakMap();

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
    const mode = normalizeBrowsingMode(caps.browsingMode);
    // A real device (farm or ADB) exposes launchBrowser; local Chromium exposes newContext.
    if (typeof connection.launchBrowser === 'function') {
      const pkg = caps.pkg || 'com.android.chrome';
      await connection.shell(`am force-stop ${pkg}`);
      const context = await connection.launchBrowser({ ...buildLaunchBrowserOptions(caps), ...extraContextOptions });
      contextBrowserVersion.set(context, await readBrowserVersion(connection, pkg));
      contextBrowsingMode.set(context, mode);
      if (isPrivateMode(mode) && !(await openIncognitoPage(connection, context, pkg))) {
        console.warn(`android: incognito tab did not surface for mode '${mode}'; continuing in normal profile`);
      }
      return context;
    }
    const context = await connection.newContext({ ...preset, ...extraContextOptions });
    contextBrowsingMode.set(context, mode);
    return context;
  },

  // Prune CDP-visible tabs before context.close() so a relaunched Chrome has
  // nothing to restore; leftover on-device tabs are a GUI artifact close leaves.
  // Mirrors iOS: runs only when closeTabAfterTest (default true) and not single-tab.
  async onContextTeardown(context, { capabilities } = {}) {
    const caps = effectiveCapabilities(capabilities);
    if (caps.closeTabAfterTest === false) return;
    if (isSingleTab(contextBrowsingMode.get(context) || DEFAULT_ANDROID_BROWSING_MODE)) return;
    try {
      const pages = typeof context.pages === 'function' ? context.pages() : [];
      for (const p of pages) {
        await p.close().catch(() => {});
      }
    } catch {}
  },

  async createPage(context, { deviceInfo, testInfo } = {}) {
    const mode = contextBrowsingMode.get(context) || DEFAULT_ANDROID_BROWSING_MODE;
    const existing = typeof context.pages === 'function' ? context.pages() : [];
    // Reuse the existing tab for single-tab modes and for private (newPage would
    // open a non-incognito tab); only `public` opens a fresh tab per page (#26800).
    const reuseFirst = existing.length > 0 && (isSingleTab(mode) || isPrivateMode(mode));
    const page = reuseFirst ? existing[0] : await context.newPage();
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
