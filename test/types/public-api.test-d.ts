// Type-level test: everything a consumer is expected to get from autocomplete
// must compile here. Checked by `npm run typecheck`, never executed.
import {
  test,
  expect,
  defineConfig,
  devices,
  resolveIOSDevicePreset,
  withAppiumInputMode,
  type Capabilities,
  type DeviceInfo,
  type Page,
} from '../../index';

test('worker fixtures are visible to tests', async ({ page, deviceInfo, devicePreset }) => {
  const info: DeviceInfo = deviceInfo;
  const browserVersion: string | undefined = info.browserVersion;
  expect(`${info.deviceName} ${info.platformName} ${info.osVersion} ${browserVersion}`).toBeTruthy();
  expect(devicePreset.viewport.width).toBeGreaterThan(0);
  await page.goto('https://example.com');
});

const androidCapabilities: Capabilities = {
  platformName: 'Android',
  deviceName: 'Pixel 7',
  osVersion: '14',
  serial: 'emulator-5554',
  browsingMode: 'single-tab-public',
  closeTabAfterTest: true,
  args: ['--mute-audio'],
  pkg: 'com.android.chrome',
  acceptDownloads: true,
  baseURL: 'https://example.com',
  bypassCSP: true,
  colorScheme: 'dark',
  contrast: 'no-preference',
  deviceScaleFactor: 3,
  extraHTTPHeaders: { 'x-test': '1' },
  forcedColors: 'none',
  geolocation: { latitude: 1, longitude: 2 },
  hasTouch: true,
  httpCredentials: { username: 'u', password: 'p' },
  ignoreHTTPSErrors: true,
  isMobile: true,
  javaScriptEnabled: true,
  locale: 'en-US',
  offline: false,
  permissions: ['geolocation'],
  proxy: { server: 'http://localhost:8080' },
  recordHar: { path: 'har.zip' },
  recordVideo: { dir: 'videos' },
  reducedMotion: 'reduce',
  screen: { width: 390, height: 844 },
  serviceWorkers: 'block',
  strictSelectors: true,
  timezoneId: 'UTC',
  userAgent: 'ua',
  viewport: { width: 390, height: 844 },
};

const iosCapabilities: Capabilities = {
  platformName: 'iOS',
  deviceName: 'iPhone 16 Plus',
  deviceUuid: 'udid',
  osVersion: '26.4',
  browsingMode: 'single-tab-private',
  skipSafariCleanup: true,
  closeTabAfterTest: false,
  navKickEnabled: true,
  clickNavRetriesEnabled: false,
  logLevels: { bridge: 'debug', pwserver: 'off', inspector: 'info' },
};

// A device outside the suggested union is still accepted.
const otherDevice: Capabilities = { platformName: 'iOS', deviceName: 'iPhone 13 Mini' };

// Gate flags accept the string forms an env variable produces.
const envDrivenGates: Capabilities = {
  platformName: 'iOS',
  closeTabAfterTest: process.env.CLOSE_TAB_AFTER_TEST === 'true' ? 'true' : 'false',
  skipSafariCleanup: 'true',
  navKickEnabled: false,
  clickNavRetriesEnabled: true,
};

// An env variable reaches browsingMode without a cast; a typo throws at runtime.
const envDrivenMode: Capabilities = {
  platformName: 'iOS',
  browsingMode: process.env.BROWSING_MODE || 'private',
};

// The legacy alias still type-checks, deprecated but not an error.
const legacyMode: Capabilities = { platformName: 'Android', browsingMode: 'single-tab' };

export default defineConfig({
  projects: [
    { name: 'android', use: { capabilities: androidCapabilities } },
    {
      name: 'ios',
      use: { capabilities: iosCapabilities, reopenInMode: 'private', extraContextOptions: {} },
    },
    { name: 'other', use: { capabilities: otherDevice } },
    { name: 'legacy', use: { capabilities: legacyMode } },
    { name: 'env-gates', use: { capabilities: envDrivenGates } },
    { name: 'env-mode', use: { capabilities: envDrivenMode } },
  ],
});

test('bridge, appium, and browsing-mode extras are typed', async ({ page }) => {
  const sessionId: string = await page.bridge.getSessionId();
  const deviceInfoJson: string = await page.bridge.getDeviceInfo();
  const inputMode: string = await page.bridge.setInputMode({ mode: 'appium' });
  const alert: 'true' | 'false' = await page.bridge.acceptAlert({ action: 'accept' });
  const nativeInput: 'true' = await page.bridge.nativeInput({
    actions: [{ type: 'fill', xpath: '//input', value: 'text' }],
  });
  const unregisteredOp: unknown = await page.bridge.someFutureOp({ a: 1 });
  expect([sessionId, deviceInfoJson, inputMode, alert, nativeInput, unregisteredOp]).toBeTruthy();

  const reopened: Page = await page.setBrowsingMode('public', { timeout: 1_000 });
  await withAppiumInputMode(reopened, async () => {
    await reopened.getByRole('button').appium.tap();
  });
});

test('blocked APIs keep their original signatures', async ({ page, context }) => {
  // These throw at runtime and are marked deprecated; the signatures must stay
  // intact so the editor shows them struck through rather than unknown.
  await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
  await page.emulateMedia({ colorScheme: 'dark' }).catch(() => {});
  await page.hover('#target', { timeout: 1 }).catch(() => {});
  await page.setInputFiles('#file', []).catch(() => {});
  await page.getByRole('button').hover({ timeout: 1 }).catch(() => {});
  await page.getByRole('button').setInputFiles([]).catch(() => {});
  await page.mouse.wheel(0, 100).catch(() => {});
  await context.cookies('https://example.com').catch(() => {});
  await context.addCookies([]).catch(() => {});
  await context.clearCookies().catch(() => {});
  await context.storageState().catch(() => {});
  await context.grantPermissions(['geolocation']).catch(() => {});
  await context.clearPermissions().catch(() => {});
  await context.setGeolocation({ latitude: 1, longitude: 2 }).catch(() => {});
  await context.setOffline(true).catch(() => {});
});

test('supported Playwright APIs are unaffected by the augmentation', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: 'Submit' }).tap();
  await page.locator('#target').fill('text');
  await page.waitForLoadState('load');
  await page.evaluate(() => document.title);
  await expect(page.locator('#target')).toBeVisible({ timeout: 1 });
  await expect(page).toHaveTitle(/Example/);
});

const preset = resolveIOSDevicePreset('iphone xr', devices);
expect(preset === null || typeof preset.userAgent === 'string').toBeTruthy();
