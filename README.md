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

Node.js 22 or newer is required; Node 24 LTS is recommended. The
`playwright` and `@playwright/test` versions used by tests must match the
Playwright version the device containers run. The mobile orchestrator reads the
client version from Playwright's connect `User-Agent` and starts or restarts
the bridge container with that version; its `ORCH_PLAYWRIGHT_VERSION` is only a
fallback. A directly managed bridge still needs the matching
`PLAYWRIGHT_VERSION` set by its operator.

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
the default pre-flight path and needs no devices. When `deviceName` is empty or
is not a device Playwright knows, a local run still emulates a phone —
`iPhone 16 Plus` on iOS and `Pixel 7` on Android — rather than a desktop
viewport.

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
| `browsingMode` | `BrowsingMode \| string` | Tab/browsing mode requested at connect time. Defaults to `private`. A raw environment-variable string is accepted and validated at session setup. |
| `skipSafariCleanup` | `boolean` | iOS only: skip Safari history/data cleanup when the bridge starts. |
| `closeTabAfterTest` | `boolean` | Close the tab after each test. Defaults to enabled. On Android this also sweeps leftover tabs when the browser is launched. |
| `resetBrowserData` | `boolean` | Android only: clear the browser package's data before each launch. Defaults to disabled; enable it to reclaim tabs Chrome restored but never reloaded, at the cost of the profile. |
| `navKickEnabled` | `boolean` | iOS only: navigation retry gate. |
| `clickNavRetriesEnabled` | `boolean` | iOS only: click-navigation retry gate. |
| `logLevels` | `Partial<Record<'bridge' \| 'pwserver' \| 'inspector', LogLevel>>` | Per-container verbosity. iOS uses all three sources and restarts a warm container when the set changes. Android forwards `bridge` and `pwserver` when starting its container; `inspector` is iOS-only. The Go bridge and Playwright server implement `off`/`info`/`debug`/`trace`; the iOS container normalizes inspector aliases `fatal`/`warn` to Uvicorn's `critical`/`warning`. |

`private` browses without persisting history or site data, and `single-tab-*`
reuses one tab for the whole run instead of opening a tab per page. iOS honors
all four modes with full isolation. On Android, `private` is best-effort: where
the device's browser cannot provide an isolated tab, the run continues in the
normal profile with a warning instead of failing.

`single-tab-*` is iOS-only. Android force-stops and relaunches Chrome for every
test, so no tab can span a run; a single-tab request there runs as `public` or
`private` and warns once. Use the plain modes on Android.

`browsingMode: process.env.BROWSING_MODE || 'private'` needs no cast. The
library accepts `public`, `private`, `single-tab-public`,
`single-tab-private`, and the legacy `single-tab` alias, ignoring surrounding
case and whitespace during validation. Any other non-empty value throws when
session setup starts, before the orchestrator or Android launcher can silently
fall back to its default mode.

On Android, `capabilities` also accepts the context options the launched Chrome
honors (`viewport`, `locale`, `timezoneId`, `geolocation`, `permissions`,
`extraHTTPHeaders`, `httpCredentials`, `proxy`, `recordHar`, `recordVideo`, and
the rest of that set), plus `args` for extra browser flags and `pkg` to select
the browser package. Autocomplete lists the full set. A physical Android context
defaults `hasTouch` to `true`, so `locator.tap()` and `touchscreen` work without
an extra capability; an explicit `hasTouch: false` is still honored.

## Fixtures and options

| Fixture | Scope | Meaning |
| --- | --- | --- |
| `capabilities` | worker option | Desired capabilities for the run. |
| `reopenInMode` | test option | iOS only: reopen `page` in a fresh `private` or `public` tab before the test body. Ignored on Android. |
| `extraContextOptions` | test option | Extra `BrowserContextOptions` merged into context creation. |
| `browser` | worker, read-only | The worker's browser connection, replacing Playwright's built-in fixture so no local browser is launched alongside the device. |
| `device` | worker, read-only | Android device runs only: the `AndroidDevice` behind the run, for native UI outside the web contents. Throws on iOS and on a local pre-flight run. |
| `deviceInfo` | worker, read-only | The device the worker resolved: `deviceName`, `platformName`, `osVersion`, and `browserVersion` on Android. |
| `devicePreset` | worker, read-only | The Playwright device preset resolved from `deviceInfo`. |

On iOS, `browser` is the bridge WebKit `Browser`, so `browser.browserType().name()`
reports `webkit` and `browser.newContext()` behaves as it does in Playwright. On a
local pre-flight run it is the launched `Browser` on either platform. An Android
device run has no `Browser`: the connection is an `AndroidDevice`, so requesting
the fixture throws with an explanation. Use `context` and `page` there,
`context.newPage()` for a second tab, or the `request` fixture for API calls.

