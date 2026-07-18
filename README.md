# playwright-mobile-lib

Cross-platform Playwright fixtures for mobile web testing:

- iOS Safari through the Safari bridge, or local WebKit for pre-flight runs
- Android Chrome through the mobile orchestrator, direct ADB, or local Chromium

The package exports one standard Playwright `test`. Its driver is selected from
`capabilities.platformName` (`'iOS'` or `'Android'`), so the same tests and
fixture extensions can run on both platforms.

## Install

Install the library together with its Playwright peer dependencies. When using
the GitHub repository directly, pin a commit SHA for reproducible installs:

```jsonc
// package.json
{
  "devDependencies": {
    "@playwright/test": ">=1.58.0",
    "playwright": ">=1.58.0",
    "playwright-mobile-lib": "github:spitsynv2/playwright-mobile-lib#<commit-sha>"
  }
}
```

```bash
npm install
```

`@zebrunner/javascript-agent-playwright` is an optional peer dependency. Install
and configure it only when Zebrunner reporting is needed.

## Quickstart: iOS and Android

Declare one project per platform or device. `platformName` is required and
selects the driver:

```js
// playwright.config.js
const { defineConfig } = require('playwright-mobile-lib');

module.exports = defineConfig({
  projects: [
    {
      name: 'ios-safari',
      use: {
        capabilities: {
          platformName: 'iOS',
          deviceName: 'iPhone 16 Plus',
          browsingMode: 'single-tab-private',
        },
      },
    },
    {
      name: 'android-chrome',
      use: {
        capabilities: {
          platformName: 'Android',
          deviceName: 'Pixel 7',
        },
      },
    },
  ],
});
```

```js
// example.spec.js
const { test, expect } = require('playwright-mobile-lib');

test('opens a page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
```

With no endpoint or ADB opt-in, these projects run locally: iOS launches WebKit
with the requested iOS device preset, and Android launches Chromium with the
requested Android device preset. This is the default pre-flight path.

To use the orchestrator instead, set one base URL and run either project:

```bash
PWM_ORCHESTRATOR=ws://orchestrator.example.com:7777 \
  npx playwright test --project=ios-safari

PWM_ORCHESTRATOR=ws://orchestrator.example.com:7777 \
  npx playwright test --project=android-chrome
```

The library appends `/safari` for iOS and `/playwright` for Android. A full
`IOS_WS_ENDPOINT` or `ANDROID_WS_ENDPOINT` overrides the derived URL for that
platform.

## Connection modes

| Platform | Configuration | Result |
| --- | --- | --- |
| iOS | `IOS_WS_ENDPOINT`, or `PWM_ORCHESTRATOR` | `webkit.connect()` to the Safari bridge. `deviceName` is required for iOS farm runs. |
| iOS | No endpoint | Local `webkit.launch()` with the resolved `deviceName` preset. |
| Android | `ANDROID_WS_ENDPOINT`, or `PWM_ORCHESTRATOR` | Playwright Android connection to the remote `/playwright` endpoint. |
| Android | No endpoint, plus `capabilities.serial`, `ANDROID_SERIAL`, or `PWM_ANDROID_ADB=true` | Direct ADB connection, then Chrome `launchBrowser()`. A serial selects a specific device; without one, exactly one ADB device must be available. |
| Android | No endpoint and no ADB opt-in | Local `chromium.launch()` with the requested device preset. An unknown or omitted device name falls back to the `Pixel 7` preset. |

Remote endpoints always take precedence over ADB. For direct ADB, the
capability `serial` takes precedence over `ANDROID_SERIAL`.

`extraContextOptions` can supply additional context options with
`test.use({ extraContextOptions: { ... } })`. The iOS driver merges them into
`browser.newContext()`; Android merges them into `launchBrowser()` on a real
device or `newContext()` during local emulation.

## Platform-specific APIs

The ordinary Playwright `page`, locator, assertion, and fixture APIs are shared.
These additions are iOS Safari bridge features only:

- `page.bridge.<operation>(args?)`
- `page.appium.<method>(...)` and `locator.appium.<method>(...)`
- `page.setBrowsingMode('private' | 'public')`
- `withAppiumInputMode(page, fn)`
- the `reopenInMode` option fixture

On Android, `reopenInMode` is ignored. The `bridge`, `appium`, and
`setBrowsingMode` page/locator additions are not installed and must not be used.
The exported `resolveIOSDevicePreset()` helper is also iOS-specific.

For ordinary iOS interaction, prefer awaited locator `tap()` calls. Use
`locator.appium.tap()` only when trusted physical input is required:

```js
const submit = page.getByRole('button', { name: 'Submit' });
await submit.tap();
```

