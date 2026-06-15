# playwright-mobile-lib

Shared Playwright fixture for driving iOS Safari through the mobile bridge /
orchestrator. Extracted from the duplicated `ios-fixtures.js` so every consumer
repo imports one source of truth.

## Install

Referenced over a GitHub ref (same pattern as `@zebrunner/javascript-agent-playwright`):

```jsonc
// package.json
"devDependencies": {
  "playwright-mobile-lib": "github:spitsynv2/playwright-mobile-lib#<commit-sha>"
}
```

Pin a commit SHA for reproducible installs. Then:

```bash
npm install
```

Peer dependencies (provided by the consumer): `@playwright/test`, and
`@zebrunner/javascript-agent-playwright` (optional — only needed when
`REPORTING_ENABLED=true`).

## Usage

```js
const { test, expect } = require('playwright-mobile-lib');

test('opens a page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
```

`withAppiumInputMode` is also exported for advanced input-mode control.
The package includes TypeScript declarations for the fixture options,
capabilities, `defineConfig`, and the `page.bridge`, `page.appium`, and
`locator.appium` extensions.

## Input

Prefer awaited locator `tap()` calls for ordinary iOS interaction. The JS
`tap()` path uses touch semantics and keeps Playwright's locator actionability
retries:

```js
const submit = page.getByRole('button', { name: 'Submit' });
await submit.tap();
```

Covered JS locator taps/clicks are refused until the target becomes actionable.
`tap({ force: true })` and `click({ force: true })` temporarily bypass that
bridge hit-test and dispatch on the requested node. Use `force` deliberately;
it can mask an overlay a real user cannot get through. Use
`locator.appium.tap()` only when trusted physical input is required. Appium taps
at coordinates, so `force` does not retarget a native tap through an overlay.
Bridge RPCs retry when navigation destroys the evaluation context; terminal target
closures still propagate to the test.

## Layout (split by domain)

| File | Responsibility |
| --- | --- |
| `src/ios-bridge.js` | Main connect-to-bridge entry — composes the Playwright `test` fixtures. |
| `src/capabilities.js` | Capabilities + log levels + per-run connection knobs (all env-derived). |
| `src/appium.js` | Bridge-call primitive + appium input-mode proxy. |
| `src/bridge-proxy.js` | `page.bridge.<op>` proxy + one-time prototype patching. |
| `src/unsupported.js` | Platform-restriction API guards (throwers + caveats). |
| `src/reporting.js` | Zebrunner session-id and capability attach helpers. Artifact presign is handled by the reporter through the orchestrator. |
| `src/custom-devices.js` | iOS device preset resolution. |

## Configuration (env)

| Var | Purpose |
| --- | --- |
| `IOS_WS_ENDPOINT` | Orchestrator WS endpoint. Unset → local `webkit.launch()`. |
| `PLAYWRIGHT_SLOW_MO_MS` | Optional run knob. |

Device selection and per-session settings come from each project's
`use: { capabilities }` (one project per device), not env — multi-device /
multi-launch runs can't share a single global value. Recognized capabilities:
`platformName` (required), `deviceName`, `deviceUuid`, `osVersion`,
`browsingMode`, the `skipSafariCleanup`, `closeTabAfterTest`, `navKickEnabled`,
and `clickNavRetriesEnabled` gate booleans, and
`logLevels: { bridge, pwserver, inspector }` accepting `off`, `fatal`, `error`,
`warn`, `info`, `debug`, or `trace`. A level of `off` skips that log artifact;
enabled logs are presigned by the orchestrator and attached to Zebrunner as
`<name>-<sessionId>.log`.
