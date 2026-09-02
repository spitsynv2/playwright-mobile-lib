# API and fixtures

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
| `page.bridge.<operation>(args?)` | Both platforms, with a per-platform operation set. iOS serves the full set. Android serves `getSessionId` and `getDeviceInfo`. |
| `page.appium.<method>(...)` / `locator.appium.<method>(...)` | iOS only |
| `page.setBrowsingMode('private' \| 'public')` | iOS only |
| `withAppiumInputMode(page, fn)` | iOS only |
| `reopenInMode` | iOS only. Ignored on Android |
| `resolveIOSDevicePreset()` | iOS only |
| `browser` fixture | iOS and local pre-flight runs. Throws on an Android device run |
| `device` fixture | Android device runs only. Throws on iOS and on local pre-flight runs |

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
`AndroidSelector`. `device.input.*` covers raw coordinates, and `device.shell()`
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

### APIs that a real device cannot support

A few Playwright APIs cannot behave correctly on a shared physical device, so
they throw with an explanation instead of silently doing nothing. They are marked
`@deprecated` in the type definitions, which means editors show them struck
through with the reason on hover, before the test is ever run.

| Blocked | Platform | Alternative |
| --- | --- | --- |
| `page.setViewportSize()` | iOS, Android | Select a device with `capabilities.deviceName`. |
| `page.emulateMedia()` | iOS | Change the setting on the device. |
| `page.hover()`, `locator.hover()` | iOS | Tap. Touch devices fire pointer events on tap only. |
| `page.setInputFiles()`, `locator.setInputFiles()` | iOS | Not available: the native file picker is not driveable. |
| `mouse.wheel()` | iOS | `locator.scrollIntoViewIfNeeded()` or `page.evaluate(() => scrollBy(...))`. |
| `context.cookies()`, `addCookies()`, `clearCookies()`, `storageState()` | iOS | Not available: the cookie jar is shared across the device. |
| `context.grantPermissions()`, `clearPermissions()` | iOS | Grant permissions on the device. |
| `context.setGeolocation()` | iOS | Not available: real GPS. |
| `context.setOffline()` | iOS | Not available: only airplane mode toggles offline. |

`page.addInitScript()` is supported, and warns once about one caveat: it runs
before load on same-origin navigations, but is replayed into the committed
document (after load) on the first cross-origin page.

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
values such as `'iOS'`. Annotate that standalone object as `Capabilities` if
extraction is necessary. Environment-derived `browsingMode` and gate strings
remain valid inputs. `browsingMode` is checked by the library when session
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
