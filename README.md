# playwright-mobile-lib

Cross-platform Playwright fixtures for mobile web testing on real devices:

- iOS Safari, or local WebKit for pre-flight runs
- Android Chrome, or local Chromium for pre-flight runs

The package exports one standard Playwright `test`. Its driver is selected from
`capabilities.platformName` (`'iOS'` or `'Android'`), so the same tests, page
objects, and fixture extensions run on both platforms.

## Install

This package is distributed internally, not on the public npm registry. Install
it from the Git repository (or your private registry) together with its
Playwright peer dependencies, pinning a commit SHA or tag so installs stay
reproducible:

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

Node.js 22 or newer is required; Node 24 (the current LTS) is recommended. The
`playwright` and `@playwright/test` versions used by tests must match the
Playwright version the device containers run, so agree on that version with
whoever operates the orchestrator before upgrading.

## Quickstart

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

## Where tests run

With no endpoint configured, both projects run locally: iOS launches WebKit and
Android launches Chromium, each emulating the requested device preset. This is
the default pre-flight path and needs no devices.

To run against real devices, point the run at an orchestrator:

```bash
PWM_ORCHESTRATOR=ws://orchestrator.example.com:7777 \
  npx playwright test --project=ios-safari

PWM_ORCHESTRATOR=ws://orchestrator.example.com:7777 \
  npx playwright test --project=android-chrome
```

The library derives the per-platform route from that base URL. A full
`IOS_WS_ENDPOINT` or `ANDROID_WS_ENDPOINT` overrides the derived URL for that
platform. Capabilities are sent as a connect header and the orchestrator
pool-matches a free device against them.

## Capabilities

Set capabilities per project, or with `test.use()` for a single file. There are
no environment-variable fallbacks for device capabilities.

| Capability | Type | Meaning |
| --- | --- | --- |
| `platformName` | `'iOS' \| 'Android'` | Required. Selects the platform driver and route. |
| `deviceName` | `string` | Device pool-match filter, such as `iPhone 16 Plus` or `Pixel 7`. Required for iOS device runs; also selects the local emulation preset. |
| `deviceUuid` | `string` | iOS device UDID pool-match filter. |
| `osVersion` | `string` | OS-version pool-match filter. |
| `browsingMode` | `'public' \| 'private' \| 'single-tab-public' \| 'single-tab-private'` | Tab/browsing mode requested at connect time. Defaults to `private`. |
| `skipSafariCleanup` | `boolean` | iOS only: skip between-test Safari cleanup. |
| `closeTabAfterTest` | `boolean` | Close the tab after each test. Defaults to enabled. |
| `navKickEnabled` | `boolean` | iOS only: navigation retry gate. |
| `clickNavRetriesEnabled` | `boolean` | iOS only: click-navigation retry gate. |
| `logLevels` | `Partial<Record<'bridge' \| 'pwserver' \| 'inspector', LogLevel>>` | iOS only: per-stream session log verbosity for reporting. `LogLevel` is `off`, `fatal`, `error`, `warn`, `info`, `debug`, or `trace`. |

`private` browses without persisting history or site data, and `single-tab-*`
reuses one tab for the whole run instead of opening a tab per page. iOS honors
all four modes with full isolation. On Android, `private` is best-effort: where
the device's browser cannot provide an isolated tab, the run continues in the
normal profile with a warning instead of failing.

On Android, `capabilities` also accepts the context options the launched Chrome
honors (`viewport`, `locale`, `timezoneId`, `geolocation`, `permissions`,
`extraHTTPHeaders`, `httpCredentials`, `proxy`, `recordHar`, `recordVideo`, and
the rest of that set), plus `args` for extra browser flags and `pkg` to select
the browser package. Autocomplete lists the full set.

## Fixtures and options

| Fixture | Scope | Meaning |
| --- | --- | --- |
| `capabilities` | worker option | Desired capabilities for the run. |
| `reopenInMode` | test option | iOS only: reopen `page` in a fresh `private` or `public` tab before the test body. Ignored on Android. |
| `extraContextOptions` | test option | Extra `BrowserContextOptions` merged into context creation. |
| `deviceInfo` | worker, read-only | The device the worker resolved: `deviceName`, `platformName`, `osVersion`, and `browserVersion` on Android. |
| `devicePreset` | worker, read-only | The Playwright device preset resolved from `deviceInfo`. |

```js
test('reports the device it ran on', async ({ page, deviceInfo }) => {
  console.log(`${deviceInfo.platformName} ${deviceInfo.osVersion} on ${deviceInfo.deviceName}`);
  await page.goto('https://example.com');
});
```

## Platform-specific APIs

The ordinary Playwright `page`, locator, assertion, and fixture APIs are shared.
These additions are platform-specific:

| API | Availability |
| --- | --- |
| `page.bridge.<operation>(args?)` | Both platforms, with a per-platform operation set. iOS serves the full set; Android serves `getSessionId` and `getDeviceInfo`. |
| `page.appium.<method>(...)` / `locator.appium.<method>(...)` | iOS only |
| `page.setBrowsingMode('private' \| 'public')` | iOS only |
| `withAppiumInputMode(page, fn)` | iOS only |
| `reopenInMode` | iOS only; ignored on Android |
| `resolveIOSDevicePreset()` | iOS only |

For ordinary iOS interaction, prefer awaited locator `tap()` calls. Use
`locator.appium.tap()` only when trusted physical input is required:

```js
const submit = page.getByRole('button', { name: 'Submit' });
await submit.tap();
```

Covered JS taps and clicks wait for the target to become actionable. A forced
tap or click temporarily bypasses the hit test, so use `force` only when the test
intentionally needs that behavior. Appium taps use native coordinates and do not
retarget through an overlay.