Pages opened with `context.newPage()` get the same platform extensions and guards
as the `page` fixture, so `page.bridge` works on a second tab too.

Before a real Android device context is exposed to tests, the library replays
custom selector engines registered through Playwright's `selectors` API and the
configured `testIdAttribute` onto that context. Selectors registered before the
device connection therefore behave the same way as they do in local Chromium.

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
| `browser` fixture | iOS and local pre-flight runs; throws on an Android device run |
| `device` fixture | Android device runs only; throws on iOS and on local pre-flight runs |

### Native UI on Android: the `device` fixture

Everything inside the page is ordinary Playwright, including JavaScript dialogs
(`page.on('dialog')`) and HTTP basic auth (`httpCredentials` or an `Authorization`
header), neither of which surfaces native UI on Android Chrome. What Playwright
cannot see is UI drawn *outside* the web contents: the Android permission sheet,
the download bar, intent choosers, and the soft keyboard.

The `device` fixture exposes the `AndroidDevice` the context was launched from,
which is Playwright's own UIAutomator-over-adb surface. It works the same on a
farm run and on an ADB run, because the calls are dispatched to whichever process
owns adb. Selector-based methods (`tap`, `longTap`, `fill`, `press`, `wait`,
`info`, `scroll`, `swipe`, `fling`, `pinchOpen`, `pinchClose`) take an
`AndroidSelector`; `device.input.*` covers raw coordinates, and `device.shell()`
runs an adb shell command.

```js
test('accepts the native location prompt', async ({ page, device }) => {
  await device.wait({ res: /permission_allow/ }, { timeout: 5_000 });
  await device.tap({ res: 'com.android.permissioncontroller:id/permission_allow_foreground_only_button' });
  await expect(page.locator('#status')).toContainText('Located');
});
```

Prefer avoiding the prompt over tapping it. OS-level state is best set before
Chrome starts, from a worker-scoped setup or a global setup step, because Chrome
caches permission state for the life of its process:

```js
await device.shell('pm grant com.android.chrome android.permission.ACCESS_FINE_LOCATION');
await device.shell('settings put secure location_mode 3');
```

Two constraints are worth knowing. UIAutomator only sees the native view tree, so
it is blind to page content — keep using locators for anything inside the page.
And resource ids differ across Android versions and OEM skins, so prefer `text`
or `desc` with a regular expression and treat `res` as the fallback. Always
`device.wait(selector)` before tapping, since dialog animations otherwise make
the tap racy.

`device.close()` and `device.launchBrowser()` throw: the worker connection and the
`context` fixture own them, and calling either from a test would break the rest of
the worker.

Device calls are reported as fixture-kind actions, so they appear in the Zebrunner
step log when `REPORTING_LOGS_INCLUDE_FIXTURES=true`. Text passed to `device.fill()`
and `device.input.type()` is redacted there, as it is for the iOS native equivalents.

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

## Context options under `use`

Context options set under `use` in the config, at the top level or per project,
are honored where the device can honor them and reported where it cannot. What a
device accepts differs sharply by platform, so the two are listed separately.

**A real Android device honors the ordinary Playwright set.** The launched Chrome context
accepts `baseURL`, `viewport`, `locale`, `timezoneId`, `geolocation`,
`permissions`, `offline`, `extraHTTPHeaders`, `httpCredentials`,
`ignoreHTTPSErrors`, `bypassCSP`, `javaScriptEnabled`, `serviceWorkers`,
`acceptDownloads`, `proxy`, `recordHar`, the appearance options, and the rest of
that set, so a config written for default Playwright keeps working on a device.
The driver defaults `hasTouch` to `true` for a physical device and preserves an
explicit override.

Only three cannot be applied:

| Ignored on Android | Instead |
| --- | --- |
| `storageState` | `launchBrowser()` does not take it. Restore the cookies yourself with `context.addCookies()`, which Android allows in `public` browsing mode. |
| `clientCertificates` | `launchBrowser()` does not take them. |
| `video` | The farm records the session video; use `extraContextOptions.recordVideo` for a per-context recording. |

One caveat applies to the `private` browsing modes. Chrome for Android serves the
incognito tab from a separate profile, but CDP applies `context.grantPermissions()`,
`clearPermissions()`, `cookies()`, `addCookies()`, and `clearCookies()` to the
regular profile, so those calls succeed without reaching the page under test.
Per-page settings — `setGeolocation()`, `setExtraHTTPHeaders()`, `setOffline()`,
and user-agent updates — apply to the tab directly and work in either mode. Run
tests that depend on permissions or cookies with `browsingMode: 'public'`.

