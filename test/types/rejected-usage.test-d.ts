// Type-level test for what must NOT compile. Every `@ts-expect-error` below is
// itself checked: if a case stops being an error, tsc reports the unused
// directive and `npm run typecheck` fails.
import { test, defineConfig, type Capabilities } from '../../index';

const unknownBrowsingMode: Capabilities = {
  platformName: 'iOS',
  // @ts-expect-error not a browsing mode
  browsingMode: 'incognito',
};

const unknownPlatform: Capabilities = {
  // @ts-expect-error only iOS and Android are supported
  platformName: 'Windows',
};

// @ts-expect-error platformName is required
const missingPlatform: Capabilities = {};

const wrongArgsType: Capabilities = {
  platformName: 'Android',
  // @ts-expect-error browser flags are a list
  args: '--mute-audio',
};

const unknownCapability: Capabilities = {
  platformName: 'iOS',
  // @ts-expect-error typo guard: unknown capabilities are rejected
  devicename: 'iPhone 16 Plus',
};

const unknownLogLevel: Capabilities = {
  platformName: 'iOS',
  // @ts-expect-error 'verbose' is not a log level
  logLevels: { bridge: 'verbose' },
};

const readOnlyFixtureInConfig = defineConfig({
  // @ts-expect-error deviceInfo is resolved by the driver, not settable
  use: { deviceInfo: { deviceName: 'x', platformName: 'iOS', osVersion: '1' } },
});

test('signatures of blocked APIs are still enforced', async ({ page }) => {
  // @ts-expect-error setViewportSize takes a size object
  await page.setViewportSize(390);
  // @ts-expect-error wheel takes two numbers
  await page.mouse.wheel('down', 100);
  // @ts-expect-error only 'js' and 'appium' are input modes
  await page.bridge.setInputMode({ mode: 'native' });
  // @ts-expect-error setBrowsingMode does not accept single-tab values
  await page.setBrowsingMode('single-tab-private');
});

export {
  unknownBrowsingMode,
  unknownPlatform,
  missingPlatform,
  wrongArgsType,
  unknownCapability,
  unknownLogLevel,
  readOnlyFixtureInConfig,
};