`page.setBrowsingMode()` spawns a fresh tab that is adopted as a new page, so use
the returned `Page` afterwards.

## APIs that a real device cannot support

A few Playwright APIs cannot behave correctly on a shared physical device, so
they throw with an explanation instead of silently doing nothing. They are marked
`@deprecated` in the type definitions, which means editors show them struck
through with the reason on hover, before the test is ever run.

| Blocked | Platform | Alternative |
| --- | --- | --- |
| `page.setViewportSize()` | iOS, Android | Select a device with `capabilities.deviceName`. |
| `page.emulateMedia()` | iOS | Change the setting on the device. |
| `page.hover()`, `locator.hover()` | iOS | Tap; touch devices fire pointer events on tap only. |
| `page.setInputFiles()`, `locator.setInputFiles()` | iOS | Not available: the native file picker is not driveable. |
| `mouse.wheel()` | iOS | `locator.scrollIntoViewIfNeeded()` or `page.evaluate(() => scrollBy(...))`. |
| `context.cookies()`, `addCookies()`, `clearCookies()`, `storageState()` | iOS | Not available: the cookie jar is shared across the device. |
| `context.grantPermissions()`, `clearPermissions()` | iOS | Grant permissions on the device. |
| `context.setGeolocation()` | iOS | Not available: real GPS. |
| `context.setOffline()` | iOS | Not available: only airplane mode toggles offline. |

`page.addInitScript()` is supported, and warns once about one caveat: it runs
before load on same-origin navigations, but is replayed into the committed
document (after load) on the first cross-origin page.

## Environment variables

The library reads `process.env` and does not load `.env` files itself. Load them
in the consuming project, for example with `dotenv`.

| Variable | Purpose |
| --- | --- |
| `PWM_ORCHESTRATOR` | Orchestrator base URL. The per-platform route is derived from it. Leave unset for local runs. |
| `IOS_WS_ENDPOINT` | Full iOS WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for iOS. |
| `ANDROID_WS_ENDPOINT` | Full Android WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for Android. |
| `PWM_CONNECT_TIMEOUT_MS` | Remote connect timeout in milliseconds. Defaults to `120000`; the connection fixture timeout is this value plus 30 seconds. The legacy `IOS_CONNECT_TIMEOUT_MS` is still accepted. |
| `PWM_CLIENT_ID` | Stable `x-pwm-client-id` used for device pinning across reconnects. When absent, a unique ID is generated once per worker process. The legacy `IOS_CLIENT_ID` is still accepted. |
| `PWM_AUTH_HEADER` | Complete `Authorization` header value. Highest auth precedence. |
| `PWM_AUTH_TOKEN` | Bearer token used when `PWM_AUTH_HEADER` is empty. |
| `PWM_AUTH_USER` | Basic-auth username used when neither raw-header nor bearer auth is set. |
| `PWM_AUTH_PASSWORD` | Basic-auth password paired with `PWM_AUTH_USER`. |
| `PLAYWRIGHT_SLOW_MO_MS` | Non-negative delay between Playwright operations in milliseconds. Defaults to `0`. |
| `REPORTING_ENABLED` | Set exactly to `true` to enable the optional Zebrunner integration. Defaults to disabled. |

Authentication is intended for an orchestrator behind an auth proxy. The
`Authorization` value is sent as a Playwright connect header on both platforms;
credentials are never put in the endpoint URL. Precedence is `PWM_AUTH_HEADER`,
then `PWM_AUTH_TOKEN` as `Bearer <token>`, then `PWM_AUTH_USER` /
`PWM_AUTH_PASSWORD` as HTTP Basic.

## Extending `test` (fixtures, page objects, TypeScript)

The exported `test` is a standard Playwright `TestType`. Consumers can call
`test.extend(...)`, combine fixture-bearing tests with the re-exported Playwright
`mergeTests(mobileTest, anotherTest)`, and use ordinary Page Object Models.
Option fixtures can be overridden with
`test.use({ capabilities, extraContextOptions, reopenInMode })` or under `use` in
this package's `defineConfig()`.

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

Type declarations are discovered without extra configuration: the package
declares both a top-level `types` entry and an export-map `types` condition, and
`playwright` / `@playwright/test` are peer dependencies. The exported test type,
capabilities, option fixtures, and the platform-specific page extensions all get
IDE documentation automatically.

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

## Reporting

When `REPORTING_ENABLED=true` and the optional Zebrunner package is installed,
each test attaches its device capabilities and a session label to the current
Zebrunner test. The reporter uses that session to resolve device video and log
artifacts after the test; artifacts are never downloaded by the test process.

Structured actions are recorded for page creation, navigation, `page.bridge.*`,
`page.setBrowsingMode()`, and `page.appium.*` / `locator.appium.*` when the
installed agent exposes action reporting. Captured parameters are bounded to
8 KiB; common secret fields, sensitive URL values, and native input values are
redacted. If reporting is disabled, the package is absent, or structured actions
are unavailable, test behavior is unchanged.

Screenshots follow the project's `use.screenshot` setting on both platforms.

## Verifying an upgrade

After taking a new version of this package, run these checks in the consuming
project before trusting a device run:

1. `npx tsc --noEmit -p tsconfig.json` — catches renamed or removed capabilities,
   fixtures, and page extensions without launching a browser. Every project
   should have a `tsconfig.json` for this even when the tests are JavaScript.
2. A local pre-flight run with no endpoint configured, which exercises the
   fixtures against a local browser.
3. One real-device run per platform, using a spec that touches navigation,
   locator input, `page.bridge`, and screenshots.

## License

Proprietary and confidential. See [LICENSE](./LICENSE). This package is not open
source and must not be published to a public registry.

The distributed bundle contains only this project's own code; Playwright and the
optional Zebrunner reporter stay external dependencies and are not redistributed.
