import {
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

/** Per-session container log verbosity. `'off'` drops that log from reporting. */
export type LogLevel = 'off' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Per-session container log streams (iOS): the bridge, Playwright server, and inspector proxy. */
export type SessionLogName = 'bridge' | 'pwserver' | 'inspector';

/** iOS Safari tab/browsing mode requested at connect time. */
export type BrowsingMode = 'public' | 'private' | 'single-tab-public' | 'single-tab-private';

/**
 * Desired capabilities for a project/run. Sent to the orchestrator as the
 * `x-pwm-capabilities` connect header, which pool-matches a free device. Set
 * per-project via `use: { capabilities }`.
 */
export interface Capabilities {
  /** Selects the platform driver and orchestrator route. Required. */
  platformName: 'iOS' | 'Android';
  /** Device pool-match filter (e.g. `"iPhone 16 Plus"`, `"Pixel 3 XL"`). Required for iOS farm runs. */
  deviceName?: string;
  /** iOS device UDID pool-match filter. */
  deviceUuid?: string;
  /** Android device serial for direct-ADB selection (or set `ANDROID_SERIAL`). */
  serial?: string;
  /** OS version pool-match filter. */
  osVersion?: string;
  /** iOS Safari tab/browsing mode. iOS only. */
  browsingMode?: BrowsingMode;
  /** iOS: skip the between-tests Safari cleanup. */
  skipSafariCleanup?: boolean;
  /** iOS: close the Safari tab after each test. */
  closeTabAfterTest?: boolean;
  /** iOS: bridge nav-kick retry gate. */
  navKickEnabled?: boolean;
  /** iOS: bridge click-nav retry gate. */
  clickNavRetriesEnabled?: boolean;
  /** iOS: per-stream container log verbosity for reporting. */
  logLevels?: Partial<Record<SessionLogName, LogLevel>>;
}

/** Worker-scoped options added by this library. */
export interface MobileWorkerOptions {
  /** Desired capabilities; selects the platform driver and pool-matches a device. */
  capabilities: Capabilities;
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
 * Cross-platform Playwright `test`. The platform is chosen from
 * `capabilities.platformName` (`'iOS'` -> Safari bridge, `'Android'` -> Chrome).
 * iOS-only extras (`page.bridge`, `page.appium`, `page.setBrowsingMode`,
 * `reopenInMode`) are no-ops / unavailable on Android.
 */
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & MobileTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions & MobileWorkerOptions
>;

/** `defineConfig` typed with this library's worker/test options (e.g. `capabilities`). */
export function defineConfig(
  config: PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>,
): PlaywrightTestConfig<MobileTestOptions, MobileWorkerOptions>;

/** Known iOS Safari bridge operations reachable through `page.bridge.<op>(args?)`. */
interface IOSBridgeKnownOps {
  /** Set the bridge input mode: `'js'` injection (default) or `'appium'` native input. */
  setInputMode(args: { mode: 'js' | 'appium' }): Promise<string>;
  /** Switch the Safari tab group to private/public. Prefer `page.setBrowsingMode`. */
  setBrowsingMode(args: { mode: 'private' | 'public' }): Promise<string>;
  /** Clear Safari history. Invalidates the current page (its WebContent process is torn down). */
  clearSafariHistory(args?: Record<string, never>): Promise<string>;
  /** Return the bridge's per-test session id (used to correlate video/logs). */
  getSessionId(args?: Record<string, never>): Promise<string>;
  /** Report whether this page's Safari tab is currently foreground. */
  isForeground(args?: Record<string, never>): Promise<string>;
  /** Return the selected device metadata (deviceName / platformName / osVersion). */
  getDeviceInfo(args?: Record<string, never>): Promise<string>;
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

// Any op registered in the bridge's bridge_call.go is auto-callable; the index
// signature keeps that open-ended surface typed alongside the known ops.
type IOSBridgeApi = IOSBridgeKnownOps & {
  [op: string]: (args?: Record<string, unknown>) => Promise<unknown>;
};

declare module '@playwright/test' {
  interface Page {
    /** iOS only: proxy that runs the forwarded Page call in Appium (native) input mode. */
    readonly appium: Page;
    /** iOS only: dynamic bridge RPC — `page.bridge.<op>(args?)`. */
    readonly bridge: IOSBridgeApi;
    /**
     * iOS only: switch the Safari browsing mode. This spawns a fresh tab the
     * bridge adopts as a new page, so use the returned `Page` afterwards.
     */
    setBrowsingMode(mode: 'private' | 'public', options?: { timeout?: number }): Promise<Page>;
  }

  interface Locator {
    /** iOS only: proxy that runs the forwarded Locator call in Appium (native) input mode. */
    readonly appium: Locator;
  }
}