Covered JS taps and clicks wait for the target to become actionable. A forced
tap or click temporarily bypasses the bridge hit test, so use `force` only when
the test intentionally needs that behavior. Appium taps use native coordinates
and do not retarget through an overlay.

## Capabilities

Set capabilities per project or with `test.use()`. They are sent to a remote
orchestrator in the `x-pwm-capabilities` connect header for device pool matching.
There are no environment-variable fallbacks for device capabilities.

| Capability | Type | Meaning |
| --- | --- | --- |
| `platformName` | `'iOS' \| 'Android'` | Required. Selects the platform driver and orchestrator route. |
| `deviceName` | `string` | Device pool-match filter, such as `iPhone 16 Plus` or `Pixel 7`. Required for iOS farm runs; also selects the local emulation preset. |
| `deviceUuid` | `string` | iOS device UDID pool-match filter. |
| `serial` | `string` | Android serial for direct ADB selection; overrides `ANDROID_SERIAL`. |
| `osVersion` | `string` | OS-version pool-match filter. |
| `browsingMode` | `'public' \| 'private' \| 'single-tab-public' \| 'single-tab-private'` | iOS Safari browsing mode requested at connect time. |
| `skipSafariCleanup` | `boolean` | iOS only: skip between-test Safari cleanup. |
| `closeTabAfterTest` | `boolean` | iOS only: close the Safari tab after each test. |
| `navKickEnabled` | `boolean` | iOS only: bridge navigation-kick retry gate. |
| `clickNavRetriesEnabled` | `boolean` | iOS only: bridge click-navigation retry gate. |
| `logLevels` | `Partial<Record<'bridge' \| 'pwserver' \| 'inspector', LogLevel>>` | iOS only: per-stream container log verbosity for reporting. `LogLevel` is `off`, `fatal`, `error`, `warn`, `info`, `debug`, or `trace`. |

The test-scoped option fixtures are:

| Option | Meaning |
| --- | --- |
| `reopenInMode` | iOS only: reopen `page` in a fresh `private` or `public` tab before the test body. Ignored on Android. |
| `extraContextOptions` | Extra `BrowserContextOptions` merged into the platform context creation call. |

## Environment variables

Copy [`.env.example`](./.env.example) into the consuming test project and load
it there, for example with `dotenv`. The library reads `process.env`; it does
not load `.env` files itself.

| Variable | Purpose |
| --- | --- |
| `PWM_ORCHESTRATOR` | Orchestrator base URL. The platform route is derived as `/safari` for iOS or `/playwright` for Android. Leave unset for local runs. |
| `IOS_WS_ENDPOINT` | Full iOS WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for iOS. |
| `ANDROID_WS_ENDPOINT` | Full Android WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for Android. |
| `PWM_CONNECT_TIMEOUT_MS` | Remote connect timeout in milliseconds. The code fallback is `120000`; the connection worker fixture timeout is this value plus 30 seconds. The legacy `IOS_CONNECT_TIMEOUT_MS` is still accepted as a fallback. |
| `PWM_CLIENT_ID` | Optional stable `x-pwm-client-id` used for device pinning across reconnects. When absent, a unique ID is generated once per worker process. The legacy `IOS_CLIENT_ID` is still accepted as a fallback. |
| `PWM_AUTH_HEADER` | Complete `Authorization` header value. Highest auth precedence. |
| `PWM_AUTH_TOKEN` | Bearer token used when `PWM_AUTH_HEADER` is empty. |
| `PWM_AUTH_USER` | Basic-auth username used when neither raw-header nor bearer auth is set. |
| `PWM_AUTH_PASSWORD` | Basic-auth password paired with `PWM_AUTH_USER`. |
| `ANDROID_SERIAL` | Android device serial for direct ADB selection. A `capabilities.serial` value wins. |
| `PWM_ANDROID_ADB` | Set exactly to `true` to opt into ADB without specifying a serial. With no serial, exactly one device must be available. |
| `ADB_SERVER_HOST` | ADB server host. Defaults to `127.0.0.1`. |
| `ADB_SERVER_PORT` | ADB server port. Defaults to `5037`. |
| `ANDROID_OMIT_DRIVER_INSTALL` | Set exactly to `true` to pass `omitDriverInstall` to Playwright's Android device discovery. |
| `PLAYWRIGHT_SLOW_MO_MS` | Non-negative delay between Playwright operations in milliseconds. Defaults to `0`. |
| `REPORTING_ENABLED` | Set exactly to `true` to enable the optional Zebrunner integration. Defaults to disabled. |

### Orchestrator authentication

Authentication is intended for an orchestrator behind an auth proxy. The
library sends `Authorization` as a Playwright connect header on both platforms;
it does not put credentials in the endpoint URL. Precedence is:

1. `PWM_AUTH_HEADER` — the complete raw header value
2. `PWM_AUTH_TOKEN` — formatted as `Bearer <token>`
3. `PWM_AUTH_USER` / `PWM_AUTH_PASSWORD` — formatted as HTTP Basic auth

The same connection also sends `x-pwm-capabilities` and, when available,
`x-pwm-client-id`.

## Extending `test` (fixtures, page objects, TypeScript)

The exported `test` is a standard Playwright `TestType`. Consumers can call
`test.extend(...)`, combine fixture-bearing tests with the re-exported
Playwright `mergeTests(mobileTest, anotherTest)`, and use ordinary Page Object Models.
Option fixtures can be overridden with
`test.use({ capabilities, extraContextOptions, reopenInMode })` or under `use`
in this package's `defineConfig()`.

This TypeScript example adds a page-object fixture while preserving all mobile
fixtures and types:

```ts
import {
  test as mobileTest,
  expect,
  type Page,
} from 'playwright-mobile-lib';

class HomePage {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto('https://example.com');
  }
}

type AppFixtures = { homePage: HomePage };

const test = mobileTest.extend<AppFixtures>({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
});

test.use({
  capabilities: { platformName: 'Android', deviceName: 'Pixel 7' },
});

test('home page', async ({ homePage }) => {
  await homePage.open();
  await expect(homePage.page).toHaveTitle(/Example/);
});
```

Type declarations are discovered without a `jsconfig.json`: `package.json`
provides both the top-level `types` entry and an export-map `types` condition,
and `playwright` / `@playwright/test` are peer dependencies. The exported test
type, documented option fixtures, config options, and iOS page extensions
therefore receive IDE documentation automatically.

One JavaScript caveat is independent of this library: a parameter on a plain
helper such as `function helper(page) {}` is implicitly `any`, so it cannot
inherit IntelliSense from the fixture callback that calls it. Prefer TypeScript,
add a JSDoc parameter, or enable JavaScript type checking in `jsconfig.json`:

```js
/** @param {import('playwright-mobile-lib').Page} page */
async function helper(page) {
  await page.goto('https://example.com');
}
```

```json
{
  "compilerOptions": { "checkJs": true }
}
```

## Reporting and action telemetry

When `REPORTING_ENABLED=true` and the optional Zebrunner package is installed,
the iOS page fixture reads the bridge device info and session ID, then attaches
the physical device capabilities and session label to the current Zebrunner
test. The reporter can use that session ID to resolve farm video and log
artifacts after the test.

The iOS integration records structured actions for page creation, navigation,
`page.bridge.*`, `page.setBrowsingMode()`, and `page.appium.*` /
`locator.appium.*` when the installed agent exposes action reporting. Captured
parameters are bounded to 8 KiB; common secret fields, sensitive URL values, and
native fill/type values are redacted. If reporting is disabled, the package is
absent, or structured actions are unavailable, test behavior is unchanged.

Android does not install the iOS bridge/session telemetry hooks. On a failed
Android test, its driver instead attempts to attach a `failure-screenshot`.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/test.js` | Unified `base.extend()` fixtures and platform-driver lifecycle. |
| `src/platforms/index.js` | Selects the iOS or Android driver from `capabilities.platformName`. |
| `src/core/capabilities.js` | Shared endpoint, auth-header, client-ID, timeout, slow-motion, capability-header, and session-log resolution. |
| `src/core/reporting.js` | Optional Zebrunner session, capability, artifact-URL, and action attachment helpers. |
| `src/core/telemetry.js` | Structured action capture, source attribution, redaction, and payload bounding. |
| `src/core/unsupported.js` | Shared unsupported-API throwers and caveat-warning helpers. |
| `src/platforms/ios/driver.js` | iOS remote/local connection, context/page creation, bridge setup, and reporting handshake. |
| `src/platforms/ios/appium.js` | Bridge-call primitive and Appium input-mode proxy. |
| `src/platforms/ios/bridge-proxy.js` | iOS `page.bridge`, Appium, browsing-mode, action, and unsupported-API prototype wiring. |
| `src/platforms/ios/screenshot-gate.js` | Foreground check and bounded blank-image fallback for remote iOS background tabs. |
| `src/platforms/ios/custom-devices.js` | iOS device aliases and custom Playwright preset resolution. |
| `src/platforms/ios/unsupported-ios.js` | iOS-specific unsupported APIs and `addInitScript` caveat. |
| `src/platforms/android/driver.js` | Android orchestrator/ADB/local connection, Chrome context/page lifecycle, and failure screenshot. |
| `src/platforms/android/unsupported-android.js` | Android physical-device unsupported API definitions. |
