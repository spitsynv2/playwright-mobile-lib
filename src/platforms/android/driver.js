/** Android Chrome platform driver. */
const { _android: android } = require('playwright');
const { chromium, devices, selectors } = require('@playwright/test');

const {
  resolveWsEndpoint,
  buildConnectHeaders,
  effectiveCapabilities,
  gateFlag,
  connectTimeoutMs,
  slowMoMs,
} = require('../../core/capabilities');
const { resolveAndroidDevicePreset: resolveCustomAndroidPreset } = require('./custom-devices');
const { patchContextNewPage, patchContextClose } = require('../../core/context-patch');
const { preflightVideoOptions, installPreflightVideoCapture } = require('../../core/preflight-video');
const { UNSUPPORTED_USE_OPTIONS } = require('./unsupported-android');
const { ensureAndroidPrototypesPatched } = require('./bridge-proxy');
const { makeDeviceProxy } = require('./device-proxy');
const {
  attachSessionCapabilities,
  attachDeviceLabel,
  buildSessionCapabilities,
} = require('../../core/reporting');

const adbHost = process.env.ADB_SERVER_HOST || '127.0.0.1';
const adbPort = parseInt(process.env.ADB_SERVER_PORT || '5037', 10);
const omitDriverInstall = process.env.ANDROID_OMIT_DRIVER_INSTALL === 'true';

const DEFAULT_LOCAL_ANDROID_DEVICE = 'Pixel 7';

const DEFAULT_ANDROID_BROWSING_MODE = 'public';
const BROWSING_MODES = new Set(['public', 'private']);

// Chrome restarts for each test. A single-tab mode maps to its base mode.
const SINGLE_TAB_BASE_MODES = {
  'single-tab': 'public',
  'single-tab-public': 'public',
  'single-tab-private': 'private',
};

// Chrome can restore tabs from the previous test.
const SESSION_RESTORE_DISABLE_ARGS = [
  '--disable-restore-session-state',
  '--no-restore-session-state',
];

// Repeat CDPScreenshotNewSurface. Chrome keeps only the last --enable-features list.
const SCREEN_CAPTURE_FEATURE_ARGS = [
  '--enable-features=CDPScreenshotNewSurface,IncognitoScreenshot,ImprovedIncognitoScreenshot',
];

let warnedSingleTab = false;

function normalizeBrowsingMode(value) {
  const v = String(value || '').trim().toLowerCase();
  const base = SINGLE_TAB_BASE_MODES[v];
  if (!base) return BROWSING_MODES.has(v) ? v : DEFAULT_ANDROID_BROWSING_MODE;
  if (!warnedSingleTab) {
    warnedSingleTab = true;
    console.warn(
      `android: browsingMode '${v}' is iOS-only — Chrome relaunches per test, so no tab `
      + `survives one; running as '${base}'`,
    );
  }
  return base;
}

function isPrivateMode(mode) {
  return mode === 'private';
}

// Android context.close() drops the CDP socket only. A tab stays until this path closes it.
const DEFAULT_TAB_CLOSE_TIMEOUT_MS = 5_000;
const LATE_TAB_SETTLE_MS = 250;

