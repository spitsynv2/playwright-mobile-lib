# Configuration

## Capabilities

Set capabilities per project, or with `test.use()` for a single file. There are
no environment-variable fallbacks for device capabilities.

| Capability | Type | Meaning |
| --- | --- | --- |
| `platformName` | `'iOS' \| 'Android'` | Required. Selects the platform driver and route. |
| `deviceName` | `string` | Device pool pin, such as `iPhone 16 Plus` or `Pixel 7`. Spaces, underscores, hyphens, and case are interchangeable with `devices.json` (`pixel-3-xl` matches `Pixel_3_XL`). Required for Android farm runs. For iOS farm runs, provide `deviceName` and/or `deviceUuid`. Also selects the local emulation preset when set. |
| `deviceUuid` | `string` | iOS device UDID pool pin (case-insensitive). Alone is enough for an iOS farm run. With `deviceName` both must resolve to the same device. |
| `browsingMode` | `BrowsingMode \| string` | Tab/browsing mode requested at connect time. Defaults to `private`. A raw environment-variable string is accepted and validated at session setup. |
| `skipSafariCleanup` | `boolean` | iOS only: skip Safari history/data cleanup when the bridge starts. |
| `closeTabAfterTest` | `boolean` | Close the tab after each test. Defaults to enabled. On Android this also sweeps leftover tabs when the browser is launched. |
| `resetBrowserData` | `boolean` | Android only: clear the browser package's data before each launch. Defaults to disabled. Enable it to reclaim tabs Chrome restored but never reloaded, at the cost of the profile. |
| `navKickEnabled` | `boolean` | iOS only: navigation retry gate. |
| `clickNavRetriesEnabled` | `boolean` | iOS only: click-navigation retry gate. |
| `logLevels` | `Partial<Record<'bridge' \| 'pwserver' \| 'inspector', LogLevel>>` | Per-container verbosity. iOS uses all three sources and restarts a warm container when the set changes. Android forwards `bridge` and `pwserver` when starting its container. `inspector` is iOS-only. The Go bridge and Playwright server implement `off`/`info`/`debug`/`trace`. The iOS container normalizes inspector aliases `fatal`/`warn` to Uvicorn's `critical`/`warning`. |

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
case and whitespace during validation. Any other non-empty value throws when
session setup starts, before the orchestrator or Android launcher can silently
fall back to its default mode.

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
| `video` | The farm records the session video. Use `extraContextOptions.recordVideo` for a per-context recording. |

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
| `storageState` | Sign in through the UI or inject a token. The cookie jar is shared. |
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
in the consuming project before importing `playwright-mobile-lib`, because
connection paths, timeouts, reporting, and ADB settings are captured during
module initialization. For example:

```js
require('dotenv').config();
const { test, expect } = require('playwright-mobile-lib');
```

| Variable | Purpose |
| --- | --- |
| `PWM_ORCHESTRATOR` | Full session WebSocket URL, e.g. `wss://orch.example.com:7465/sessions`. Platform comes from `capabilities.platformName`. May carry `user:pass@` userinfo. Leave unset for local runs. |
| `IOS_WS_ENDPOINT` | Full iOS WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for iOS. |
| `ANDROID_WS_ENDPOINT` | Full Android WebSocket endpoint. Overrides `PWM_ORCHESTRATOR` for Android. |
| `PWM_CONNECT_TIMEOUT_MS` | Remote connect timeout in milliseconds. Defaults to `120000`. The connection fixture timeout is this value plus 30 seconds. The legacy `IOS_CONNECT_TIMEOUT_MS` is still accepted. |
| `PWM_CLIENT_ID` | Stable `x-pwm-client-id` used for device pinning across reconnects. When absent, the default id uses `TEST_PARALLEL_INDEX` plus the runner PID so Playwright worker recycles keep the same pin. Otherwise a unique id is generated once per worker process. The legacy `IOS_CLIENT_ID` is still accepted. |
| `PWM_TAB_CLOSE_TIMEOUT_MS` | Android: how long a single tab close may take during a sweep before the run moves on. Defaults to `5000`. |
| `PWM_AUTH_HEADER` | Complete `Authorization` header value. Highest auth precedence. |
| `PWM_AUTH_TOKEN` | Bearer token used when `PWM_AUTH_HEADER` is empty. |
| `PWM_AUTH_USER` | Basic-auth username used when neither raw-header nor bearer auth is set. |
| `PWM_AUTH_PASSWORD` | Basic-auth password paired with `PWM_AUTH_USER`. |
| `PLAYWRIGHT_SLOW_MO_MS` | Non-negative delay between Playwright operations in milliseconds. Defaults to `0`. |
| `ANDROID_SERIAL` | Direct-ADB device serial used when no WebSocket endpoint is configured. |
| `PWM_ANDROID_ADB` | Set exactly to `true` to select a direct ADB device without a serial. Exactly one device must be available. |
| `ADB_SERVER_HOST` / `ADB_SERVER_PORT` | Direct-ADB server address. Defaults to `127.0.0.1:5037`. |
| `ANDROID_OMIT_DRIVER_INSTALL` | Set exactly to `true` to skip Playwright's Android driver installation in direct-ADB mode. |
| `REPORTING_ENABLED` | Set exactly to `true` to enable the optional Zebrunner integration. Defaults to disabled. |

Authentication is intended for an orchestrator behind an auth proxy, such as the
TLS + basic-auth nginx sidecar shipped with `playwright-mobile-orchestrator`.
The `Authorization` value is sent as a Playwright connect header on both
platforms. Credentials never reach the endpoint URL Playwright connects to.
Precedence is `PWM_AUTH_HEADER`, then `PWM_AUTH_TOKEN` as `Bearer <token>`, then
`PWM_AUTH_USER` / `PWM_AUTH_PASSWORD` as HTTP Basic, then userinfo in the
endpoint URL.

Userinfo is the shorthand form of the same Basic credentials:

```bash
PWM_ORCHESTRATOR=wss://alice:secret@orch.example.com:7465/sessions
```

The library strips `alice:secret@` before connecting and sends it as
`Authorization: Basic …`. Percent-encode reserved characters in the password
(`@` as `%40`, `:` as `%3A`). Prefer `PWM_AUTH_USER` / `PWM_AUTH_PASSWORD` when
the password is awkward to encode or the URL would end up in shell history.
