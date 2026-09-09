# Configuration

## Capabilities

Set capabilities per project, or with `test.use()` for a single file. There are
no environment-variable fallbacks for device capabilities.

| Capability | Type | Meaning |
| --- | --- | --- |
| `platformName` | `'iOS' \| 'Android'` | Required. Selects the platform driver and route. |
| `deviceName` | `string` | Remote device selector, such as `iPhone 16 Plus` or `Pixel 7`. Spaces, underscores, hyphens, and case are interchangeable with `devices.json` (`pixel-3-xl` matches `Pixel_3_XL`). For a remote run on either platform, provide `deviceName`, `deviceUuid`, or both. Also selects the local emulation preset when set. |
| `deviceUuid` | `string` | Remote device selector: the UDID on iOS and the ADB serial on Android. Use it instead of, or with, `deviceName`. When you set both, they must identify the same device. |
| `browsingMode` | `BrowsingMode \| string` | Tab/browsing mode requested at connect time. Defaults to `private` on iOS and `public` on Android. On Android `public` is stable and `private` is experimental. A raw environment-variable string is accepted and validated at session setup. |
| `safariStartupCleanupEnabled` | `boolean` | iOS only: run Safari history/data cleanup when the bridge starts. Defaults to enabled. |
| `closeOpenedTabsAfterTest` | `boolean` | Close the tabs the session opened after each test. Defaults to enabled. On Android this also sweeps leftover tabs when the browser is launched. |
| `resetBrowserDataAfterTest` | `boolean` | Android only: clear the browser package's data before each launch. Defaults to disabled. Enable it to reclaim tabs Chrome restored but never reloaded, at the cost of the profile. |
| `explicitNavigationRecoveryEnabled` | `boolean` | iOS only: explicit-navigation recovery gate. Reissues a stuck explicit navigation. Defaults to disabled. |
| `clickNavigationRetapRecoveryEnabled` | `boolean` | iOS only: click-navigation retap recovery gate. Repeats a trusted tap after a stalled click navigation. Defaults to disabled. |
| `logLevels` | `Partial<Record<'bridge' \| 'playwrightServer' \| 'inspector', LogLevel>>` | Remote session log levels. iOS accepts all three sources. Android accepts `bridge` and `playwrightServer`. |
| `sessionIdleTimeoutMs` | `number` | Remote session idle timeout in milliseconds. Omit it to use the service default. `0` disables the timeout. Must be a non-negative integer. |

`private` browses without persisting history or site data, and `single-tab-*`
reuses one tab for the whole run instead of opening a tab per page. iOS honors
all four modes with full isolation. On Android, `private` is best-effort: where
the device's browser cannot provide an isolated tab, the run continues in the
normal profile with a warning instead of failing.

`single-tab-*` is iOS-only. Android force-stops and relaunches Chrome for every
test, so no tab can span a run. A single-tab request there runs as `public` or
`private` and warns once. Use the plain modes on Android.

`browsingMode: process.env.BROWSING_MODE || 'private'` needs no cast. The
library accepts `public`, `private`, `single-tab-public`,
`single-tab-private`, and the legacy `single-tab` alias, ignoring surrounding
case and whitespace during validation. Any other non-empty value throws during
session setup.

On Android, `capabilities` also accepts the context options the launched Chrome
honors (`viewport`, `locale`, `timezoneId`, `geolocation`, `permissions`,
`extraHTTPHeaders`, `httpCredentials`, `proxy`, `recordHar`, `recordVideo`, and
the rest of that set), plus `args` for extra browser flags and `pkg` to select
the browser package. Autocomplete lists the full set. A physical Android context
defaults `hasTouch` to `true`, so `locator.tap()` and `touchscreen` work without
an extra capability. An explicit `hasTouch: false` is still honored.

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
| `video` | The farm records the device session. A local pre-flight records `use.video`; for a device context that allows it, use `extraContextOptions.recordVideo`. |

