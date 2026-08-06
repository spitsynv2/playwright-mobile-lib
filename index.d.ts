import {
  Browser,
  Page,
  Locator,
  BrowserContextOptions,
  PlaywrightTestConfig,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import type {
  AndroidDevice,
  BrowserContext as CoreBrowserContext,
  Locator as CoreLocator,
  Mouse as CoreMouse,
  Page as CorePage,
} from 'playwright';

export * from '@playwright/test';

type PlaywrightDevices = typeof import('@playwright/test').devices;
type DeviceDescriptor = PlaywrightDevices[string];

/**
 * Resolve a Playwright device preset (viewport / userAgent metadata) for an iOS
 * device name, including this library's custom iPhone presets and aliases.
 *
 * @param deviceName Device name or alias (e.g. `"iPhone 16 Plus"`, `"iphone xr"`).
 * @param playwrightDevices The Playwright `devices` catalog to extend.
 * @returns The resolved preset, or `null` when the name is unknown.
 */
export function resolveIOSDevicePreset(
  deviceName: string,
  playwrightDevices: PlaywrightDevices,
): DeviceDescriptor | null;

/**
 * Run `fn` with the iOS Safari bridge switched to Appium (native) input mode,
 * restoring the previous mode afterwards. iOS only.
 *
 * Prefer `page.appium.*` / `locator.appium.*` for single calls; use this to wrap
 * a block of interactions that must all run in Appium input mode.
 */
export function withAppiumInputMode<T>(page: Page, fn: () => Promise<T> | T): Promise<T>;

/** Per-container log verbosity. `'off'` disables that component's configured debug logging. */
export type LogLevel = 'off' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * On/off capability. Prefer a boolean; `'true'` / `'false'` (also `'1'` / `'0'`)
 * are accepted so an environment variable can be passed through unparsed.
 * Farm validation rejects invalid strings; local drivers treat them as unset.
 */
export type GateFlag = boolean | 'true' | 'false' | (string & {});

/** Container log sources; `inspector` is iOS-only. */
export type SessionLogName = 'bridge' | 'pwserver' | 'inspector';

/**
 * Tab/browsing mode requested at connect time. Defaults to `private`.
 *
 * `private` browses without persisting history or site data; `public` browses in
 * the normal profile. A `single-tab-*` mode reuses one tab for the whole run
 * instead of opening a tab per page.
 *
 * iOS Safari honors all four with full isolation. On Android, `private` is
 * best-effort: where the device's browser cannot provide an isolated tab, the
 * run continues in the normal profile with a warning instead of failing, and
 * `single-tab-*` is iOS-only — Chrome is relaunched per test, so no tab survives
 * one, and the run falls back to `public` / `private` with a warning.
 */
export type BrowsingMode =
  | 'public'
  | 'private'
  | 'single-tab-public'
  | 'single-tab-private'
  /** @deprecated Use `'single-tab-public'`. Accepted for compatibility and treated as `'single-tab-public'`. */
  | 'single-tab';

/**
 * iOS device names this library resolves to a Playwright preset, including its
 * own iPhone presets. Any other Playwright device name is also accepted.
 */
export type IOSDeviceName =
  | 'iPhone 16'
  | 'iPhone 16 landscape'
  | 'iPhone 16 Plus'
  | 'iPhone 16 Plus landscape'
  | 'iPhone XR'
  | (string & {});

/**
 * Context options forwarded to the Android Chrome browser launch. Mirrors the
 * `BrowserContextOptions` subset the Android context honors, plus its two
 * launch-only keys.
 */
type AndroidLaunchCapabilities = Pick<
  BrowserContextOptions,
  | 'acceptDownloads'
  | 'baseURL'
  | 'bypassCSP'
  | 'colorScheme'
  | 'contrast'
  | 'deviceScaleFactor'
  | 'extraHTTPHeaders'
  | 'forcedColors'
  | 'geolocation'
  | 'hasTouch'
  | 'httpCredentials'
  | 'ignoreHTTPSErrors'
  | 'isMobile'
  | 'javaScriptEnabled'
  | 'locale'
  | 'offline'
  | 'permissions'
  | 'proxy'
  | 'recordHar'
  | 'recordVideo'
  | 'reducedMotion'
  | 'screen'
  | 'serviceWorkers'
  | 'strictSelectors'
  | 'timezoneId'
  | 'userAgent'
  | 'viewport'
> & {
  /** Android: extra command-line flags for the launched browser. Merged after the driver's own flags. */
  args?: string[];
  /** Android: browser package to launch. Defaults to `"com.android.chrome"`. */
  pkg?: string;
};

/**
 * Desired capabilities for a project/run. Sent to the orchestrator as the
 * `x-pwm-capabilities` connect header, which pool-matches a free device. Set
 * per-project via `use: { capabilities }`.
 */
export interface Capabilities extends AndroidLaunchCapabilities {
  /** Selects the platform driver and orchestrator route. Required. */
  platformName: 'iOS' | 'Android';
  /** Device pool-match filter (e.g. `"iPhone 16 Plus"`, `"Pixel 3 XL"`). Spaces/underscores/hyphens/case are interchangeable. For iOS farm runs, provide this and/or `deviceUuid`. */
  deviceName?: IOSDeviceName;
  /** iOS device UDID pool-match filter. For iOS farm runs, provide this and/or `deviceName`. */
  deviceUuid?: string;
  /** Android device serial for direct-ADB selection (or set `ANDROID_SERIAL`). */
  serial?: string;
  /** OS version pool-match filter. */
  osVersion?: string;
  /**
   * Tab/browsing mode. Full parity on iOS; documented subset on Android.
   * Defaults to `private` on both.
   *
   * Any string is accepted so an environment variable can be passed through
   * unparsed; an unrecognized mode throws when the session starts.
   */
  browsingMode?: BrowsingMode | (string & {});
  /** iOS: skip Safari history/data cleanup when the bridge starts. */
  skipSafariCleanup?: GateFlag;
  /**
   * Close the tab after each test. iOS closes the native tab; Android sweeps the
   * context's tabs both when the browser is launched and before the context closes.
   */
  closeTabAfterTest?: GateFlag;
  /**
   * Android: clear the browser package's data before each launch. Off by default.
   * Tabs Chrome restores without reloading have no CDP target and cannot be swept,
   * so this is the only way to reclaim them — at the cost of the whole profile.
   */
  resetBrowserData?: GateFlag;
  /** iOS: bridge nav-kick retry gate. */
  navKickEnabled?: GateFlag;
  /** iOS: bridge click-nav retry gate. */
  clickNavRetriesEnabled?: GateFlag;
  /** Per-container verbosity; Android uses `bridge` and `pwserver`, while `inspector` is iOS-only. */
  logLevels?: Partial<Record<SessionLogName, LogLevel>>;
}

/** Worker-scoped options added by this library. */
export interface MobileWorkerOptions {
  /** Desired capabilities; selects the platform driver and pool-matches a device. */
  capabilities: Capabilities;
}

/** The device the worker is actually running against, as resolved by the platform driver. */
export interface DeviceInfo {
  deviceName: string;
  platformName: string;
  osVersion: string;
  /** Android: browser build read from the device. */
  browserVersion?: string;
}

/** Read-only worker-scoped fixtures added by this library. */
export interface MobileWorkerFixtures {
  /**
   * Android device runs only: the `AndroidDevice` the context was launched from.
   * Gives UIAutomator selectors (`tap` / `fill` / `wait` / `info` / `press`) and
   * `shell()`, which reach native UI outside the web contents — system permission
   * sheets, the download bar, intent choosers.
   *
   * Reading it throws on iOS (use `page.bridge.acceptAlert` / `page.bridge.nativeInput`)
   * and on a local pre-flight run, which has no device. `close` and `launchBrowser`
   * are blocked because the `_connection` and `context` fixtures own them.
   */
  device: AndroidDevice;
  /** Resolved device metadata for this worker's session. */
  deviceInfo: DeviceInfo;
  /** Playwright device preset (viewport / userAgent metadata) resolved from {@link DeviceInfo}. */
  devicePreset: DeviceDescriptor;
}

/** Test-scoped options added by this library. */
export interface MobileTestOptions {
  /** iOS only: reopen `page` in a fresh tab of this mode before the test body. */
  reopenInMode: 'private' | 'public' | undefined;
  /** Extra options merged into the fixture context (iOS `newContext` / Android `launchBrowser`). */
  extraContextOptions: BrowserContextOptions;
}

/** @deprecated Use {@link MobileWorkerOptions}. */
export type IOSWorkerOptions = MobileWorkerOptions;
/** @deprecated Use {@link MobileTestOptions}. */
export type IOSTestOptions = MobileTestOptions;

/**
 * Worker-scoped Playwright fixtures, with `browser` re-pointed at the platform
 * connection instead of a locally launched browser.
 */
type MobilePlaywrightWorkerArgs = Omit<PlaywrightWorkerArgs, 'browser'> & {
  /**
   * The worker's browser connection. iOS gives the bridge WebKit `Browser`; a
   * local pre-flight run gives the launched `Browser`. Reading it throws on an
   * Android device run, where the connection is an `AndroidDevice` — use
   * `context` / `page` there.
   */
  browser: Browser;
};

/**
 * Cross-platform Playwright `test`. The platform is chosen from
 * `capabilities.platformName` (`'iOS'` -> Safari bridge, `'Android'` -> Chrome).
 * `page.bridge` exists on both platforms with a per-platform op set; the
 * iOS-only extras (`page.appium`, `page.setBrowsingMode`, `reopenInMode`) are
 * no-ops / unavailable on Android.
 */
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & MobileTestOptions,
  MobilePlaywrightWorkerArgs & PlaywrightWorkerOptions & MobileWorkerOptions & MobileWorkerFixtures
>;

/**
 * `defineConfig` typed with this library's worker/test options (e.g.
 * `capabilities`). Mirrors Playwright's overloads, so consumer option fixtures
 * and the `defineConfig(base, override)` merge form both type-check.
 */
export function defineConfig(
  config: PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>,
): PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>;
export function defineConfig<T>(config: PlaywrightTestConfig<T>): PlaywrightTestConfig<T>;
export function defineConfig<T, W>(config: PlaywrightTestConfig<T, W>): PlaywrightTestConfig<T, W>;
export function defineConfig(
  config: PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>,
  ...configs: PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>[]
): PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>;
export function defineConfig<T>(
  config: PlaywrightTestConfig<T>,
  ...configs: PlaywrightTestConfig<T>[]
): PlaywrightTestConfig<T>;
export function defineConfig<T, W>(
  config: PlaywrightTestConfig<T, W>,
  ...configs: PlaywrightTestConfig<T, W>[]
): PlaywrightTestConfig<T, W>;

/** Bridge operations available on both platforms through `page.bridge.<op>(args?)`. */
interface BridgeCommonOps {
  /** Return the bridge's per-test session id (used to correlate video/logs). */
  getSessionId(args?: Record<string, never>): Promise<string>;
  /** Return the selected device metadata (deviceName / platformName / osVersion). */
  getDeviceInfo(args?: Record<string, never>): Promise<string>;
}

/** Bridge operations served by the Android Chrome bridge. */
interface AndroidBridgeKnownOps extends BridgeCommonOps {}

/** Bridge operations served by the iOS Safari bridge. */
interface IOSBridgeKnownOps extends BridgeCommonOps {
  /** Set the bridge input mode: `'js'` injection (default) or `'appium'` native input. */
  setInputMode(args: { mode: 'js' | 'appium' }): Promise<string>;
  /** Switch the Safari tab group to private/public. Prefer `page.setBrowsingMode`. */
  setBrowsingMode(args: { mode: 'private' | 'public' }): Promise<string>;
  /** Clear Safari history. Invalidates the current page (its WebContent process is torn down). */
  clearSafariHistory(args?: Record<string, never>): Promise<string>;
  /** Report whether this page's Safari tab is currently foreground. */
  isForeground(args?: Record<string, never>): Promise<string>;
  /** Accept or dismiss a native alert, optionally by button label. */
  acceptAlert(args?: {
    action?: 'accept' | 'dismiss';
    buttonLabel?: string;
    timeoutMs?: number;
  }): Promise<'true' | 'false'>;
  /** Drive native (Appium/WDA) input against XCUIElements by xpath/label. */
  nativeInput(args: {
    timeoutMs?: number;
    actions: Array<{
      type: 'fill' | 'tap';
      xpath?: string;
      elementLabel?: string;
      value?: string;
    }>;
  }): Promise<'true'>;
  /** Toggle the bridge's post-navigation retry behavior. */
  setNavRetries(args: { enabled: boolean }): Promise<'true' | 'false'>;
}

// Any op the connected bridge registers is auto-callable; the index signature
// keeps that open-ended surface typed alongside the known ops. Ops outside
// AndroidBridgeKnownOps reject on Android, and vice versa.
type BridgeApi = IOSBridgeKnownOps & AndroidBridgeKnownOps & {
  [op: string]: (args?: Record<string, unknown>) => Promise<unknown>;
};

declare module '@playwright/test' {
  interface PlaywrightWorkerOptions {
    /** Desired capabilities; selects the platform driver and pool-matches a device. */
    capabilities: Capabilities;
  }

  interface PlaywrightTestOptions {
    /** iOS only: reopen `page` in a fresh tab of this mode before the test body. */
    reopenInMode: 'private' | 'public' | undefined;
    /** Extra options merged into the fixture context (iOS `newContext` / Android `launchBrowser`). */
    extraContextOptions: BrowserContextOptions;
  }

  interface Page {
    /** iOS only: proxy that runs the forwarded Page call in Appium (native) input mode. */
    readonly appium: Page;
    /** Dynamic bridge RPC — `page.bridge.<op>(args?)`. iOS serves the full op set; Android serves {@link AndroidBridgeKnownOps}. */
    readonly bridge: BridgeApi;
    /**
     * iOS only: switch the Safari browsing mode. This spawns a fresh tab the
     * bridge adopts as a new page, so use the returned `Page` afterwards.
     */
    setBrowsingMode(mode: 'private' | 'public', options?: { timeout?: number }): Promise<Page>;

    /** @deprecated Page.setViewportSize() is unsupported on this device — physical device viewport — use device-pool selection instead. Throws at runtime. */
    setViewportSize: CorePage['setViewportSize'];
    /** @deprecated iOS: Page.emulateMedia() is unsupported on this device — iOS system-level setting — faked CSS would misreport Safari's real layout. Throws at runtime. */
    emulateMedia: CorePage['emulateMedia'];
    /** @deprecated iOS: Page.hover() is unsupported on this device — iOS Safari has no hover; touch devices fire pointer events on tap only. Throws at runtime. */
    hover: CorePage['hover'];
    /** @deprecated iOS: Page.setInputFiles() is unsupported on this device — native file picker is not driveable cleanly on a shared device. Throws at runtime. */
    setInputFiles: CorePage['setInputFiles'];
  }

  interface Locator {
    /** iOS only: proxy that runs the forwarded Locator call in Appium (native) input mode. */
    readonly appium: Locator;

    /** @deprecated iOS: Locator.hover() is unsupported on this device — iOS Safari has no hover; touch devices fire pointer events on tap only. Throws at runtime. */
    hover: CoreLocator['hover'];
    /** @deprecated iOS: Locator.setInputFiles() is unsupported on this device — native file picker is not driveable cleanly on a shared device. Throws at runtime. */
    setInputFiles: CoreLocator['setInputFiles'];
  }

  interface Mouse {
    /** @deprecated iOS: Mouse.wheel() is unsupported on this device — iOS has no wheel/trackpad input modality — scroll via touch (scrollIntoViewIfNeeded / evaluate(scrollBy)). Throws at runtime. */
    wheel: CoreMouse['wheel'];
  }

  interface BrowserContext {
    /** @deprecated iOS: BrowserContext.cookies() is unsupported on this device — shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump. Throws at runtime. */
    cookies: CoreBrowserContext['cookies'];
    /** @deprecated iOS: BrowserContext.addCookies() is unsupported on this device — shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump. Throws at runtime. */
    addCookies: CoreBrowserContext['addCookies'];
    /** @deprecated iOS: BrowserContext.clearCookies() is unsupported on this device — shared device cookie jar — no per-context isolation; Page.setCookie bricks the inspector pump. Throws at runtime. */
    clearCookies: CoreBrowserContext['clearCookies'];
    /** @deprecated iOS: BrowserContext.storageState() is unsupported on this device — includes cookies from the shared device jar — no per-context isolation to read or restore. Throws at runtime. */
    storageState: CoreBrowserContext['storageState'];
    /** @deprecated iOS: BrowserContext.grantPermissions() is unsupported on this device — permissions are owned by iOS Settings + system prompts, not per-context on a shared device. Throws at runtime. */
    grantPermissions: CoreBrowserContext['grantPermissions'];
    /** @deprecated iOS: BrowserContext.clearPermissions() is unsupported on this device — permissions are owned by iOS Settings + system prompts, not per-context on a shared device. Throws at runtime. */
    clearPermissions: CoreBrowserContext['clearPermissions'];
    /** @deprecated iOS: BrowserContext.setGeolocation() is unsupported on this device — real GPS — override needs physical movement or an Xcode dev profile. Throws at runtime. */
    setGeolocation: CoreBrowserContext['setGeolocation'];
    /** @deprecated iOS: BrowserContext.setOffline() is unsupported on this device — only airplane mode toggles offline, which kills the inspector WebSocket. Throws at runtime. */
    setOffline: CoreBrowserContext['setOffline'];
  }
}
