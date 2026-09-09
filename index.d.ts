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
 * Resolve a Playwright device preset for an iOS device name or alias.
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
 * Run `fn` in Appium (native) input mode on iOS, then restore the previous mode.
 * Prefer `page.appium.*` or `locator.appium.*` for one call.
 * A local pre-flight has no bridge and runs `fn` with no mode change.
 */
export function withAppiumInputMode<T>(page: Page, fn: () => Promise<T> | T): Promise<T>;

/** Remote session log level. `'off'` disables logs from the selected source. */
export type LogLevel = 'off' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * On/off capability. Prefer a boolean. Also accepts `'true'`, `'false'`, `'1'`, and `'0'`.
 * The library rejects invalid strings at remote session setup.
 */
export type GateFlag = boolean | 'true' | 'false' | (string & {});

/** Remote session log sources. `inspector` is iOS-only. */
export type SessionLogName = 'bridge' | 'playwrightServer' | 'inspector';

/**
 * Tab mode at connect time. The default is `private`.
 * `private` does not persist history or site data. `public` uses the normal profile.
 * A `single-tab-*` mode reuses one tab for the run.
 * iOS Safari supports all four modes with isolation.
 * Android can use the normal profile for `private` and emit a warning.
 * Android maps `single-tab-*` to `public` or `private` with a warning.
 */
export type BrowsingMode =
  | 'public'
  | 'private'
  | 'single-tab-public'
  | 'single-tab-private'
  /** @deprecated Use `'single-tab-public'`. Accepted for compatibility and treated as `'single-tab-public'`. */
  | 'single-tab';

/**
 * iOS device names this library maps to a Playwright preset, plus its own iPhone presets.
 * Any other Playwright device name is also accepted.
 */
export type IOSDeviceName =
  | 'iPhone 16'
  | 'iPhone 16 landscape'
  | 'iPhone 16 Plus'
  | 'iPhone 16 Plus landscape'
  | 'iPhone XR'
  | (string & {});

/**
 * Context options for the Android Chrome browser launch.
 * The type is a `BrowserContextOptions` subset plus `args` and `pkg`.
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
  /** Android: extra command-line flags for the browser. The driver merges these after its own flags. */
  args?: string[];
  /** Android: browser package to launch. Defaults to `"com.android.chrome"`. */
  pkg?: string;
};

/**
 * Desired capabilities for a project or run. Set these per project with
 * `use: { capabilities }`.
 */
export interface Capabilities extends AndroidLaunchCapabilities {
  /** Selects the platform. Required. */
  platformName: 'iOS' | 'Android';
  /** Remote device selector (e.g. `"iPhone 16 Plus"`, `"Pixel 3 XL"`). For a remote run, set this, `deviceUuid`, or both. */
  deviceName?: IOSDeviceName;
  /** Remote device UUID: UDID on iOS, ADB serial on Android. For a remote run, set this, `deviceName`, or both. */
  deviceUuid?: string;
  /**
   * Tab mode. The default is `private` on iOS and `public` on Android.
   * On Android, `private` is experimental. An unrecognized mode throws when the session starts.
   */
  browsingMode?: BrowsingMode | (string & {});
  /** iOS: run Safari history/data cleanup when the bridge starts. Defaults to enabled. */
  safariStartupCleanupEnabled?: GateFlag;
  /** Close the tabs the session opened after each test. iOS closes the native tabs, and Android closes context tabs at launch and before the context closes. */
  closeOpenedTabsAfterTest?: GateFlag;
  /** Android: clear the browser package data before each launch. Off by default. */
  resetBrowserDataAfterTest?: GateFlag;
  /** iOS: explicit-navigation recovery gate. Reissues a stuck explicit navigation. Defaults to disabled. */
  explicitNavigationRecoveryEnabled?: GateFlag;
  /** iOS: click-navigation retap recovery gate. Repeats a trusted tap after a stalled click navigation. Defaults to disabled. */
  clickNavigationRetapRecoveryEnabled?: GateFlag;
  /** Remote session log levels. Android uses `bridge` and `playwrightServer`, and `inspector` is iOS-only. */
  logLevels?: Partial<Record<SessionLogName, LogLevel>>;
  /**
   * Idle timeout in milliseconds for this remote device session.
   * Omit for the service default. `0` disables the timeout. Pass a non-negative integer.
   */
  sessionIdleTimeoutMs?: number;
}

/** Worker-scoped options added by this library. */
export interface MobileWorkerOptions {
  /** Desired capabilities that select the platform and remote device. */
  capabilities: Capabilities;
}