One caveat applies to the `private` browsing modes. Chrome for Android serves the
incognito tab from a separate profile, but CDP applies `context.grantPermissions()`,
`clearPermissions()`, `cookies()`, `addCookies()`, and `clearCookies()` to the
regular profile, so those calls succeed without reaching the page under test.
Per-page settings — `setGeolocation()`, `setExtraHTTPHeaders()`, `setOffline()`,
and user-agent updates — apply to the tab directly and work in either mode. Run
tests that depend on permissions or cookies with `browsingMode: 'public'`.

**iOS Safari honors fewer options** because a test cannot replace a physical
device profile or its system settings:

| Ignored on iOS | Instead |
| --- | --- |
| `viewport`, `screen`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `userAgent` | Select a device with `capabilities.deviceName`. |
| `locale`, `timezoneId`, `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` | Change the setting in iOS Settings. |
| `permissions` | Grant permissions in iOS Settings or through the system prompt. |
| `geolocation`, `offline` | Not available: real GPS, and only airplane mode takes the device offline. |
| `storageState` | Sign in through the UI or inject a token. The cookie jar is shared. |
| `httpCredentials` | Send `extraHTTPHeaders: { Authorization: 'Basic <base64>' }` for preemptive Basic auth. |
| `proxy`, `ignoreHTTPSErrors`, `javaScriptEnabled`, `bypassCSP`, `acceptDownloads` | Not available: Safari and iOS own these. |
| `video` | Use the remote session video when the service provides it. A local pre-flight records `use.video`. |

On remote devices, these launch options do not apply: `browserName`,
`defaultBrowserType`, `headless`, `channel`, `launchOptions`, and
`connectOptions`. Use `capabilities.platformName` to select the platform. Use
`capabilities.args` for Android browser flags. Use
`PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT` for the connection.

Runner-side `trace`, `screenshot`, `testIdAttribute`, `actionTimeout`, and
`navigationTimeout` remain available on both platforms. Ordinary `use` context
options, including `baseURL`, are forwarded on a real Android device. iOS and
local WebKit/Chromium pre-flight build the context from the resolved device
preset plus `extraContextOptions`, so put context options there when the same
config must work on every path. On real Android, the raw
`use: { contextOptions }` escape hatch is read with top-level values winning.

Both the forwarding and the warnings read the config, so a per-file
`test.use({ viewport })` is not covered by either. Use
`test.use({ extraContextOptions: { ... } })` for per-file context options. It is
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
in the consuming project before importing `playwright-mobile-lib`. Connection
Connection settings load during module initialization. For example:

```js
require('dotenv').config();
const { test, expect } = require('playwright-mobile-lib');
```

| Variable | Purpose |
| --- | --- |
| `PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT` | Full session WebSocket URL, for example, `wss://orch.example.com:7465/sessions`. `capabilities.platformName` selects the platform. The URL can contain `user:pass@` user information. Leave this variable unset for local runs. |
| `PLAYWRIGHT_MOBILE_CONNECT_TIMEOUT_MS` | Remote connect timeout in milliseconds. The default is `120000`. The connection fixture adds 30 seconds. The legacy `IOS_CONNECT_TIMEOUT_MS` is still accepted. |
| `PLAYWRIGHT_MOBILE_CLIENT_ID` | Stable `x-pwm-client-id` for device selection across reconnects. If absent, the default uses `TEST_PARALLEL_INDEX` and the runner process identifier. The legacy `IOS_CLIENT_ID` is still accepted. |
| `PLAYWRIGHT_SLOW_MO_MS` | Non-negative delay between Playwright operations in milliseconds. Defaults to `0`. |
| `REPORTING_ENABLED` | Enable the optional reporting adapter when set to `true`. Defaults to `false`. Present in the library's `.env.example`. |

Put Basic authentication credentials in the endpoint URL:

```bash
PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT="wss://${ORCHESTRATOR_USER}:${ORCHESTRATOR_PASSWORD}@orch.example.com:7465/sessions"
```

The library strips the user information before connection and sends it as
`Authorization: Basic …`. Percent-encode reserved characters in the password
(`@` as `%40`, `:` as `%3A`). Keep this URL in an ignored `.env` file or a CI
secret store.
