// Android Chrome platform driver. With a farm endpoint it connects to the
// orchestrator (/playwright); with an explicit ADB serial it drives a connected
// device; otherwise it launches a local Chromium with the caps device preset
// (viewport emulation) for local pre-flight validation.
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
const { defineThrowing } = require('../../core/unsupported');
const { patchContextNewPage, patchContextClose } = require('../../core/context-patch');
const { UNSUPPORTED_PAGE_METHODS, UNSUPPORTED_USE_OPTIONS } = require('./unsupported-android');
const { makeBridgeProxy } = require('./bridge-proxy');
const { makeDeviceProxy } = require('./device-proxy');
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

// Chrome sets FLAG_SECURE on incognito windows, which blacks out the farm's screen
// recording. CDPScreenshotNewSurface is repeated because Playwright emits its own
// --enable-features before ours and Chrome keeps only the last occurrence.
const SCREEN_CAPTURE_FEATURE_ARGS = [
  '--enable-features=CDPScreenshotNewSurface,IncognitoScreenshot,ImprovedIncognitoScreenshot',
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

// launchBrowser() opens a tab per test (`am start -d about:blank`) and Android
// context.close() only drops the CDP socket, so nothing but this closes a tab.
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

// A wedged renderer can hang page.close() forever; teardown budget is shared.
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

// context.pages() omits targets that are still initializing, so a second pass picks
// up tabs (mid-flight popups, tabs Chrome restored) that surfaced during the first.
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

// The tab launchBrowser() just opened; every other page is one Chrome restored.
function launchPage(context) {
  const pages = livePages(context);
  return pages.find((p) => p.url() === 'about:blank') || pages[0] || null;
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
  let started = true;
  try {
    await connection.shell(`am start -n ${pkg}/${INCOGNITO_LAUNCHER}`);
  } catch {
    started = false;
  }
  let incognito = started ? await arrival : null;
  if (!incognito) incognito = context.pages().find((p) => !before.has(p)) || null;
  // The intent can open a tab even when it reports failure or never surfaces here.
  if (!incognito) {
    await pruneTabs(context, [...before][0] || launchPage(context));
    return null;
  }
  await pruneTabs(context, incognito);
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

// `args` and `pkg` are launch-only capabilities, never Playwright `use` options.
const FORWARDED_USE_KEYS = LAUNCH_BROWSER_KEYS.filter((key) => key !== 'args' && key !== 'pkg');

// launchBrowser() skips Playwright's runBeforeCreateBrowserContext hook, so the
// project's `use` options only reach a device context if the driver forwards them.
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

// launchBrowser() skips the selector plumbing newContext() gets, so anything
// registered before the device context existed has to be replayed onto it.
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
  // Private isolation is handled post-launch via IncognitoTabLauncher (Chrome for
  // Android has no CDP incognito flag), not through launch args.
  opts.args = [
    ...SESSION_RESTORE_DISABLE_ARGS,
    ...SCREEN_CAPTURE_FEATURE_ARGS,
    ...(Array.isArray(caps.args) ? caps.args : []),
  ];
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

// ArtifactsRecorder scans only chromium/firefox/webkit `_contexts`, so launchBrowser()
// contexts get no `use.screenshot` capture and newContext() ones must not be captured twice.
const contextsWithoutArtifactRail = new WeakSet();

// Teardown sweep per device context, shared by the fixture hook and the wrapped
// context.close(); absent when the run opted out of tab pruning.
const contextTabSweep = new WeakMap();

// The page createPage handed to the test, kept as the survivor of a single-tab sweep.
const contextPrimaryPage = new WeakMap();

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

  // A device run connects as an AndroidDevice; only a local pre-flight run has a Browser.
  resolveBrowser(connection) {
    if (typeof connection.newContext === 'function') return connection;
    throw new Error(
      'The `browser` fixture is not available on an Android device run — the connection is an '
      + 'AndroidDevice (farm run, or an ADB run pinned by capabilities.serial / ANDROID_SERIAL), '
      + 'not a Browser. Use `context` / `page`, `context.newPage()` for a second tab, or the '
      + '`request` fixture for API calls.',
    );
  },

  // The same AndroidDevice the context is launched from, exposed for UIAutomator
  // and adb work that reaches native UI outside the web contents. Only a real
  // device run has one; local pre-flight Chromium is not backed by a device.
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

  async createContext(connection, { preset, extraContextOptions, capabilities, useOptions }) {
    const caps = effectiveCapabilities(capabilities);
    const mode = normalizeBrowsingMode(caps.browsingMode);
    // A real device (farm or ADB) exposes launchBrowser; local Chromium exposes newContext.
    if (typeof connection.launchBrowser === 'function') {
      const pkg = caps.pkg || 'com.android.chrome';
      const pruneTabsEnabled = gateFlag(caps.closeTabAfterTest) !== false;
      await connection.shell(`am force-stop ${pkg}`);
      // Tabs Chrome restores without reloading have no CDP target, so a sweep can
      // never see them; wiping browser data is the only way to reclaim those.
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
      // Playwright gates locator.tap/touchscreen on hasTouch; a physical device always has touch.
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
        const sweep = () => sweepTabs(
          context,
          isSingleTab(mode) ? contextPrimaryPage.get(context) || null : null,
          'teardown',
        );
        contextTabSweep.set(context, sweep);
        patchContextClose(context, sweep);
      }
      return context;
    }
    const context = await connection.newContext({ ...preset, ...extraContextOptions });
    patchContextNewPage(context, ensureAndroidPrototypesPatched);
    return context;
  },

  // Idempotent: a test that closed the context already ran this through the wrap.
  async onContextTeardown(context) {
    const sweep = contextTabSweep.get(context);
    if (sweep) await sweep();
  },

  async createPage(context, { deviceInfo, testInfo } = {}) {
    // launchBrowser() already opened a tab; newPage() here would strand it, and in
    // private mode it would also land outside the adopted incognito tab.
    const existing = typeof context.pages === 'function' ? context.pages() : [];
    const page = existing[0] || await context.newPage();
    ensureAndroidPrototypesPatched(page);
    contextPrimaryPage.set(context, page);

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