function tabCloseTimeoutMs() {
  const raw = parseInt(process.env.PWM_TAB_CLOSE_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TAB_CLOSE_TIMEOUT_MS;
}

function livePages(context) {
  if (typeof context.pages !== 'function') return [];
  try {
    return context.pages().filter((p) => !p.isClosed());
  } catch {
    return [];
  }
}

// A stuck renderer can hang page.close() with no end.
async function closeTab(page) {
  let timer;
  const closed = Promise.resolve().then(() => page.close()).catch(() => {});
  try {
    await Promise.race([
      closed,
      new Promise((resolve) => { timer = setTimeout(resolve, tabCloseTimeoutMs()); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// context.pages() omits new targets. A second pass finds tabs that appear after the first.
async function pruneTabs(context, keep) {
  for (let pass = 0; pass < 2; pass++) {
    const doomed = livePages(context).filter((p) => p !== keep);
    if (!doomed.length) break;
    await Promise.all(doomed.map(closeTab));
    if (pass === 0) await new Promise((resolve) => setTimeout(resolve, LATE_TAB_SETTLE_MS));
  }
  return livePages(context).filter((p) => p !== keep).length;
}

async function sweepTabs(context, keep, phase) {
  try {
    const leftover = await pruneTabs(context, keep);
    if (leftover) console.warn(`android: ${leftover} tab(s) survived the ${phase} sweep`);
  } catch {}
}

// This is the tab that launchBrowser() opened. Other pages come from Chrome restore.
function launchPage(context) {
  const pages = livePages(context);
  return pages.find((p) => p.url() === 'about:blank') || pages[0] || null;
}

// Only CDP-visible incognito path on Android. Chrome has no launch incognito flag.
const INCOGNITO_LAUNCHER = 'org.chromium.chrome.browser.incognito.IncognitoTabLauncher';
const INCOGNITO_PAGE_TIMEOUT_MS = 10_000;

/**
 * Opens an incognito tab and keeps it as the only page.
 * @returns {Promise<object|null>} Incognito page, or null if the tab does not appear.
 */
async function openIncognitoPage(connection, context, pkg) {
  const before = new Set(context.pages());
  const arrival = context.waitForEvent('page', { timeout: INCOGNITO_PAGE_TIMEOUT_MS }).catch(() => null);
  let started = true;
  try {
    await connection.shell(`am start -n ${pkg}/${INCOGNITO_LAUNCHER}`);
  } catch {
    started = false;
  }
  let incognito = started ? await arrival : null;
  if (!incognito) incognito = context.pages().find((p) => !before.has(p)) || null;
  // The intent can open a tab even when the start command fails.
  if (!incognito) {
    await pruneTabs(context, [...before][0] || launchPage(context));
    return null;
  }
  await pruneTabs(context, incognito);
  return incognito;
}

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

// args and pkg are launch-only. Do not forward them as Playwright use options.
const FORWARDED_USE_KEYS = LAUNCH_BROWSER_KEYS.filter((key) => key !== 'args' && key !== 'pkg');

// launchBrowser() skips the runBeforeCreateBrowserContext hook. Forward use options here.
function forwardedUseOptions(useOptions) {
  const use = useOptions || {};
  const opts = {};
  for (const source of [use.contextOptions, use]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of FORWARDED_USE_KEYS) {
      if (source[key] !== undefined) opts[key] = source[key];
    }
  }
  return opts;
}

const NO_TIMEOUT = { signal: undefined, timeout: 0 };

// launchBrowser() skips selector registration that newContext() applies. Replay engines here.
async function applyRegisteredSelectors(context) {
  const channel = context._channel;
  if (!channel || typeof channel.registerSelectorEngine !== 'function') return;
  for (const selectorEngine of selectors._selectorEngines || []) {
    await channel.registerSelectorEngine({ selectorEngine }, NO_TIMEOUT);
  }
  const testIdAttributeName = selectors._testIdAttributeName;
  if (!testIdAttributeName || typeof channel.setTestIdAttributeName !== 'function') return;
  context._options.testIdAttributeName = testIdAttributeName;
  await channel.setTestIdAttributeName({ testIdAttributeName }, NO_TIMEOUT);
}

function buildLaunchBrowserOptions(caps) {
  const opts = {};
  for (const key of LAUNCH_BROWSER_KEYS) {
    if (caps[key] !== undefined) opts[key] = caps[key];
  }
  // Private mode uses IncognitoTabLauncher after launch, not launch args.
  opts.args = [
    ...SESSION_RESTORE_DISABLE_ARGS,
    ...SCREEN_CAPTURE_FEATURE_ARGS,
    ...(Array.isArray(caps.args) ? caps.args : []),
  ];
  return opts;
}

/**
 * Resolves the local Chromium device preset from the capability device name.
 */
function resolveAndroidDevicePreset(deviceName) {
  return resolveCustomAndroidPreset(deviceName, devices)
    || devices[DEFAULT_LOCAL_ANDROID_DEVICE]
    || {};
}

// Use ADB only when a serial or PWM_ANDROID_ADB is set.
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

/**
 * Parse the Android and Chrome versions from a Chromium user agent, e.g.
 * "...Linux; Android 14; Pixel 7... Chrome/145.0.7632.6 Mobile Safari/537.36".
 * A local pre-flight runs Playwright's bundled Chromium, whose Chrome version
 * tracks the installed Playwright build; the Android OS token is frozen per
 * device model in Playwright's descriptors.
 */
function parseChromiumVersions(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const osMatch = /Android (\d+(?:\.\d+)*)/.exec(ua);
  const chromeMatch = /Chrome\/(\d+(?:\.\d+)*)/.exec(ua);
  return {
    osVersion: osMatch ? osMatch[1] : '',
    browserVersion: chromeMatch ? chromeMatch[1] : '',
  };
}

const contextBrowserVersion = new WeakMap();

// Local pre-flight (chromium.launch) contexts. Reporting versions are derived
// from the preset user agent for these only; real device/ADB runs are untouched.
const preflightContexts = new WeakSet();

// ArtifactsRecorder skips launchBrowser() contexts. Capture screenshots in onPageTeardown.
const contextsWithoutArtifactRail = new WeakSet();

// No sweep is stored when tab prune is off.
const contextTabSweep = new WeakMap();

const SCREENSHOT_TIMEOUT_MS = 10_000;

function resolveScreenshotOption(testInfo) {
  const configured = testInfo?.project?.use?.screenshot;
  if (!configured) return { mode: 'off', options: {} };
  if (typeof configured === 'string') return { mode: configured, options: {} };
  const { mode, ...options } = configured;
  return { mode: mode || 'off', options };
}

function shouldCaptureScreenshot(mode, testInfo) {
  if (mode === 'on') return true;
  const failed = testInfo.status !== testInfo.expectedStatus;
  if (mode === 'only-on-failure') return failed;
  if (mode === 'on-first-failure') return failed && testInfo.retry === 0;
  return false;
}

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

  unsupportedUseOptions: UNSUPPORTED_USE_OPTIONS,

  async connect(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    const wsEndpoint = resolveWsEndpoint('Android');
    if (wsEndpoint) {
      return android.connect(wsEndpoint, {
        timeout: connectTimeoutMs,
        slowMo: slowMoMs,
        headers: buildConnectHeaders(caps, 'Android'),
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

  // A farm run requires deviceName or deviceUuid. A local run does not.
  resolveDeviceInfo(capabilities) {
    const caps = effectiveCapabilities(capabilities);
    if (resolveWsEndpoint('Android') && !caps.deviceName && !caps.deviceUuid) {
      throw new Error(
        'capabilities.deviceName or capabilities.deviceUuid is required for Android device '
        + 'runs — set one (or both) in the project capabilities (playwright.config.js).',
      );
    }
    return {
      deviceName: caps.deviceName || '',
      platformName: caps.platformName || 'Android',
      osVersion: '',
    };
  },

  resolvePreset(deviceInfo) {
    return resolveAndroidDevicePreset(deviceInfo.deviceName);
  },

  // A device run is an AndroidDevice. Only a local run is a Browser.
  resolveBrowser(connection) {
    if (typeof connection.newContext === 'function') return connection;
    throw new Error(
      'The `browser` fixture is not available on an Android device run — the connection is an '
      + 'AndroidDevice (farm run, or an ADB run pinned by capabilities.serial / ANDROID_SERIAL), '
      + 'not a Browser. Use `context` / `page`, `context.newPage()` for a second tab, or the '
      + '`request` fixture for API calls.',
    );
  },

  // AndroidDevice for native UI and ADB. A local Chromium run has no device.
  resolveDevice(connection) {
    if (typeof connection.launchBrowser !== 'function') {
      throw new Error(
        'The `device` fixture requires an Android device run — this worker is a local pre-flight '
        + 'Chromium, which has no device behind it. Pin a connected device with '
        + 'capabilities.serial / ANDROID_SERIAL, or point the run at the farm '
        + '(PWM_ORCHESTRATOR / ANDROID_WS_ENDPOINT).',
      );
    }
    return makeDeviceProxy(connection);
  },

  async createContext(connection, { preset, extraContextOptions, capabilities, useOptions, testInfo }) {
    const caps = effectiveCapabilities(capabilities);
    const mode = normalizeBrowsingMode(caps.browsingMode);
    if (typeof connection.launchBrowser === 'function') {
      const pkg = caps.pkg || 'com.android.chrome';
      const pruneTabsEnabled = gateFlag(caps.closeTabAfterTest) !== false;
      await connection.shell(`am force-stop ${pkg}`);
      // Restored tabs with no CDP target stay hidden from a sweep. Only pm clear removes them.
      if (gateFlag(caps.resetBrowserData) === true) {
        try {
          await connection.shell(`pm clear ${pkg}`);
        } catch (error) {
          console.warn(`android: pm clear ${pkg} failed (${error.message}); keeping the existing profile`);
        }
      }
      const launchOptions = {
        ...forwardedUseOptions(useOptions),
        ...buildLaunchBrowserOptions(caps),
        ...extraContextOptions,
      };
      // Playwright gates locator.tap on hasTouch. A physical device always has touch.
      launchOptions.hasTouch = gateFlag(launchOptions.hasTouch) ?? true;
      const context = await connection.launchBrowser(launchOptions);
      await applyRegisteredSelectors(context);
      contextBrowserVersion.set(context, await readBrowserVersion(connection, pkg));
      contextsWithoutArtifactRail.add(context);
      if (pruneTabsEnabled) await sweepTabs(context, launchPage(context), 'launch');
      if (isPrivateMode(mode) && !(await openIncognitoPage(connection, context, pkg))) {
        console.warn(`android: incognito tab did not surface for mode '${mode}'; continuing in normal profile`);
      }
      patchContextNewPage(context, ensureAndroidPrototypesPatched);
      if (pruneTabsEnabled) {
        const sweep = () => sweepTabs(context, null, 'teardown');
        contextTabSweep.set(context, sweep);
        patchContextClose(context, sweep);
      }
      return context;
    }
    const video = preflightVideoOptions('Android', useOptions, extraContextOptions, testInfo);
    const context = await connection.newContext({
      ...preset,
      ...(video ? { recordVideo: video.recordVideo } : {}),
      ...extraContextOptions,
    });
    patchContextNewPage(context, ensureAndroidPrototypesPatched);
    if (video) installPreflightVideoCapture(context, testInfo, video.mode);
    preflightContexts.add(context);
    return context;
  },

  // Safe to call twice. A closed context already ran this sweep.
  async onContextTeardown(context) {
    const sweep = contextTabSweep.get(context);
    if (sweep) await sweep();
  },

  async createPage(context, { deviceInfo, testInfo } = {}) {
    // launchBrowser() already opened a tab. newPage() would leave that tab and miss incognito.
    const existing = typeof context.pages === 'function' ? context.pages() : [];
    const page = existing[0] || await context.newPage();
    ensureAndroidPrototypesPatched(page);

    // A local or ADB run has no bridge. The RPC fails and sessionId stays empty.
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

    // A real Android device carries both an Android version (bridge) and a
    // Chrome version (adb). A local pre-flight has neither source, so derive
    // both from the resolved device preset's Chromium user agent. A real
    // device/ADB run keeps its live values and is never touched here.
    if (preflightContexts.has(context)) {
      const preset = resolveAndroidDevicePreset(resolvedDeviceInfo.deviceName);
      const { osVersion, browserVersion: chromeVersion } = parseChromiumVersions(preset && preset.userAgent);
      resolvedDeviceInfo = {
        ...resolvedDeviceInfo,
        ...(osVersion ? { osVersion } : {}),
        ...(chromeVersion ? { browserVersion: chromeVersion } : {}),
      };
    }

    // Attach for both device and pre-flight runs so the reporter shows accurate
    // Browser/Platform data in either mode. sessionId is empty on a pre-flight;
    // the reporter still records the attached capabilities.
    const reportingCapabilities = buildSessionCapabilities('Android', resolvedDeviceInfo);
    attachSessionCapabilities(sessionId, reportingCapabilities);
    attachDeviceLabel(resolvedDeviceInfo.deviceName);
    return page;
  },

  async onPageTeardown(page, testInfo) {
    if (page.isClosed() || !contextsWithoutArtifactRail.has(page.context())) return;
    const { mode, options } = resolveScreenshotOption(testInfo);
    if (!shouldCaptureScreenshot(mode, testInfo)) return;
    try {
      const buffer = await page.screenshot({
        ...options,
        caret: 'initial',
        timeout: SCREENSHOT_TIMEOUT_MS,
      });
      await testInfo.attach('screenshot', { body: buffer, contentType: 'image/png' });
    } catch {}
  },
};

module.exports = driver;
module.exports.parseChromiumVersions = parseChromiumVersions;