/** Device the platform driver selected for this worker. */
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
   * Android only: the `AndroidDevice` that launched the context.
   * Use UIAutomator (`tap` / `fill` / `wait` / `info` / `press`) and `shell()` for native UI.
   * A read throws on iOS and on a local pre-flight. `close` and `launchBrowser` are blocked.
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
  reopenPageInModeBeforeTest: 'private' | 'public' | undefined;
  /** Extra options the fixture merges into the context (iOS `newContext` / Android `launchBrowser`). */
  extraContextOptions: BrowserContextOptions;
}

/** @deprecated Use {@link MobileWorkerOptions}. */
export type IOSWorkerOptions = MobileWorkerOptions;
/** @deprecated Use {@link MobileTestOptions}. */
export type IOSTestOptions = MobileTestOptions;

/**
 * Worker-scoped Playwright fixtures.
 * `browser` is the platform connection, not a local browser.
 */
type MobilePlaywrightWorkerArgs = Omit<PlaywrightWorkerArgs, 'browser'> & {
  /**
   * Worker browser connection. Remote iOS and a local pre-flight return a `Browser`.
   * On an Android device run, a read throws. Use `context` or `page` there.
   */
  browser: Browser;
};

/**
 * Cross-platform Playwright `test`. `capabilities.platformName` selects iOS Safari or Android Chrome.
 * `page.bridge` exists on both platforms. `page.appium`, `page.setBrowsingMode`, and `reopenPageInModeBeforeTest` are iOS-only.
 */
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & MobileTestOptions,
  MobilePlaywrightWorkerArgs & PlaywrightWorkerOptions & MobileWorkerOptions & MobileWorkerFixtures
>;

/**
 * Playwright `defineConfig` with this library's worker and test options.
 * The overloads match Playwright, plus the `defineConfig(base, override)` merge form.
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
  /** Return the per-test session id. Use it to correlate video and logs. */
  getSessionId(args?: Record<string, never>): Promise<string>;
  /** Return the selected device metadata (deviceName / platformName / osVersion). */
  getDeviceInfo(args?: Record<string, never>): Promise<string>;
}

/** Bridge operations the Android Chrome bridge serves. */
interface AndroidBridgeKnownOps extends BridgeCommonOps {}

/** Bridge operations the iOS Safari bridge serves. */
interface IOSBridgeKnownOps extends BridgeCommonOps {
  /** Set the bridge input mode: `'js'` injection (default) or `'appium'` native input. */
  setInputMode(args: { mode: 'js' | 'appium' }): Promise<string>;
  /** Switch the Safari tab group to private/public. Prefer `page.setBrowsingMode`. */
  setBrowsingMode(args: { mode: 'private' | 'public' }): Promise<string>;
  /** Clear Safari history. This call invalidates the current page. */
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
  setExplicitNavigationRecoveryEnabled(args: { enabled: boolean }): Promise<'true' | 'false'>;
}

// Any op the connected bridge registers is callable. The index signature types that open surface.
// Ops outside AndroidBridgeKnownOps reject on Android. Ops outside IOSBridgeKnownOps reject on iOS.
type BridgeApi = IOSBridgeKnownOps & AndroidBridgeKnownOps & {
  [op: string]: (args?: Record<string, unknown>) => Promise<unknown>;
};

declare module '@playwright/test' {
  interface PlaywrightWorkerOptions {
    /** Desired capabilities that select the platform and remote device. */
    capabilities: Capabilities;
  }

  interface PlaywrightTestOptions {
    /** iOS only: reopen `page` in a fresh tab of this mode before the test body. */
    reopenPageInModeBeforeTest: 'private' | 'public' | undefined;
    /** Extra options the fixture merges into the context (iOS `newContext` / Android `launchBrowser`). */
    extraContextOptions: BrowserContextOptions;
  }

  interface Page {
    /**
     * Proxy that forwards a Page call in Appium (native) input mode on an iOS device.
     * On an iOS pre-flight and on Android, the proxy forwards to the Playwright action.
     */
    readonly appium: Page;
    /**
     * Bridge RPC: `page.bridge.<op>(args?)`.
     * iOS serves the full op set. Android serves {@link AndroidBridgeKnownOps}. A local pre-flight throws `BridgeUnavailableError`.
     */
    readonly bridge: BridgeApi;
    /**
     * iOS only: switch the Safari browsing mode.
     * On a device, use the returned `Page`. A local pre-flight returns the same page.
     */
    setBrowsingMode(mode: 'private' | 'public', options?: { timeoutMs?: number }): Promise<Page>;

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
    /**
     * Proxy that forwards a Locator call in Appium (native) input mode on an iOS device.
     * On an iOS pre-flight and on Android, the proxy forwards to the Playwright action.
     */
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
