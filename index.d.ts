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

export function resolveIOSDevicePreset(
  deviceName: string,
  playwrightDevices: PlaywrightDevices,
): DeviceDescriptor | null;

export function withAppiumInputMode<T>(page: Page, fn: () => Promise<T> | T): Promise<T>;

export type LogLevel = 'off' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type SessionLogName = 'bridge' | 'pwserver' | 'inspector';
export type BrowsingMode = 'public' | 'private' | 'single-tab-public' | 'single-tab-private';

export interface Capabilities {
  platformName: 'iOS';
  deviceName?: string;
  deviceUuid?: string;
  osVersion?: string;
  browsingMode?: BrowsingMode;
  skipSafariCleanup?: boolean;
  closeTabAfterTest?: boolean;
  navKickEnabled?: boolean;
  clickNavRetriesEnabled?: boolean;
  logLevels?: Partial<Record<SessionLogName, LogLevel>>;
}

export interface IOSWorkerOptions {
  capabilities: Capabilities;
}

export interface IOSTestOptions {
  reopenInMode: 'private' | 'public' | undefined;
  extraContextOptions: BrowserContextOptions;
}

export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & IOSTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions & IOSWorkerOptions
>;

export function defineConfig(
  config: PlaywrightTestConfig<IOSTestOptions, IOSWorkerOptions>,
): PlaywrightTestConfig<IOSTestOptions, IOSWorkerOptions>;

interface IOSBridgeKnownOps {
  setInputMode(args: { mode: 'js' | 'appium' }): Promise<string>;
  setBrowsingMode(args: { mode: 'private' | 'public' }): Promise<string>;
  clearSafariHistory(args?: Record<string, never>): Promise<string>;
  getSessionId(args?: Record<string, never>): Promise<string>;
  isForeground(args?: Record<string, never>): Promise<string>;
  getDeviceInfo(args?: Record<string, never>): Promise<string>;
  acceptAlert(args?: {
    action?: 'accept' | 'dismiss';
    buttonLabel?: string;
    timeoutMs?: number;
  }): Promise<'true' | 'false'>;
  nativeInput(args: {
    timeoutMs?: number;
    actions: Array<{
      type: 'fill' | 'tap';
      xpath?: string;
      elementLabel?: string;
      value?: string;
    }>;
  }): Promise<'true'>;
  setNavRetries(args: { enabled: boolean }): Promise<'true' | 'false'>;
}

// Any op registered in the bridge's bridge_call.go is auto-callable; the index
// signature keeps that open-ended surface typed alongside the known ops.
type IOSBridgeApi = IOSBridgeKnownOps & {
  [op: string]: (args?: Record<string, unknown>) => Promise<unknown>;
};

declare module '@playwright/test' {
  interface Page {
    // Flips the bridge to Appium input mode per forwarded call; mirrors Page.
    readonly appium: Page;
    readonly bridge: IOSBridgeApi;
    setBrowsingMode(mode: 'private' | 'public', options?: { timeout?: number }): Promise<Page>;
  }

  interface Locator {
    readonly appium: Locator;
  }
}
