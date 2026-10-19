# Agent guide

This file holds the canonical instructions for any AI coding agent that works in this repository, such as Cursor, Codex, Claude Code, or any tool that reads AGENTS.md. Read it before you change code. It is self-contained for daily work.

## Purpose and scope

`playwright-mobile-lib` is a public Apache-2.0 package. It gives one Playwright `test` with fixtures for iOS Safari and Android Chrome. With no hub URL, tests run in local WebKit or Chromium (pre-flight). With a hub URL, tests run on real devices through a remote session service. The package is in beta, and its public API can change.

This repository holds the library only. The iOS bridge, the Android bridge, the orchestrator, and the acceptance suites are separate repositories.

## Repository map

- `index.js`: public entry. It re-exports `@playwright/test`, overrides `test` and `expect`, and adds `withAppiumInputMode` and `resolveIOSDevicePreset`.
- `index.d.ts`: public types, including the deprecated throwers for unsupported APIs.
- `src/test.js`: the unified `test.extend`. It calls only the driver contract.
- `src/platforms/index.js`: `selectDriver(platformName)`.
- `src/core/*`: shared code for capabilities and connect headers, bridge RPC, device catalog and name matching, pre-flight video, reporting, telemetry, unsupported-API helpers, the `use` guard, and context patches.
- `src/platforms/ios/*`: the iOS driver, bridge proxy, Appium helpers, device catalog, screenshot gate, and restriction tables.
- `src/platforms/android/*`: the Android driver, bridge proxy, device proxy, device catalog, and restriction tables.
- `test/`: unit tests in `test/*.test.js` and type tests in `test/types/`.
- `dist/`: build output. The repository tracks `dist/index.js` because consumers install from Git. Do not edit it by hand.

## Local checks

Run these npm scripts from the repository root:

- `npm run build`: esbuild bundles `index.js` to `dist/index.js` (CJS, node18, peers external).
- `npm run typecheck`: `tsc -p tsconfig.json`. It covers `index.d.ts` and `test/types` only.
- `npm run lint`: `eslint .`.
- `npm run unit`: `node --test` on the listed unit test files.
- `npm test`: build, typecheck, a `require` smoke check, and unit tests.
- `npm run test:coverage`: `c8` with `.c8rc.json`. Thresholds are lines 85, statements 85, functions 80, and branches 75. It excludes `src/test.js`.
- `npm run test:pack`: smoke test of the packed tarball.

CI runs on Node 22 and 24: `npm ci`, lint, `npm test`, `npm run test:coverage`, and `npm run test:pack`. The publish workflow runs only by manual dispatch.

The package needs Node.js 18 or newer. Peer dependencies are `@playwright/test` and `playwright` at 1.58.2 or newer, and an optional `@zebrunner/javascript-agent-playwright`. Run only the focused check for your change first. Do not run a check that needs a device or a hub unless the user asks.

## Conventions and invariants

Platform and capabilities:

- Platform branches live in the drivers. `src/test.js` calls only the driver contract: `connect`, `disconnect`, `resolveDeviceInfo`, `resolvePreset`, `resolveBrowser`, `resolveDevice`, `createContext`, `createPage`, optional teardown hooks, and `unsupportedUseOptions`.
- `selectDriver` maps `android` to Android, and `ios` or an empty value to iOS. Other values throw.
- There are no environment fallbacks for capability fields. The default capability object is `{ platformName: 'iOS' }`.
- An unknown `browsingMode` or `orientation` throws before the connect. An empty `orientation` is sent as `portrait`. The library sets no default `browsingMode`.
- A hub run requires `deviceName` or `deviceUuid`.

Connection:

- An empty `PLAYWRIGHT_MOBILE_HUB_URL` launches local WebKit or Chromium. A set URL connects with the headers `x-pwm-capabilities`, `x-pwm-client-id`, and an optional `Authorization`.
- The library removes the query string and strips the URL user information before the connect. It sends the user information as Basic `Authorization`.
- `page.bridge` on a pre-flight throws `BridgeUnavailableError`. It does not evaluate the sentinel string.

Android:

- An empty `browsingMode` runs as `public`. `single-tab` and `single-tab-public` run as `public`, and `single-tab-private` runs as `private`, with one warning.
- Launch option order: `use`, then `capabilities`, then `extraContextOptions`, then `hasTouch` (`true` unless explicitly `false`). The default package is `com.android.chrome`.
- The tab sweep runs unless `closeOpenedTabsAfterTest` is `false`. `pm clear` runs only when `resetBrowserDataAfterTest` is `true`.
- `page.appium` does not flip the input mode.
- Reading `browser` on an Android device throws. `device.close` and `device.launchBrowser` throw.

iOS and local contexts:

- A context is built from the preset, then an optional pre-flight `recordVideo`, then `extraContextOptions`. The driver does not forward `use` context options on these paths.
- Reading `device` on iOS or on a pre-flight throws.
- With `force: true`, the hit-test bypass runs only with a hub URL.
- The screenshot gate runs only with a hub URL. It returns a 1x1 PNG when the tab is not in the foreground.
- `setBrowsingMode` returns a new page on a device.

Shared behavior:

- Warn once for each unsupported `use` option.
- Patch the prototypes once for each worker, and wrap `context.newPage` so that new pages get the patches.
- `deviceInfo` stays the capability snapshot.
- Reporting is on only when `REPORTING_ENABLED` is `true`. A missing Zebrunner module turns it off.
- The published code is `dist/index.js` with external peers. Types stay in `index.d.ts`. Keep `index.d.ts` in sync with the runtime exports.
- `src/core/capabilities.js` reads `PLAYWRIGHT_SLOW_MO_MS`, `PLAYWRIGHT_MOBILE_CONNECT_TIMEOUT_MS`, and `PLAYWRIGHT_MOBILE_CLIENT_ID` when the module loads. `PLAYWRIGHT_MOBILE_HUB_URL` is read at connect time. A `dotenv.config()` call after the import does not change the load-time values.
- Do not read or commit `.env` files. `.env.example` lists variable names only.

## Tests policy

Do not create, modify, or propose tests unless the user asks.

## Documentation policy

Do not create a `docs/` folder or long Markdown files in this repository. Do not edit docs as a side effect of a code change. Update docs only when the user asks. If a doc looks stale, mention it to the user.
