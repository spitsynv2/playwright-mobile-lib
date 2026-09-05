# Getting started

## Install

This package is not on the public npm registry. Install it from the Git
repository or a registry that provides it. Pin a commit SHA or tag so that each
installation uses the same version:

```jsonc
// package.json
{
  "devDependencies": {
    "@playwright/test": ">=1.58.2",
    "playwright": ">=1.58.2",
    "playwright-mobile-lib": "github:spitsynv2/playwright-mobile-lib#<commit-sha>"
  }
}
```

```bash
npm install
```

The minimum supported Playwright version is `1.58.2`. Newer versions can have
compatibility problems.

Node.js 22 or newer is required. Node 24 LTS is recommended. The
`playwright` and `@playwright/test` versions must match. For a remote device
run, use the Playwright version that the remote device service supports.

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

To run against real devices, set the remote session endpoint:

```bash
PWM_ORCHESTRATOR=wss://orchestrator.example.com:7465/sessions \
  npx playwright test --project=ios-safari

PWM_ORCHESTRATOR=wss://orchestrator.example.com:7465/sessions \
  npx playwright test --project=android-chrome
```

Both projects use the same session URL. The value of
`capabilities.platformName` selects the platform. A full `IOS_WS_ENDPOINT` or
`ANDROID_WS_ENDPOINT` overrides the URL for that platform.