**iOS Safari honors far fewer**, because the bridge cannot fake a physical
device's profile or system settings:

| Ignored on iOS | Instead |
| --- | --- |
| `viewport`, `screen`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `userAgent` | Select a device with `capabilities.deviceName`. |
| `locale`, `timezoneId`, `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` | Change the setting in iOS Settings. |
| `permissions` | Grant permissions in iOS Settings or through the system prompt. |
| `geolocation`, `offline` | Not available: real GPS, and only airplane mode takes the device offline. |
| `storageState` | Sign in through the UI or inject a token; the cookie jar is shared. |
| `httpCredentials` | Send `extraHTTPHeaders: { Authorization: 'Basic <base64>' }` for preemptive Basic auth. |
| `proxy`, `ignoreHTTPSErrors`, `javaScriptEnabled`, `bypassCSP`, `acceptDownloads` | Not available: Safari and iOS own these. |
| `video` | The farm records the session video. |

On both platforms the launch-level options cannot apply, because the farm owns
browser selection and startup: `browserName`, `defaultBrowserType`, `headless`,
`channel`, `launchOptions`, and `connectOptions`. Use `capabilities.platformName`
to pick the platform, `capabilities.args` for Android browser flags, and
`PWM_ORCHESTRATOR` for the connection.

Runner-side `trace`, `screenshot`, `testIdAttribute`, `actionTimeout`, and
`navigationTimeout` remain available on both platforms. Ordinary `use` context
options, including `baseURL`, are forwarded on a real Android device. iOS and
local WebKit/Chromium pre-flight build the context from the resolved device
preset plus `extraContextOptions`, so put context options there when the same
config must work on every path. On real Android, the raw
`use: { contextOptions }` escape hatch is read with top-level values winning.

Both the forwarding and the warnings read the config, so a per-file
`test.use({ viewport })` is not covered by either. Use
`test.use({ extraContextOptions: { ... } })` for per-file context options; it is
applied directly by the driver on both platforms and wins over everything else.

Where an option is ignored, the library warns once naming the option and the
alternative, rather than failing the run. Those warnings also appear on a local
pre-flight run, where a launched browser does honor the options. That is
deliberate: pre-flight exists to predict the device run, so a configuration that
cannot work on a device says so before a device is booked.

`capabilities` and `extraContextOptions` are the explicit route and are always
applied, overriding anything forwarded from `use`. Precedence on Android is
`use`, then `capabilities`, then `extraContextOptions`. One asymmetry is worth
knowing: `capabilities.viewport` is applied on an Android device even though
`page.setViewportSize()` throws, because a capability is read as a deliberate
request while a mid-test resize is not.

## Environment variables

The library reads `process.env` and does not load `.env` files itself. Load them
in the consuming project before importing `playwright-mobile-lib`, because
connection paths, timeouts, reporting, and ADB settings are captured during
module initialization. For example:

```js
require('dotenv').config();
const { test, expect } = require('playwright-mobile-lib');
```

| Variable | Purpose |
| --- | --- |
| `PWM_ORCHESTRATOR` | Orchestrator base URL, e.g. `wss://orch.example.com:7465`. The per-platform route is derived from it. May carry `user:pass@` userinfo. Leave unset for local runs. |
| `IOS_WS_ENDPOINT` | Full iOS WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for iOS. |
| `ANDROID_WS_ENDPOINT` | Full Android WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for Android. |
| `PWM_IOS_WS_PATH` | iOS route appended to `PWM_ORCHESTRATOR`. Defaults to `/safari`. |
| `PWM_ANDROID_WS_PATH` | Android route appended to `PWM_ORCHESTRATOR`. Defaults to `/playwright`. |
| `PWM_CONNECT_TIMEOUT_MS` | Remote connect timeout in milliseconds. Defaults to `120000`; the connection fixture timeout is this value plus 30 seconds. The legacy `IOS_CONNECT_TIMEOUT_MS` is still accepted. |
| `PWM_CLIENT_ID` | Stable `x-pwm-client-id` used for device pinning across reconnects. When absent, a unique ID is generated once per worker process. The legacy `IOS_CLIENT_ID` is still accepted. |
| `PWM_TAB_CLOSE_TIMEOUT_MS` | Android: how long a single tab close may take during a sweep before the run moves on. Defaults to `5000`. |
| `PWM_AUTH_HEADER` | Complete `Authorization` header value. Highest auth precedence. |
| `PWM_AUTH_TOKEN` | Bearer token used when `PWM_AUTH_HEADER` is empty. |
| `PWM_AUTH_USER` | Basic-auth username used when neither raw-header nor bearer auth is set. |
| `PWM_AUTH_PASSWORD` | Basic-auth password paired with `PWM_AUTH_USER`. |
| `PLAYWRIGHT_SLOW_MO_MS` | Non-negative delay between Playwright operations in milliseconds. Defaults to `0`. |
| `ANDROID_SERIAL` | Direct-ADB device serial used when no WebSocket endpoint is configured. |
| `PWM_ANDROID_ADB` | Set exactly to `true` to select a direct ADB device without a serial; exactly one device must be available. |
| `ADB_SERVER_HOST` / `ADB_SERVER_PORT` | Direct-ADB server address. Defaults to `127.0.0.1:5037`. |
| `ANDROID_OMIT_DRIVER_INSTALL` | Set exactly to `true` to skip Playwright's Android driver installation in direct-ADB mode. |
| `REPORTING_ENABLED` | Set exactly to `true` to enable the optional Zebrunner integration. Defaults to disabled. |

