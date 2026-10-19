# playwright-mobile-lib

**Current release: 0.1.0 beta.**

The public API can change between beta releases.

Cross-platform Playwright fixtures for mobile web testing on real devices:

- iOS Safari, or local WebKit for pre-flight runs
- Android Chrome, or local Chromium for pre-flight runs

The package exports one standard Playwright `test`. Its driver is selected from
`capabilities.platformName` (`'iOS'` or `'Android'`), so the same tests, page
objects, and fixture extensions run on both platforms.

```js
const { test, expect } = require('playwright-mobile-lib');

test('opens a page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
```

## Install

Requirements:

- Node.js 18 or newer.
- Peer dependencies `@playwright/test` >= 1.58.2 and `playwright` >= 1.58.2.
  Use the same version for both. Playwright 1.58.2 is the tested version.
- Optional peer dependency `@zebrunner/javascript-agent-playwright`, for
  reporting.

The package is not on the npm registry. Install it from Git and pin a commit so
that each installation uses the same code:

```json
{
  "devDependencies": {
    "@playwright/test": "1.58.2",
    "playwright": "1.58.2",
    "playwright-mobile-lib": "github:spitsynv2/playwright-mobile-lib#<commit-sha>"
  }
}
```

The repository includes the built bundle `dist/index.js`, so the install needs
no build step.

## Configuration

Import `test`, `expect`, and `defineConfig` from `playwright-mobile-lib`. Set
`use.capabilities` for each project. `platformName` is `'iOS'` or `'Android'`.
When it is omitted, the platform is iOS. A run on a remote device requires
`deviceName`, `deviceUuid`, or both.

```js
// playwright.config.js
const { defineConfig } = require('playwright-mobile-lib');

module.exports = defineConfig({
  projects: [
    {
      name: 'ios-safari',
      use: { capabilities: { platformName: 'iOS', deviceName: 'iPhone 16 Plus' } },
    },
    {
      name: 'android-chrome',
      use: { capabilities: { platformName: 'Android', deviceName: 'Pixel 7' } },
    },
  ],
});
```

The package does not read capabilities from the environment. Orientation is
`portrait` unless you set `orientation`. With `orientation: 'landscape'`, a local
run uses the landscape preset of the device. Do not add `landscape` to
`deviceName`. The package removes the suffix and prints a warning.

The package does not load `.env` files. Load them in your project before you
import the package. The package reads `PLAYWRIGHT_MOBILE_HUB_URL` when it
connects. It reads the other variables when the module loads. Set them in the
environment before Node loads `playwright-mobile-lib`. A `dotenv.config()` call
after the import does not change them. The variables are:

| Variable | Purpose |
| --- | --- |
| `PLAYWRIGHT_MOBILE_HUB_URL` | WebSocket URL of the remote session service. When unset, tests run locally in WebKit or Chromium with the requested device preset. The package removes the query string. It sends `user:pass@` user information as Basic `Authorization`. |
| `PLAYWRIGHT_MOBILE_CONNECT_TIMEOUT_MS` | Connect timeout in milliseconds. The default is `120000`. The legacy name `IOS_CONNECT_TIMEOUT_MS` also works. |
| `PLAYWRIGHT_SLOW_MO_MS` | Delay between Playwright operations in milliseconds. The default is `0`. |
| `PLAYWRIGHT_MOBILE_CLIENT_ID` | Client identifier that the session service uses for device selection. The package generates one when you omit it. |
| `REPORTING_ENABLED` | Set to `true` to enable the optional reporting adapter. |

## Contributing

Contributor and agent rules are in [AGENTS.md](AGENTS.md).

## License

Playwright Mobile Library is released under version 2.0 of the
[Apache License](https://www.apache.org/licenses/LICENSE-2.0).

The distributed bundle contains only this project's code. Runtime dependencies
are not redistributed.
