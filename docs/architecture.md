# Architecture

This document describes what `playwright-mobile-lib` is and how it works
inside. The [README](../README.md) is the usage guide. This document is the
design overview for a contributor or a reviewer.

## Purpose

The package gives one standard Playwright `test` that runs on two mobile web
targets:

- iOS Safari on a real device, or local WebKit for a pre-flight run.
- Android Chrome on a real device, or local Chromium for a pre-flight run.

The same test, page objects, and fixture extensions run on both platforms. The
platform comes from `capabilities.platformName`, not from separate test files.

## Public surface

`index.js` is the entry point. It re-exports the full Playwright surface and
adds the mobile pieces:

- `test` and `expect` — the unified test and the standard matchers.
- `withAppiumInputMode` — a helper that runs a body in iOS Appium input mode.
- `resolveIOSDevicePreset` — the iOS device preset resolver.
- `defineConfig`, `devices`, `mergeTests`, and the rest of Playwright, passed
  through unchanged.

The build bundles `index.js` into `dist/index.js` with esbuild. Runtime
dependencies stay external, so the bundle does not redistribute them.

## Fixture model

`src/test.js` extends the base Playwright `test`. It adds three option
fixtures and a set of worker fixtures. The fixtures never branch on the
platform inline. They call a driver, and the driver owns the platform
specifics.

Option fixtures:

- `capabilities` — worker option. The desired device and mode.
- `reopenInMode` — test option. iOS only. Reopen the page in a fresh tab.
- `extraContextOptions` — test option. Extra context options for the fixture
  context.

Worker fixtures:

- `_driver` — the platform driver, selected from `capabilities.platformName`.
- `_connection` — the platform connection. It has a separate connection
  timeout, so it does not consume the test timeout.
- `browser` — the platform browser. It replaces Playwright's built-in browser,
  so no local browser starts next to the device.
- `device` — Android device runs only. The `AndroidDevice` for native UI.
- `deviceInfo` and `devicePreset` — the resolved device and its preset.

Test-scoped fixtures:

- `context` — built by the driver. It warns about unsupported `use` options and
  runs the driver teardown.
- `page` — built by the driver. It carries the platform extensions.

## Driver contract

`src/platforms/index.js` exposes `selectDriver(platformName)`. Each driver
implements the same contract, so `src/test.js` stays platform-agnostic:

- `connect(capabilities)` and `disconnect(connection)`
- `resolveDeviceInfo(capabilities)` and `resolvePreset(deviceInfo)`
- `resolveBrowser(connection)` and `resolveDevice(connection)`
- `createContext(connection, options)` and `createPage(context, options)`
- `onContextTeardown(context, options)` — optional, for cleanup
- `unsupportedUseOptions` — the table the `use` guard reports against

## Module map

```
index.js                     Public entry; re-exports Playwright + mobile API
src/test.js                  Unified test.extend; option + worker fixtures
src/platforms/index.js       selectDriver(platformName)

src/core/
  capabilities.js            Endpoint, auth, timeout, client-id, browsing-mode
  bridge-rpc.js              Sentinel RPC with a farm-or-pre-flight guard
  device-name.js             Device-name matching across separators and case
  reporting.js               Optional reporting adapter
  telemetry.js               Bounded and redacted action data
  unsupported.js             defineThrowing / defineCaveatWarning helpers
  use-guard.js               warnUnsupportedUseOptions
  context-patch.js           Wrap newPage / close on a consumer context

src/platforms/ios/
  driver.js                  Connect WebKit, build context/page, handshake
  bridge-proxy.js            page.bridge, prototype patches, setBrowsingMode
  appium.js                  Input-mode flip, hit-test bypass, appium proxy
  custom-devices.js          resolveIOSDevicePreset
  screenshot-gate.js         Foreground screenshot gate
  unsupported-ios.js         iOS restriction and caveat tables

src/platforms/android/
  driver.js                  Launch Chrome, forward use options, tab hygiene
  bridge-proxy.js            Android page.bridge extension
  device-proxy.js            The device fixture wrapper
  unsupported-android.js     Android restriction tables
```

## Connection model

Where the test runs depends on the environment, not on the test code.

- No endpoint set. The driver launches a local browser: WebKit on iOS, Chromium
  on Android. This is the pre-flight path. It emulates the requested device.
- An endpoint set. The driver connects to a remote session endpoint.
  `PWM_ORCHESTRATOR` is the shared session URL. `IOS_WS_ENDPOINT` and
  `ANDROID_WS_ENDPOINT` override it per platform.

Capabilities travel as a connect header to the remote service. Authentication
travels as an `Authorization` connect header. Credentials do not remain in the
endpoint URL.

`src/core/capabilities.js` owns this resolution: the endpoint, the auth
precedence, the connect timeout, and the stable client id used to pin a device
across reconnects.

## Device operations

`page.bridge.<op>(args?)` calls a supported device operation. Both platforms
use the same call shape. The available operations depend on the platform.

A local pre-flight has no interceptor. The library throws
`BridgeUnavailableError`. It does not evaluate the sentinel string.

Some operations invalidate the current page. The library applies the required
page cleanup and bounded retries.

## Platform extensions and guards

The driver patches the Playwright `Page`, `Locator`, `Mouse`, and
`BrowserContext` prototypes once per worker:

- It adds `page.bridge`, `page.appium`, `locator.appium`, and
  `page.setBrowsingMode` (iOS). Android also has `page.appium` /
  `locator.appium` as a Playwright passthrough.
- It wraps navigation for optional action integrations.
- It wraps forced pointer actions for the iOS hit-test bypass. A local
  pre-flight skips the bypass RPC and uses Playwright `force`.
- It replaces APIs a shared physical device cannot support with throwers that
  explain the alternative. The type definitions mark these `@deprecated`, so an
  editor shows them struck through before a run.
- It warns once about `use` options the device cannot honor, instead of failing
  the run.