Authentication is intended for an orchestrator behind an auth proxy, such as the
TLS + basic-auth nginx sidecar shipped with `playwright-mobile-orchestrator`.
The `Authorization` value is sent as a Playwright connect header on both
platforms; credentials never reach the endpoint URL Playwright connects to.
Precedence is `PWM_AUTH_HEADER`, then `PWM_AUTH_TOKEN` as `Bearer <token>`, then
`PWM_AUTH_USER` / `PWM_AUTH_PASSWORD` as HTTP Basic, then userinfo in the
endpoint URL.

Userinfo is the shorthand form of the same Basic credentials:

```bash
PWM_ORCHESTRATOR=wss://alice:secret@orch.example.com:7465
```

The library strips `alice:secret@` before connecting and sends it as
`Authorization: Basic …`. Percent-encode reserved characters in the password
(`@` as `%40`, `:` as `%3A`); prefer `PWM_AUTH_USER` / `PWM_AUTH_PASSWORD` when
the password is awkward to encode or the URL would end up in shell history.

## Extending `test` (fixtures, page objects, TypeScript)

The exported `test` is a standard Playwright `TestType`. Consumers can call
`test.extend(...)`, combine fixture-bearing tests with the re-exported Playwright
`mergeTests(mobileTest, anotherTest)`, and use ordinary Page Object Models.
Option fixtures can be overridden with
`test.use({ capabilities, extraContextOptions, reopenInMode })` or under `use` in
this package's `defineConfig()`.

`defineConfig()` mirrors Playwright's own signatures, so a consumer option
fixture passes its type through as `defineConfig<AppOptions>({ use: { ... } })`,
and the merge form `defineConfig(baseConfig, override)` works. The three mobile
options are also recognized by `defineConfig` imported from `@playwright/test`.

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

In a checked JavaScript config, keep `capabilities` inline under
`defineConfig({ projects: [...] })` to receive contextual typing without a
JSDoc annotation. Extracting the object into a standalone `const` widens literal
values such as `'iOS'`; annotate that standalone object as `Capabilities` if
extraction is necessary. Environment-derived `browsingMode` and gate strings
remain valid inputs; `browsingMode` is checked by the library when session
setup begins.

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
Zebrunner test. The reporter registers a Zebrunner test session with the bridge
session ID. Farm `video.mp4` and combined `session.log` artifacts remain in farm
storage; the test process and reporter do not download or re-upload them.

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

## Developing locally

Node.js 22+ is required. From this repository:

```bash
npm install
npm test
```

`npm test` builds the minified CommonJS bundle, type-checks the public
declarations and rejected-usage cases, verifies the fixture wiring, and runs
the unit tests. It does not book or launch a physical device.

To exercise the exact package shape in a consuming repository:

```bash
npm pack --pack-destination /tmp

cd ../playwright-mobile-bridge-tests/tests-ios
npm install --no-save /tmp/playwright-mobile-lib-1.0.0.tgz
npx playwright install webkit
npm run typecheck
PWM_ORCHESTRATOR= IOS_WS_ENDPOINT= REPORTING_ENABLED=false \
  npx playwright test test/specs/locator-queries.spec.js --reporter=list
```

Repeat with `tests-android`, local Chromium, and empty
`ANDROID_WS_ENDPOINT`/ADB selectors for the Android pre-flight. Run
`npm install` in the consumer afterwards to restore the version pinned in its
`package.json`.

The local browser path verifies fixture composition and the ordinary
Playwright surface. `page.bridge`, Appium input, native dialogs, physical
viewport behavior, and farm recording require a real device through a direct
bridge or the orchestrator.

## License

Playwright Mobile Library is released under version 2.0 of the
[Apache License](https://www.apache.org/licenses/LICENSE-2.0).

The distributed bundle contains only this project's own code; Playwright and the
optional Zebrunner reporter stay external dependencies and are not redistributed.
